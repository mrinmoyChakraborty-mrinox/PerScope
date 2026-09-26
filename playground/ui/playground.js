/* =========================================================
   PERSCOPE PLAYGROUND
   UI CONTROLLER
========================================================= */

import {
    demoState,
    addEvent,
    updatePage,
    updateTool,
    setNextAction,
    setLatency
} from "../js/demo/demo-state.js";

import {
    createRuntimeClient,
    DEFAULT_BRIDGE_URL,
} from "./runtime-client.js";

import {
    createModelClient,
    PROVIDER_PRESETS,
    FORWARDER_DEFAULT_URL,
} from "./model-client.js";

import {
    runTask,
    fetchMcpTools,
} from "./agent-loop.js";


/* =========================================================
   CONFIGURATION
========================================================= */

let serverUrl = DEFAULT_BRIDGE_URL;
let requestCounter = 0;
let requestStartTime = 0;

// Single transport instance. There is intentionally no heartbeat:
// the bridge has no ping handler, and an unauthenticated {type:"ping"}
// frame would get this socket closed as unauthorized (ws-server rejects
// anything that is not pair/hello/authed). Liveness = socket state.
const runtime = createRuntimeClient({
    url: serverUrl,
    onStatus: (status) => {
        if (status.connected && status.paired) {
            updateServerStatus(true, "Connected + paired", true);
        } else if (status.connected) {
            updateServerStatus(true, "Reachable, not paired", false);
        } else {
            updateServerStatus(false, "Disconnected", false);
        }
    },
});

/* =========================================================
   DOM HELPERS
========================================================= */

const $ = (id) => document.getElementById(id);


/* =========================================================
   ELEMENTS
========================================================= */

const rawJsonToggle = $("raw-json-toggle");
const rawJson = $("raw-json");
const structuredState = $("structured-screen-state");



const privacyDetails =
    $("privacy-details");

const eventLog =
    $("event-log");


const themeToggle =
    $("theme-toggle");

const toolRequest =
    $("tool-request");

const toolResponse =
    $("tool-response");

const agentReasoning =
    $("agent-reasoning");

/* =========================================================
   CHAT PLAYGROUND
   ========================================================= */

const chat = $("chat");

const chatInput =
    $("chat-input");

const chatSend =
    $("chat-send");

const chatStatus =
    $("chat-status");

const thinkingCard =
    $("thinkingCard");


const wsUrl =
    $("ws-url");

const wsConnect =
    $("ws-connect");

const wsDisconnect =
    $("ws-disconnect");

const wsStatus =
    $("ws-status");
// No heartbeat by design (see runtime-client note above): the bridge
// closes sockets on unauthenticated frames, so pinging would disconnect
// us. Connection liveness comes from the socket itself.
/* =========================================================
   BRIDGE CONNECTION (via runtime-client)
========================================================= */

function connectToServer() {

    const current = runtime.getStatus();
    if (current.connected) {
        return;
    }


    const url =
        wsUrl?.value.trim();

    if (!url) {

        console.error(
            "[UI] WebSocket URL is empty"
        );

        return;
    }


    serverUrl = url;


    console.log(
        `[UI] Connecting to ${serverUrl}...`
    );


    updateServerStatus(
        false,
        "Connecting..."
    );


    runtime.connect(serverUrl).then(
        (status) => {

            console.log(
                "[UI] Connected to bridge"
            );


            addEvent(
                status.paired
                    ? "Connected to bridge (paired)"
                    : "Connected to bridge (not paired — enter a pairing code)",
                status.paired ? "success" : "warning",
                "Playground"
            );

        },
        (error) => {

            console.error(
                "[UI] Bridge connection failed:",
                error
            );


            addUIEvent(
                "Bridge connection failed: " +
                    (error?.message || error),
                "error",
                "Playground"
            );


            updateServerStatus(
                false,
                "Disconnected"
            );

        }
    );


}

//closeWebSocket()
function closeWebSocket() {

    const current = runtime.getStatus();

    if (!current.connected) {

        updateServerStatus(
            false,
            "Disconnected"
        );

        return;
    }


    console.log(
        "[UI] Closing bridge connection..."
    );


    runtime.disconnect();


    updateServerStatus(
        false,
        "Disconnected"
    );

}
/* =========================================================
   SERVER STATUS
========================================================= */

function updateServerStatus(
    connected,
    label = null,
    paired = false
) {

    /*
     * -----------------------------------------
     * NEW WS STATUS CONTROL
     * -----------------------------------------
     */

    if (wsStatus) {

        wsStatus.classList.toggle(
            "connected",
            connected
        );

        wsStatus.classList.toggle(
            "paired",
            connected && paired
        );

    }


    // Settings-panel label mirrors the same live state (never hardcoded).
    const connectionLabels =
        document.querySelectorAll(
            ".connection-label"
        );


    connectionLabels.forEach(
        (node) => {

            node.textContent =
                label ||
                (
                    connected
                        ? "Connected"
                        : "Disconnected"
                );

        }
    );


    if (wsStatus) {

        const statusRow =
            wsStatus.parentElement;

        if (statusRow) {

            const text =
                statusRow.querySelector(
                    "span:last-child"
                );

            if (text) {

                text.textContent =
                    label ||
                    (
                        connected
                            ? "Connected"
                            : "Disconnected"
                    );

            }

        }

    }


    /*
     * -----------------------------------------
     * EXISTING HEADER STATUS
     * -----------------------------------------
     */

    const statusCards =
        document.querySelectorAll(
            ".status-card"
        );


    if (statusCards.length < 2) {
        return;
    }


    const serverCard =
        statusCards[1];


    const statusText =
        serverCard.querySelector(
            "strong"
        );


    const dot =
        serverCard.querySelector(
            ".status-dot"
        );


    if (connected) {

        statusText.textContent =
            "Connected";

        statusText.style.color =
            "var(--green)";

        dot.classList.add(
            "green"
        );

    } else {

        statusText.textContent =
            "Disconnected";

        statusText.style.color =
            "var(--red)";

        dot.classList.remove(
            "green"
        );

    }

}


