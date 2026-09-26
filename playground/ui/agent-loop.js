/* =========================================================
   PERSCOPE PLAYGROUND — AGENTIC LOOP (chat-side reasoning)
   =========================================================
   Pure orchestration: user task + sanitized context -> local model
   (LM Studio / Ollama / forwarder-backed cloud via model-client) ->
   tool_calls -> runtime-client.callTool (bridge WS leg) -> results
   fed back -> final answer. No DOM, no rendering, no provider
   specifics beyond the injected chat/execute callables.

   Safety properties (locked):
   - Tool-only action: the model only ever emits tool calls; this loop
     never executes anything except bridge tools via `execute`.
   - Sanitized-context-only: the loop starts from read_page output and
     never introduces raw page content (it has none to introduce).
   - Malformed output is repaired (one re-prompt) or aborts honestly —
     never forwarded raw to the bridge. The repair is observable via
     onEvent({type:"repair"}) so tests can prove it happened.
   - Bounded: MAX_ITERS caps a confused model; blocking bridge calls
     (70s ceiling) cannot spin forever.
   - Destructive outcomes (denied/timeout) are terminal data handled by
     the caller (chat UI renders them); the loop never re-asks, never
     retries a denied action on its own. */

export const DEFAULT_MCP_URL = "http://127.0.0.1:7332/mcp";
export const MAX_ITERS = 12;

const SYSTEM_PROMPT = [
  "You are a careful browser assistant operating through privacy tools.",
  "Rules, in order:",
  "1. You only see SANITIZED context (redacted text, placeholders like [REDACTED:EMAIL]).",
  "2. You never have raw personal data and must never claim otherwise. If asked for a sensitive value, say it is redacted and continue with placeholders.",
  "3. You act ONLY by calling the provided tools with valid JSON arguments. Never describe an action as done without a tool result confirming it.",
  "4. Prefer read-only tools first (read_page, list_interactive_elements, capture_tab) to understand the page before acting.",
  "5. A denied or timed-out action is FINAL for this turn: report it plainly and stop. Never retry it, never work around it.",
].join("\n");

/** Live tool schemas from the bridge (no hand-mirroring, no drift). */
export async function fetchMcpTools(mcpUrl = DEFAULT_MCP_URL, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "tools-list", method: "tools/list", params: {} }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`bridge MCP answered HTTP ${res.status}`);
    // The bridge answers as SSE (text/event-stream: "event: message\ndata: {...}"),
    // not plain JSON — parse the data frame, with a plain-JSON fallback.
    const raw = await res.text();
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      const frame = raw.split("\n").find((line) => line.startsWith("data:"));
      if (!frame) throw new Error("bridge MCP answered non-JSON, non-SSE");
      data = JSON.parse(frame.slice("data:".length).trim());
    }
    const tools = data?.result?.tools;
    if (!Array.isArray(tools) || !tools.length) throw new Error("bridge returned no tools");
    return tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description || "",
        parameters: t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object" },
      },
    }));
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
  }
}

function asTextContent(text) {
  return [{ type: "text", text: String(text ?? "") }];
}

function asImageContent(text, imageBase64) {
  if (!imageBase64) return asTextContent(text);
  return [
    { type: "text", text: String(text ?? "") },
    { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } },
  ];
}

function parseToolCall(call, knownNames) {
  const fn = call && call.function ? call.function : null;
  const name = fn && typeof fn.name === "string" ? fn.name : "";
  if (!name || !knownNames.has(name)) {
    return { ok: false, error: `unknown tool ${JSON.stringify(name)} (known: ${[...knownNames].join(", ")})` };
  }
  let args = {};
  try {
    args = fn.arguments ? JSON.parse(fn.arguments) : {};
  } catch {
    return { ok: false, error: `arguments for ${name} are not valid JSON`, tool: name, raw: fn.arguments };
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, error: `arguments for ${name} must be a JSON object`, tool: name };
  }
  return { ok: true, name, args, callId: call.id };
}