/* =========================================================
   SEND TOOL REQUEST
========================================================= */

function sendRequest(tool, params = {}) {

    return new Promise(
        (resolve, reject) => {

            const bridge = runtime.getStatus();

            if (!bridge.connected) {

              const message =
    "Bridge is not connected. Click Start first.";

addUIEvent(
    message,
    "error",
    "Playground"
);

reject(
    new Error(message)
);

                return;
            }


            if (!bridge.paired) {

              const message =
    "Bridge is reachable but not paired. Enter the pairing code first.";

addUIEvent(
    message,
    "error",
    "Playground"
);

reject(
    new Error(message)
);

                return;
            }


            requestCounter++;

            const request = {

                id:
                    `req_${String(requestCounter).padStart(3, "0")}`,

                tool,

                params

            };


            requestStartTime =
                performance.now();

            /* Show request */

            showToolRequest(request);


            console.log(
                "[UI → BRIDGE]",
                request
            );


            // Blocking call through the runtime client: resolves with the
            // extension's terminal response (ok / denied / timeout / error).
            // There is no push step after this — approval happens in the
            // extension, and its verdict arrives here.
            runtime.callTool(tool, params).then(
                (response) => {

                    const latency =
                        Math.round(
                            performance.now() -
                            requestStartTime
                        );


                    setLatency(latency);

                    showLatency(latency);

                    showToolResponse(response);

/* -----------------------------------------
   TOOL ERROR
----------------------------------------- */

if (response.status === "error") {

    addEvent(
        `Tool error: ${response.reason || "unknown_error"}`,
        "error",
        "Bridge"
    );

    reject(
        new Error(
            response.reason || "Tool request failed"
        )
    );

    return;
}

/* -----------------------------------------
   TERMINAL VERDICTS (blocking contract)
----------------------------------------- */

if (
    response.status === "denied" ||
    response.status === "timeout"
) {

    console.warn(
        "[ACTION NOT EXECUTED]",
        response
    );


    addUIEvent(
        response.status === "denied"
            ? "Validator: action denied (human decision in extension)"
            : "Validator: action timed out waiting for approval",
        "blocked",
        "Extension Validator"
    );

    updateValidatorUI(
        "BLOCKED",
        response.status === "denied"
            ? "The action was denied and not executed"
            : "No approval within 60s — not executed"
    );


    if (chatStatus) {

        chatStatus.textContent =
            response.status === "denied"
                ? "Action denied"
                : "Approval timed out";

    }


    resolve(response);

    return;
}


if (response.status === "ok") {

    updateValidatorUI(
        "SAFE",
        "Action executed"
    );

}


/* -----------------------------------------
   NORMAL RESPONSE
----------------------------------------- */

// Record as the latest tool traffic so Screen State, privacy details,
// and the inspector render from real data on every path (manual buttons
// and chat alike), not just the chat flow.
updateTool(tool, request, response);
updatePrivacySummary();

resolve(response);

                },
                (error) => {

                    addEvent(
                        `Transport error: ${error?.message || error}`,
                        "error",
                        "Bridge"
                    );

                    reject(error instanceof Error ? error : new Error(String(error)));

                }
            );
        }
    );

}
/* =========================================================
   ACTION APPROVAL
   ========================================================= */
/* =========================================================
   ACTION VERDICTS (blocking contract)
   =========================================================
   Deleted: handleActionUpdate (action_update push) and sendActionDecision
   (action_decision sender). The bridge holds each gated call open until
   the extension answers ok / denied / timeout, so verdicts arrive as the
   terminal response inside sendRequest — there is nothing to push and
   nowhere to send a decision. Approval itself happens in the extension. */
/* =========================================================
   APPROVAL UI
   =========================================================
   Deleted: showApprovalRequest (Approve/Deny card + action_decision
   senders). Under the blocking contract there is no pending_id to act
   on — approval happens in the extension's own UI, and the verdict
   arrives as the terminal tool response handled in sendRequest. */
/* =========================================================
   TOOL REQUEST DISPLAY
========================================================= */

function showToolRequest(request) {

    toolRequest.textContent =
        JSON.stringify(
            request,
            null,
            4
        );

}


/* =========================================================
   TOOL RESPONSE DISPLAY
========================================================= */

function showToolResponse(response) {

    toolResponse.textContent =
        JSON.stringify(
            response,
            null,
            4
        );

}
 /* =========================================================
   CHAT MESSAGES
   ========================================================= */

function addChatMessage(
    message,
    type = "agent"
) {

    if (!chat) {
        return;
    }

    const messageElement =
        document.createElement("div");

    messageElement.className =
        `chat-message ${type}`;

    messageElement.textContent =
        message;

    chat.appendChild(
        messageElement
    );

    const chatWrap =
        $("chatWrap");

    if (chatWrap) {

        chatWrap.scrollTop =
            chatWrap.scrollHeight;

    }

}

/* =========================================================
   CHAT PROCESS TRACE
   ========================================================= */

function setChatStep(step, state = "active") {

    const node =
        document.querySelector(
            `.process-node[data-step="${step}"]`
        );

    if (!node) {
        return;
    }

    node.classList.remove(
        "active",
        "done",
        "error",
        "blocked"
    );

    node.classList.add(state);
}
function resetChatProcess() {

    const nodes =
        document.querySelectorAll(
            ".process-node"
        );

    nodes.forEach(
        (node) => {

            node.classList.remove(
                "active",
                "done",
                "error",
                "blocked"
            );

        }
    );

}
function showThinkingCard() {

    if (!thinkingCard) {
        return;
    }

    thinkingCard.classList.remove(
        "hidden"
    );

}


function hideThinkingCard() {

    if (!thinkingCard) {
        return;
    }

    thinkingCard.classList.add(
        "hidden"
    );

}
function handleToolResponseError(
    tool,
    response
) {

    if (!response) {

        addUIEvent(
            `${tool} no_response`,
            "error",
            "Server"
        );

        throw new Error(
            `${tool} no_response`
        );
    }

    if (response.status !== "ok") {

        const reason =
            response.reason ||
            response.status ||
            "unknown_error";

        addUIEvent(
            `${tool} ${reason}`,
            "error",
            "Server"
        );

        if (chatStatus) {
            chatStatus.textContent =
                "Error";
        }

        const activeNode =
            document.querySelector(
                ".process-node.active"
            );

        if (activeNode) {
            activeNode.classList.remove(
                "active"
            );

            activeNode.classList.add(
                "error"
            );
        }

        throw new Error(
            `${tool}: ${reason}`
        );
    }

    return response;
}
/* =========================================================
   CHAT TASK
   ========================================================= */

async function runChatTask(task) {

    if (!task.trim()) {
        return;
    }

    const bridgeState = runtime.getStatus();

    if (!bridgeState.connected) {

        addChatMessage(
            "Bridge is not connected. Click Start first.",
            "agent"
        );

        return;
    }


    if (!bridgeState.paired) {

        addChatMessage(
            "Bridge is reachable but not paired. Enter the pairing code first.",
            "agent"
        );

        return;
    }


    /* -----------------------------------------
       USER MESSAGE
    ----------------------------------------- */

    addChatMessage(
        task,
        "user"
    );


    /* -----------------------------------------
       PREPARE UI
    ----------------------------------------- */

    chatInput.value = "";

    chatSend.disabled = true;
if (chatStatus) {

    chatStatus.textContent =
        "Thinking...";

}

    resetChatProcess();
    setNextAction(
    "Waiting for agent..."
);

updateNextActionUI(
    "-",
    "-"
);
    showThinkingCard();


    /* -----------------------------------------
       AGENTIC LOOP (real model, real tools)
    -----------------------------------------
       Replaces (deleted 2026-09-16): keyword task routing, hardcoded
       reasoning strings, scripted el_8 action, delay-simulated thinking,
       and the "Local sanitization complete" event that fired without
       runtime evidence. Everything below is event-driven by runTask
       (agent-loop.js): the configured provider reasons, executes through
       runtime.callTool, and the UI renders each event. */

    try {

    setChatStep(
        "perception",
        "active"
    );
    if (chatStatus) {

        chatStatus.textContent =
            "Reasoning with model...";

    }

    addUIEvent(
        "Chat task received",
        "success",
        "User"
    );

    if (agentReasoning) {
        agentReasoning.textContent =
            "Reasoning via model…";
    }

    let loopTools;
    try {
        loopTools = await fetchMcpTools();
    } catch (err) {
        throw new Error(
            "Could not load tool definitions from the bridge: " +
            (err?.message || err)
        );
    }

    const providerConfig = modelClient.getConfig();
    let loopImage = null;
    if (providerConfig.vision) {
        try {
            const captureSrc = $("capture-img")?.src || "";
            const marker = "base64,";
            const at = captureSrc.indexOf(marker);
            if (at >= 0) loopImage = captureSrc.slice(at + marker.length);
        } catch {
            loopImage = null;
        }
    }

    const loopFinal = await runTask({
        task,
        chat: (args) => modelClient.chatCompletions(args),
        execute: (tool, params) => runtime.callTool(tool, params),
        tools: loopTools,
        vision: providerConfig.vision,
        imageBase64: loopImage,
        onEvent: (event) => {
            if (!event || typeof event !== "object") return;
            if (event.type === "tool_call") {
                showToolRequest({ tool: event.tool, params: event.params });
                if (
                    event.tool === "read_page" ||
                    event.tool === "list_interactive_elements" ||
                    event.tool === "capture_tab" ||
                    event.tool === "list_tabs"
                ) {
                    setChatStep("perception", "done");
                    if (chatStatus) chatStatus.textContent = "Perceiving…";
                } else {
                    setChatStep("acting", "active");
                    setNextAction(`Execute ${event.tool}`);
                    updateNextActionUI(event.tool, event.params?.ref || "—");
                    if (chatStatus) chatStatus.textContent = "Acting…";
                }
            } else if (event.type === "tool_result") {
                const result = event.result || {};
                showToolResponse(result);
                updateTool(event.tool, { tool: event.tool }, result);
                if (result.status === "denied" || result.status === "timeout") {
                    updateValidatorUI(
                        "BLOCKED",
                        result.status === "denied"
                            ? "Denied in the extension — not executed"
                            : "Approval timed out in the extension — not executed"
                    );
                } else if (
                    result.status === "ok" &&
                    event.tool !== "read_page" &&
                    event.tool !== "list_interactive_elements" &&
                    event.tool !== "capture_tab" &&
                    event.tool !== "list_tabs"
                ) {
                    updateValidatorUI("SAFE", "Action executed");
                }
                if (Array.isArray(result.findings) || Array.isArray(result.elements) || result.redactedImage) {
                    if (!demoState.currentPage) {
                        updatePage({ title: "(active tab)", summary: "sanitized context received" });
                    }
                    renderScreenState();
                    setChatStep("redacting", "done");
                }
                updatePrivacySummary();
            } else if (event.type === "repair") {
                addUIEvent("Repairing malformed tool call: " + (event.detail || ""), "warning", "Agent");
                if (agentReasoning) agentReasoning.textContent = "Repairing malformed tool call…";
            } else if (event.type === "error") {
                addUIEvent("Loop error: " + (event.reason || ""), "error", "Agent");
            }
        },
    });

    setChatStep("reasoning", "done");
    setChatStep("acting", "done");
    setChatStep("done", "done");

    addChatMessage(loopFinal || "(no answer)", "agent");

    if (chatStatus) {

        chatStatus.textContent =
            "Complete";

    }


    } catch (error) {

        console.error(
            "[CHAT] Task failed:",
            error
        );


        addChatMessage(
            `Task failed: ${error.message}`,
            "agent"
        );


        const activeNode =
            document.querySelector(
                ".process-node.active"
            );


        if (activeNode) {

            activeNode.classList.remove(
                "active"
            );

            activeNode.classList.add(
                "error"
            );

        }


        if (chatStatus) {

            chatStatus.textContent =
                "Error";

        }

    } finally {

        chatSend.disabled =
            false;

    }

}
/* =========================================================
   CHAT CONTROLS
   ========================================================= */