/**
 * Run one agentic turn.
 *
 * @param {object} opts
 * @param {string} opts.task - user task text
 * @param {Function} opts.chat - (({messages, tools}) => assistant message), e.g. modelClient.chatCompletions bound
 * @param {Function} opts.execute - ((tool, params) => bridge result), e.g. runtime.callTool bound
 * @param {Array} opts.tools - OpenAI-shape tool defs (fetchMcpTools)
 * @param {Function} [opts.onEvent] - observer ({type, ...}); types: reasoning, tool_call, tool_result, repair, final, error
 * @param {number} [opts.maxIters] - iteration cap (default MAX_ITERS)
 * @param {boolean} [opts.vision] - include imageBase64 as image_url
 * @param {string|null} [opts.imageBase64] - redacted capture PNG, base64 (no data: prefix)
 * @returns final assistant text (never raw PII — the loop never sees any)
 */
export async function runTask({
  task,
  chat,
  execute,
  tools,
  onEvent = null,
  maxIters = MAX_ITERS,
  vision = false,
  imageBase64 = null,
}) {
  if (typeof task !== "string" || !task.trim()) throw new Error("task text is required");
  if (typeof chat !== "function") throw new Error("chat callable is required");
  if (typeof execute !== "function") throw new Error("execute callable is required");
  if (!Array.isArray(tools) || !tools.length) throw new Error("non-empty tool defs are required");
  const knownNames = new Set(tools.map((t) => t && t.function && t.function.name).filter(Boolean));
  const emit = (event) => {
    try {
      onEvent?.(event);
    } catch {
      // Observers must never break the loop.
    }
  };

  const useVision = vision === true && typeof imageBase64 === "string" && imageBase64.length > 0;
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: useVision ? asImageContent(task, imageBase64) : task },
  ];
  let repairedOnce = false;

  for (let iter = 0; iter < maxIters; iter++) {
    let assistant;
    try {
      assistant = await chat({ messages, tools });
    } catch (err) {
      emit({ type: "error", reason: err?.message || String(err) });
      throw err instanceof Error ? err : new Error(String(err));
    }
    const calls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls.filter(Boolean) : [];
    if (!calls.length) {
      const final = typeof assistant.content === "string" ? assistant.content : "";
      emit({ type: "final", text: final });
      return final;
    }
    messages.push({
      role: "assistant",
      content: typeof assistant.content === "string" ? assistant.content : null,
      tool_calls: calls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c?.function?.name, arguments: c?.function?.arguments },
      })),
    });

    let proceeded = false;
    for (const call of calls) {
      let parsed = parseToolCall(call, knownNames);
      if (!parsed.ok && !repairedOnce) {
        // One honest repair round: tell the model exactly what was wrong.
        repairedOnce = true;
        emit({ type: "repair", detail: parsed.error });
        messages.push({
          role: "user",
          content: `That tool call was invalid: ${parsed.error}. Reply with ONE corrected tool call only.`,
        });
        break;
      }
      if (!parsed.ok) {
        emit({ type: "error", reason: parsed.error });
        throw new Error(parsed.error);
      }
      emit({ type: "tool_call", tool: parsed.name, params: parsed.args });
      let result;
      try {
        result = await execute(parsed.name, parsed.args);
      } catch (err) {
        result = { status: "error", reason: err?.message || String(err) };
      }
      emit({ type: "tool_result", tool: parsed.name, result });
      messages.push({
        role: "tool",
        tool_call_id: parsed.callId || undefined,
        content: JSON.stringify(result),
      });
      proceeded = true;
      // Terminal verdicts end the turn here: denied/timeout/error are data
      // for the final message, never a cue to try something else.
      if (result && (result.status === "denied" || result.status === "timeout" || result.status === "error")) {
        const final = `The ${parsed.name} action ended with status "${result.status}"${result.reason ? `: ${result.reason}` : ""}. Stopping here as instructed.`;
        emit({ type: "final", text: final, terminalStatus: result.status });
        return final;
      }
    }
    if (!proceeded) continue; // repair round re-prompts the model
  }
  const final = "Stopped after the iteration cap without a final answer.";
  emit({ type: "final", text: final, capped: true });
  return final;
}

export const __testing = { SYSTEM_PROMPT, parseToolCall };