function setupChat() {

    if (!chatInput || !chatSend) {
        console.warn(
            "[CHAT] Chat elements not found."
        );

        return;
    }


    chatSend.addEventListener(
        "click",
        () => {

            runChatTask(
                chatInput.value
            );

        }
    );


    chatInput.addEventListener(
        "keydown",
        (event) => {

            /*
             * Enter = send
             * Shift + Enter = new line
             */

            if (
                event.key === "Enter" &&
                !event.shiftKey
            ) {

                event.preventDefault();

                runChatTask(
                    chatInput.value
                );

            }

        }
    );

}
/* =========================================================
   LATENCY
========================================================= */

function showLatency(ms) {

    const latencyElement =
        document.getElementById(
            "latency-value"
        );

    if (!latencyElement) {
        return;
    }

    latencyElement.textContent =
        `Latency: ${ms} ms`;

}
/* =========================================================
   EVENT LOG
========================================================= */


   function addUIEvent(
    message,
    status = "info",
    source = "Playground"
) {
    addEvent(
        message,
        status,
        source
    );

    renderEventLog();
}


function renderEventLog() {

    eventLog.innerHTML = "";


    if (
        !demoState.events ||
        demoState.events.length === 0
    ) {

        return;

    }


    demoState.events.forEach(
        (event) => {

            const row =
                document.createElement("div");

            row.className =
                "event-row";


            const time =
                new Date(
                    event.timestamp
                ).toLocaleTimeString(
                    [],
                    {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit"
                    }
                );


            const statusText =
                event.status || "success";


            row.innerHTML = `

                <span>
                    ${time}
                </span>

                <span>
                    ${event.message}
                </span>

                <span>
                    ${event.source || "Agent"}
                </span>

                <span class="event-status">
                    ${statusText}
                </span>

                <span>
                    —
                </span>

            `;


            eventLog.appendChild(row);

        }
    );


    const autoScroll =
        $("auto-scroll");


    if (
        autoScroll &&
        autoScroll.checked
    ) {

        eventLog.parentElement.scrollTop =
            eventLog.parentElement.scrollHeight;

    }

}


/* =========================================================
   SCREEN STATE
========================================================= */

function renderScreenState() {

    const page =
        demoState.currentPage;


    if (!page) {
        return;
    }


    const summary =
        document.querySelectorAll(
            ".state-summary strong"
        );


    if (summary.length >= 3) {

        summary[0].textContent =
            page.title || "Unknown Page";

        summary[1].textContent =
            page.summary || "Unknown state";

    }


    const table =
        document.querySelector(
            ".elements-table"
        );


    if (
        !table ||
        !demoState.lastResponse
    ) {
        return;
    }


    const lastResponse = demoState.lastResponse;
    const elements =
        lastResponse.elements || lastResponse.result?.elements;


    if (!elements) {
        return;
    }


    const header =
        table.querySelector(
            ".table-header"
        );


    table.innerHTML = "";

    table.appendChild(header);


    elements.forEach(
        (element) => {

            const row =
                document.createElement("div");

            row.className =
                "table-row";

            // Real bridge shape is {ref, tag, label, role}. Everything here
            // is live page text, so escape it — never innerHTML raw strings.
            const escape = (value) =>
                String(value ?? "—").replace(/[&<>"']/g, (c) => (
                    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
                ));

            row.innerHTML = `

                <span>
                    ${escape(element.ref)}
                </span>

                <span>
                    ${escape(element.tag)}
                </span>

                <span>
                    ${escape(element.label)}
                </span>

                <span>
                    ${escape(element.role)}
                </span>

                <span>
                    —
                </span>

            `;


            table.appendChild(row);

        }
    );

}


/* =========================================================
   CAPTURE RESULT (capture_tab rendering)
   ========================================================= */

function renderCaptureResult(response) {

    const view = $("capture-view");
    const img = $("capture-img");
    const meta = $("capture-meta");

    if (!view || !img || !meta) {
        return;
    }

    if (response && response.redactedImage) {
        img.src =
            "data:image/png;base64," + response.redactedImage;

        const evidence = response.evidence || {};
        const count = Array.isArray(evidence.findings)
            ? evidence.findings.length
            : "—";

        meta.textContent =
            `Redacted image + evidence (${count} findings` +
            (response.totalTimeMs != null ? `, ${response.totalTimeMs} ms` : "") +
            ")";

        view.classList.remove("hidden");
    }

    addUIEvent(
        "capture_tab returned redacted image + evidence",
        "success",
        "Bridge"
    );

}


const captureTabButton = $("capture-tab-btn");
if (captureTabButton) {
    captureTabButton.addEventListener("click", () => {
        sendRequest("capture_tab", {}).then(
            (response) => {
                renderCaptureResult(response);
            },
            (error) => {
                addUIEvent(
                    "capture_tab failed: " + (error?.message || error),
                    "error",
                    "Playground"
                );
            }
        );
    });
}

/* =========================================================
   MANUAL SIDE (T5: tab picker + generic tool sender)
   =========================================================
   Results land in the Tool inspector through sendRequest, byte-identical
   to what an agent sees on the same call. */

function refreshManualTabs() {
    sendRequest("list_tabs", {}).then(
        (response) => {
            const picker = $("manual-tab-picker");
            if (!picker) return;
            const current = picker.value;
            picker.innerHTML = "";
            const active = document.createElement("option");
            active.value = "";
            active.textContent = "Active tab";
            picker.appendChild(active);
            for (const tab of response.tabs || []) {
                const option = document.createElement("option");
                option.value = String(tab.tabId);
                const label = tab.title || tab.url || `Tab ${tab.tabId}`;
                option.textContent = `${tab.active ? "● " : ""}${label}`.slice(0, 60);
                picker.appendChild(option);
            }
            if (current) picker.value = current;
            if (typeof response.titlesAvailable === "boolean") {
                addUIEvent(
                    response.titlesAvailable
                        ? `Tab list: ${response.tabs.length} tab(s), titles populated`
                        : "Tab list has BLANK titles/URLs — D4 fallback (tabs permission) may be needed",
                    response.titlesAvailable ? "success" : "warning",
                    "Playground"
                );
            }
        },
        (error) => {
            addUIEvent(
                "Tab list failed: " + (error?.message || error),
                "error",
                "Playground"
            );
        }
    );
}

const manualRefreshButton = $("manual-refresh-tabs");
if (manualRefreshButton) {
    manualRefreshButton.addEventListener("click", refreshManualTabs);
}

const manualSendButton = $("manual-send");
if (manualSendButton) {
    manualSendButton.addEventListener("click", () => {
        const toolEl = $("manual-tool");
        const paramsEl = $("manual-params");
        const pickerEl = $("manual-tab-picker");
        const tool = toolEl?.value || "";
        if (!tool) return;
        let params;
        try {
            params = paramsEl && paramsEl.value.trim() ? JSON.parse(paramsEl.value) : {};
        } catch {
            addUIEvent("Params are not valid JSON.", "error", "Playground");
            return;
        }
        if (tool !== "list_tabs" && pickerEl && pickerEl.value !== "") {
            const tabId = Number(pickerEl.value);
            if (Number.isInteger(tabId)) params = { ...params, tabId };
        }
        sendRequest(tool, params).then(
            () => {},
            (error) => {
                addUIEvent(
                    `${tool} failed: ` + (error?.message || error),
                    "error",
                    "Playground"
                );
            }
        );
    });
}

/* =========================================================
   MODEL PROVIDER (chat-side backend config)
   =========================================================
   Config persists like the bridge token (localStorage, values never
   rendered or logged — status lines and events carry mode + outcome
   only, never URLs, names-as-secrets, or keys). Cloud mode is present
   but unwired pending the D8 key-handling decision. */

const modelClient = createModelClient();

function refreshModelForm() {
    const config = modelClient.getConfig();
    const modeEl = $("model-mode");
    const endpointEl = $("model-endpoint");
    const nameEl = $("model-name");
    const visionEl = $("model-vision");
    const statusEl = $("model-status");
    if (modeEl) modeEl.value = config.mode;
    if (endpointEl && document.activeElement !== endpointEl) endpointEl.value = config.baseUrl;
    if (nameEl && document.activeElement !== nameEl) nameEl.value = config.model;
    if (visionEl) visionEl.checked = config.vision;
    if (statusEl) {
        statusEl.textContent = config.model
            ? `${config.mode} · ${config.model}${config.hasKey ? " · key stored" : ""}`
            : "Not configured.";
    }
}

function readModelForm() {
    const modeEl = $("model-mode");
    const endpointEl = $("model-endpoint");
    const nameEl = $("model-name");
    const keyEl = $("model-key");
    const visionEl = $("model-vision");
    const mode = modeEl?.value || "lmstudio";
    const next = {
        mode,
        baseUrl: endpointEl?.value.trim() || "",
        model: nameEl?.value.trim() || "",
        vision: !!visionEl?.checked,
    };
    // Cloud keys NEVER enter model-client storage: they travel exactly once,
    // straight to the forwarder's /config, and the field is cleared right
    // after. Everything afterwards is keyless from the page's perspective.
    let forwarderKey = null;
    if (mode === "cloud") {
        if (keyEl && keyEl.value) forwarderKey = keyEl.value;
    } else if (keyEl && keyEl.value) {
        // Local/custom modes talk loopback directly; empty still preserves.
        next.apiKey = keyEl.value;
    }
    return { blocked: false, next, forwarderKey };
}

const modelModeEl = $("model-mode");
if (modelModeEl) {
    modelModeEl.addEventListener("change", () => {
        const mode = modelModeEl.value;
        if (mode === "lmstudio" || mode === "ollama") {
            modelClient.setConfig({
                mode,
                baseUrl: PROVIDER_PRESETS[mode].baseUrl,
            });
        } else if (mode === "cloud") {
            const current = modelClient.getConfig();
            modelClient.setConfig({
                mode,
                baseUrl: current.baseUrl || FORWARDER_DEFAULT_URL,
            });
        } else {
            modelClient.setConfig({ mode });
        }
        refreshModelForm();
    });
}

const modelSaveButton = $("model-save");
if (modelSaveButton) {
    modelSaveButton.addEventListener("click", async () => {
        const read = readModelForm();
        // Cloud round-trip first: key goes to the forwarder and nowhere
        // else; a failed save aborts before anything is persisted locally.
        if (read.forwarderKey) {
            const base = (read.next.baseUrl || "").replace(/\/+$/, "");
            if (!base) {
                addUIEvent("Cloud save needs the forwarder endpoint first.", "error", "Playground");
                return;
            }
            try {
                const res = await fetch(`${base}/config`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ apiKey: read.forwarderKey, model: read.next.model || undefined }),
                });
                if (!res.ok) throw new Error(`forwarder answered HTTP ${res.status}`);
                const keyEl = $("model-key");
                if (keyEl) keyEl.value = "";
                addUIEvent("Cloud key saved on the local forwarder.", "success", "Playground");
            } catch (err) {
                addUIEvent("Cloud key save failed: " + (err?.message || err), "error", "Playground");
                return;
            }
        }
        const config = modelClient.setConfig(read.next);
        const keyEl = $("model-key");
        if (keyEl) keyEl.value = "";
        refreshModelForm();
        addUIEvent(`Model config saved (${config.mode}).`, "success", "Playground");
    });
}

const modelTestButton = $("model-test");
if (modelTestButton) {
    modelTestButton.addEventListener("click", async () => {
        const statusEl = $("model-status");
        if (statusEl) statusEl.textContent = "Testing…";
        try {
            const res = await modelClient.testConnection();
            const detail = res.models.length
                ? ` — ${res.models.length} model(s) listed`
                : "";
            const config = modelClient.getConfig();
            if (statusEl) statusEl.textContent = `Reachable (${config.mode})${detail}.`;
            addUIEvent(`Model reachable (${config.mode})${detail}.`, "success", "Playground");
        } catch (err) {
            const config = modelClient.getConfig();
            if (statusEl) statusEl.textContent = "Unreachable — check endpoint, CORS, model name.";
            addUIEvent(
                `Model unreachable (${config.mode}): ` + (err?.message || err),
                "error",
                "Playground"
            );
        }
    });
}

refreshModelForm();

/* =========================================================
   RAW JSON
========================================================= */

function updateRawJSON() {

    const payload = {

        url:
            demoState.currentPage?.url || "",

        title:
            demoState.currentPage?.title || "",

        summary:
            demoState.currentPage?.summary || "",

        elements:
            demoState.lastResponse?.result
                ?.elements || []

    };


    rawJson.textContent =
        JSON.stringify(
            payload,
            null,
            4
        );

}


/* =========================================================
   NEXT ACTION
========================================================= */

function updateNextActionUI(
    tool = "-",
    elementId = "-"
) {

    if (!demoState.nextAction) {
        return;
    }

    // -----------------------------
    // Action title
    // -----------------------------

    const actionTitle =
        document.querySelector(
            ".next-action h3"
        );

    if (actionTitle) {

        actionTitle.textContent =
            demoState.nextAction;

    }


    // -----------------------------
    // Tool + Element information
    // -----------------------------

    const actionTags =
        document.querySelectorAll(
            ".next-action .action-tags span"
        );

    if (actionTags.length >= 2) {

        actionTags[0].textContent =
            `Tool: ${tool}`;

        actionTags[1].textContent =
            `Element: ${elementId}`;    

    }

}

/* =========================================================
   VALIDATOR UI
========================================================= */

function updateValidatorUI(
    status,
    message
) {

    const validator =
        document.querySelector(
            ".validator > strong"
        );

    const validatorMessage =
        document.querySelector(
            ".validator > small"
        );


    if (validator) {

        validator.textContent =
            status;


        if (status === "BLOCKED") {

            validator.style.color =
                "var(--red)";

        } else if (status === "SAFE") {

            validator.style.color =
                "var(--green)";

        }

    }


    if (validatorMessage) {

        validatorMessage.textContent =
            message;

    }

}

/* =========================================================
   PRIVACY DETAILS
========================================================= */

function updatePrivacySummary() {

    if (!privacyDetails) {
        return;
    }

    const last = demoState.lastResponse || {};
    const findings = Array.isArray(last.findings)
        ? last.findings
        : Array.isArray(last.result?.findings)
            ? last.result.findings
            : null;
    const elements = Array.isArray(last.elements)
        ? last.elements
        : Array.isArray(last.result?.elements)
            ? last.result.elements
            : null;

    const content = privacyDetails.querySelector(".privacy-detail-content");
    if (!content) {
        return;
    }

    const escape = (value) =>
        String(value ?? "").replace(/[&<>"']/g, (c) => (
            { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
        ));

    if (findings && findings.length) {
        const counts = {};
        for (const finding of findings) {
            const type = finding && finding.type ? String(finding.type) : "UNKNOWN";
            counts[type] = (counts[type] || 0) + 1;
        }
        content.innerHTML =
            "<strong>Sanitized payload</strong><p>" +
            Object.entries(counts)
                .map(([type, count]) => `${escape(type)}: ${count}`)
                .join("<br>") +
            "</p>";
    } else if (elements) {
        content.innerHTML =
            "<strong>Sanitized payload</strong><p>" +
            `${elements.length} interactive element(s), values already redacted.</p>`;
    } else {
        content.innerHTML =
            "<strong>Sanitized payload</strong><p>No findings yet — run a tool.</p>";
    }

    privacyDetails.open = false;

}


/* =========================================================
   TOOL STATE
========================================================= */

function updateToolUI(
    tool,
    request,
    response
) {

    updateTool(
        tool,
        request,
        response
    );


    const toolRows =
        document.querySelectorAll(
            ".tool-row"
        );


    toolRows.forEach(
        (row) => {

            const name =
                row.children[0]
                    ?.textContent
                    ?.trim();


            if (
                name === tool
            ) {

                const status =
                    row.querySelector(
                        ".tool-status"
                    );


               if (status) {

    const gatedTools = [
        "click",
        "type",
        "submit",
        "select_option"
    ];

    if (gatedTools.includes(tool)) {

        status.textContent =
            "Gated";

        status.className =
            "tool-status gated";

    } else {

        status.textContent =
            "Active";

        status.className =
            "tool-status read";

    }

}

            }

        }
    );

}

/* =========================================================
   RESET VISUAL STATE
========================================================= */

function resetVisualState() {

    updateValidatorUI(
        "SAFE",
        "This action is allowed"
    );
    const latencyElement =
    document.getElementById(
        "latency-value"
    );

if (latencyElement) {

    latencyElement.textContent =
        "Latency: —";

}
    demoState.events = [];


    addEvent(
        "Session started",
        "success",
        "Playground"
    );


    renderEventLog();

}

/* =========================================================
   RAW JSON BUTTON
========================================================= */

function toggleRawJSON() {

    const showingRaw =
        !rawJson.classList.contains(
            "hidden"
        );


    if (showingRaw) {

        rawJson.classList.add(
            "hidden"
        );

        structuredState.classList.remove(
            "hidden"
        );

        rawJsonToggle.textContent =
            "View Raw JSON";

    } else {

        updateRawJSON();

        structuredState.classList.add(
            "hidden"
        );

        rawJson.classList.remove(
            "hidden"
        );

        rawJsonToggle.textContent =
            "View Screen State";

    }

}

/* =========================================================
   THEME
========================================================= */

function toggleTheme() {

    document.body.classList.toggle(
        "light-theme"
    );


    const light =
        document.body.classList.contains(
            "light-theme"
        );


    themeToggle.textContent =
        light ? "☀" : "☾";

}


/* =========================================================
   INSPECTOR TABS
========================================================= */

function setupInspectorTabs() {

    const tabs =
        document.querySelectorAll(
            ".inspector-tab"
        );


    tabs.forEach(
        (tab) => {

            tab.addEventListener(
                "click",
                () => {

                    tabs.forEach(
                        (item) => {

                            item.classList.remove(
                                "active"
                            );

                        }
                    );


                    tab.classList.add(
                        "active"
                    );


                    const selected =
                        tab.dataset.tab;


                    document
                        .querySelectorAll(
                            ".inspector-content"
                        )
                        .forEach(
                            (content) => {

                                content.classList.add(
                                    "hidden"
                                );

                            }
                        );


                    const target =
                        $(selected);


                    if (target) {

                        target.classList.remove(
                            "hidden"
                        );

                    }

                }
            );

        }
    );

}


/* =========================================================
   SIDEBAR NAVIGATION
========================================================= */

function setupNavigation() {

    const navItems =
        document.querySelectorAll(
            ".nav-item"
        );


    navItems.forEach(
        (item) => {

            item.addEventListener(
                "click",
                () => {

                    navItems.forEach(
                        (nav) => {

                            nav.classList.remove(
                                "active"
                            );

                        }
                    );


                    item.classList.add(
                        "active"
                    );


                    const section =
                        item.dataset.section;


                    navigateToSection(
                        section
                    );

                }
            );

        }
    );

}


/* =========================================================
   NAVIGATION LOGIC
========================================================= */

function navigateToSection(section) {
    const settingsPanel =
        $("settings");

    /* Main dashboard sections */

    if (
        section === "playground"
    ) {

        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });

        return;

    }
    if (
        section === "screen-state"
    ) {

        scrollToElement(
            $("screen-state")
        );

        return;

    }


    if (
        section === "action-logs"
    ) {

        scrollToElement(
            $("action-logs")
        );

        return;

    }

    if (
        section === "settings"
    ) {

        settingsPanel.classList.remove(
            "hidden"
        );

        scrollToElement(
            settingsPanel
        );

        return;

    }

}


/* =========================================================
   SCROLL HELPER
========================================================= */

function scrollToElement(element) {

    if (!element) {
        return;
    }


    element.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });

}
/* =========================================================
   BUTTON EVENTS
========================================================= */

function setupButtons() {

    rawJsonToggle.addEventListener(
        "click",
        toggleRawJSON
    );


    
    themeToggle.addEventListener(
        "click",
        toggleTheme
    );

  wsConnect.addEventListener(
    "click",
    connectToServer
);


wsDisconnect.addEventListener(
    "click",
    closeWebSocket
);


// Bridge pair-error reasons are machine strings ("incorrect", "expired",
// "locked", "missing-code"); translate each into what to do next. Expired
// and locked both rotate the code server-side, so retrying the same code
// can never succeed — the user must fetch a fresh one.
function pairFailureHint(reason) {
    switch (reason) {
        case "incorrect":
            return "incorrect code — retype it by hand (no pasted spaces). 5 misses lock pairing for 60s.";
        case "expired":
            return "code expired or already used (each pairing mints a fresh one) — fetch a new code from the bridge dashboard and use it immediately.";
        case "locked":
            return "too many attempts — wait 60s, fetch a fresh code from the bridge dashboard, enter it once.";
        case "missing-code":
            return "empty code reached the bridge — retype it into the code field.";
        case "no-connection":
            return "no connection — click Start and retry.";
        case "timeout":
            return "bridge didn't answer in 8s — check the daemon is alive and retry.";
        default:
            return reason + " — retry.";
    }
}

const wsPairButton = $("ws-pair");
if (wsPairButton) {
    wsPairButton.addEventListener("click", async () => {
        const codeEl = $("ws-pair-code");
        // Trim: pasted codes routinely carry trailing whitespace/newlines,
        // which fail the bridge's constant-time compare as "incorrect" and
        // burn one of the 5 lockout attempts per try.
        const code = (codeEl?.value || "").trim();
        if (!code) {
            addUIEvent(
                "Pair needs a code first — paste it without spaces.",
                "warning",
                "Playground"
            );
            return;
        }
        wsPairButton.disabled = true;
        // Pairing needs a live socket; connect first instead of failing
        // with a bare "no-connection" when Start wasn't clicked.
        if (!runtime.getStatus().connected) {
            const url = wsUrl?.value.trim() || serverUrl;
            addUIEvent("Pairing with bridge… (connecting first)", "info", "Playground");
            try {
                serverUrl = url;
                await runtime.connect(serverUrl);
            } catch (err) {
                addUIEvent(
                    "Pair failed: bridge unreachable (" + (err?.message || err) + ") — click Start and retry.",
                    "error",
                    "Playground"
                );
                wsPairButton.disabled = false;
                return;
            }
            if (!runtime.getStatus().connected) {
                addUIEvent(
                    "Pair failed: no connection — click Start and retry.",
                    "error",
                    "Playground"
                );
                wsPairButton.disabled = false;
                return;
            }
        } else {
            addUIEvent("Pairing with bridge…", "info", "Playground");
        }
        try {
            const res = await runtime.pair(code);
            if (res?.ok) {
                addUIEvent("Paired. Token stored for reconnects.", "success", "Playground");
                if (codeEl) codeEl.value = "";
            } else {
                addUIEvent(
                    "Pair failed: " + pairFailureHint(res?.reason || "unknown"),
                    "error",
                    "Playground"
                );
            }
        } catch (err) {
            addUIEvent(
                "Pair failed: " + (err?.message || err),
                "error",
                "Playground"
            );
        } finally {
            wsPairButton.disabled = false;
        }
    });
}

    

}


/* =========================================================
   INITIALIZE
========================================================= */

function initialize() {

    console.log(
        "================================"
    );

    console.log(
        "PERSCOPE PLAYGROUND UI"
    );

    console.log(
        "================================"
    );


    setupInspectorTabs();

    setupNavigation();

    setupButtons();
    setupChat();  
    if (toolRequest) {
    toolRequest.textContent =
        "Waiting for tool request...";
}

if (toolResponse) {
    toolResponse.textContent =
        "Waiting for tool response...";
}
    updatePrivacySummary();

    renderEventLog();
updateServerStatus(
    false,
    "Disconnected"
);

}
initialize();