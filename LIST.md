# PerScope — Master Task List (LIST.md)

## 0. What this project is (read this first)

**PerScope** is a privacy layer between your browser and AI assistants. The problem it solves:
when you want an AI (Claude, ChatGPT, a coding agent) to help with something on a web page
— say, filling a form on a page that also shows your email, phone number, and ID — the AI
would normally see ALL of it, including your private data. PerScope sits in the middle:
it looks at the page **on your own device**, blacks out (redacts) the sensitive bits,
and only hands the AI the sanitized version. Your raw private data never leaves your machine.

There are **three pieces**, and this task list tracks all three:

1. **The Chrome extension ("v7 beta").** Lives in `extension/v7 beta/`. This is the part
   that actually sees your real pages. It has two powers:
   - *Image pipeline* (working, tested): takes a screenshot, finds faces (BlazeFace),
     reads text (PaddleOCR), detects personal info three ways (AI entity recognition +
     pattern rules + a small vision model called FastVLM), fuses the results, and paints
     black boxes / blur over just the sensitive values on a canvas. All on-device.
   - *DOM capture* (newly working): reads the live web page's text directly (plus form
     fields, labels, placeholders), runs the Tier0 pattern detector over each text
     segment, and returns a redacted copy. Never modifies the page.
2. **The bridge (`bridge/`, published on npm as `@perscope/bridge`).** A small program
   that runs on your computer (not in the browser). Think of it as a receptionist with
   two doors: one door (WebSocket) faces the extension, the other door (MCP protocol,
   over stdio or HTTP) faces AI agents. It makes zero decisions itself — it only passes
   messages (`{id, tool, params}` → response) between the two sides and checks that
   everyone is who they claim to be (pairing codes + secret tokens). AI coding agents
   like Claude Code and OpenCode know how to talk MCP, so the bridge is what lets *your*
   agent drive *your* extension.
3. **The playground (`playground/`).** A test dashboard (a web page) for humans. It plays
   the role an AI agent would play: it sends tool calls through the bridge and shows
   what comes back. It has three sides:
   - *Manual side*: you pick an open browser tab, click tool buttons by hand, and see
     exactly what an AI agent would see in response.
   - *Chat side*: you chat, and a small AI model running locally on your machine
     (via LM Studio or Ollama) does the tool-calling for you — mimicking a real agent.
     This is also the project's required "Server Side Integration" demo: sanitized
     data → local model thinks → model calls tools → results go back to the model.
   - *MCP-show leg*: shows the literal MCP messages a real agent would exchange, so
     anyone can verify the agent path byte-for-byte.

**How a request flows (the one picture to keep in mind):**

```text
Playground (you, or your agent, or the local chat model)
   |  {id, tool, params}  (WebSocket directly, or MCP which the bridge translates)
   v
Bridge (checks your token, forwards, waits up to 60s, relays the answer back)
   |
   v
Extension (runs the pipeline or DOM capture on-device, answers; asks YOU
           Approve/Deny first if the action looks destructive, e.g. Delete)
```

**Key vocabulary used below:**
- *Pairing*: one-time handshake. The bridge shows a 6-digit code; you type it into the
  extension (or playground); the bridge hands back a permanent secret token that is
  stored and sent with every later message. Anyone without the token gets disconnected.
- *Multiplexing*: the bridge talking to several clients at once (extension + Manual
  side + chat model + maybe your real agent) and keeping every answer matched to the
  right asker. Request IDs from different clients can collide, so the bridge swaps in
  its own internal IDs on the extension leg and maps answers back.
- *Blocking confirm flow*: when an action looks destructive, the extension does NOT
  answer immediately — it holds the request open (up to 60 seconds) while a human
  approves/denies, then answers `ok` / `denied` / `timeout`. There is deliberately no
  polling and no push notification; waiting is the whole mechanism.
- *`ref` (not `element_id`)*: how clickable things are named. Old docs and old code say
  `element_id`; the as-built bridge schema says `ref` (+ optional `tabId`). Anything
  still saying `element_id` is targeting a dead schema.
- *Honest errors*: strings like `dom-not-implemented-in-beta`. When the extension
  can't do something yet, it says so explicitly instead of faking data or going silent.
  Tests assert these strings appear — they are proof of honesty, not failures.
- *Fixture*: fake data for developing UI without real hardware/models. Allowed only
  behind an explicit flag, off by default, and it must never fake *decisions*
  (e.g. approve/deny verdicts) — only transport-level shapes.

Statuses: `done` · `ready` (unblocked, not started) · `blocked:decision` · `blocked:work` · `deferred`.

## 1. Decisions register (what the lead has ruled)

| ID | Decision in plain words | Status |
|---|---|---|
| D1 | Programs (playground, agents) prove who they are on the bridge's socket the same way the extension does — pairing code + token — plus a `role:"agent"` label so the bridge can tell callers apart from the extension | approved |
| D2 | The bridge swaps every agent request ID for its own internal ID before asking the extension, so two agents using the same ID can never get each other's answers; duplicates get an immediate error | approved |
| D3 | If the extension is busy (e.g. waiting on your Approve/Deny), a second simultaneous request is rejected instantly with `extension-busy` instead of queuing silently (queuing would stack 60s waits into timeouts) | approved |
| D4 | New `list_tabs` tool so the Manual side can show real open tabs; build it against existing permissions first, add the `tabs` key only if tab titles come back blank | approved |
| D5 | Playground may depend on `@modelcontextprotocol/client@^2.0.0` (same software family the bridge was tested against) | approved |
| D6 | **OPEN:** which local model gates chat-side acceptance — and whether the model must *see* the redacted image (vision, harder) or may reason over text evidence only (easier). Recommendation on file: text-only acceptance, vision explicitly deferred. | **OPEN** |
| D7 | Destructive-action approval pops up a small focused window for beta (no settings-file changes needed); the nicer side-panel UI is long-term work. The chat UI must survive that popup stealing focus mid-conversation. | approved |

## 2. Completed (what's done + how it was proven)

### Bridge package — published
- **What:** the receptionist program described above, published on npm as
  `@perscope/bridge@0.1.0` so anyone can install it. Includes the daemon, the
  agent-connector (`mcp` command: many agents share one bridge, each gets its own
  connection), all 8 tools, the 60-second wait-and-relay behavior, and pairing.
- **Proven by:** `npm view @perscope/bridge` shows it live; `npm test` in `bridge/`
  passes; the tarball installs and runs.

### T1 — Bridge learns to serve many clients — done
- **What:** before this, the bridge assumed whoever connected *was* the extension.
  Now it distinguishes the extension from agent programs, forwards agent requests to
  the extension, and maps each answer back to the right asker (D1 + D2 as approved).
  The dashboard lists every paired program with its role and always shows a usable
  pairing code (a used-up code is immediately replaced).
- **Proven by:** `npm test` in `bridge/` → **22/22 pass**, including 6 new tests in
  `test/agent-mux.test.js` (role-labeled pairing, ID remapping, duplicate-ID
  rejection, two agents sharing one request ID, wrong-role rejection, proof that
  extension-bound calls never leak to agent sockets). No version bump, nothing
  republished — everyone tests against the bridge run from this repo's code
  (`node bridge/bin/cli.js daemon`); `0.2.0` ships only after final acceptance (T9).

### T0 — Playground file naming — done
- **What:** the UI files were named `perscopee.*` while every contract doc calls them
  `playground.*`. Renamed (plus 2 internal references), zero logic changes.
- **Proven by:** searching `playground/` for the old name returns nothing; the page
  still loads byte-identical scripts.

### Extension-side bridge wiring (v7 beta) — done
- **What:** the extension can now talk to the bridge: its always-on background part
  holds the connection (browsers kill sleeping pages' sockets, so it lives where it
  can't be suspended), pairs with a stored token, runs screenshot-redaction when the
  bridge asks (`capture_tab`), answers honestly when asked for things not built yet,
  and shows connection status (icon badge + dashboard card + popup row). A
  danger-detector module ships tested but deliberately unwired (nothing to guard yet).
- **Proven by:** build succeeds; connection/pairing strings verified inside the built
  files; forbidden-import scan clean; step-by-step evidence in
  `extension/v7 beta/BRIDGE-WIRING-LOG.md`. (Two sentences in that log — "no
  permission changes", "no content script" — went stale when DOM work landed after
  it; the log stands as a historical record.)
- **DOM Tier0 capture** landed as parallel work: the extension can now read a live
  page's text, detect personal info per segment with the real detector, and return a
  redacted copy without touching the page — tested with a 449-line test. This is why
  wiring `read_page` to the bridge (T2b below) is now a small mapping job, not a
  research project.

### Docs sync — done
- Root README replaced with the prototype + locked plan; architecture/tool/security/
  limitation/build-order docs aligned. (Some older task files still describe the dead
  push-notification design — tracked separately, not in this list.)

## 3. Ready (ordered — work top to bottom)

### T2b — Plug the existing DOM reader into the bridge — ready, nothing blocks it
- **What/why:** the DOM reader works but only the human popup can reach it; the
  bridge is still told "not implemented." This task connects the two: a bridge
  `read_page` call returns the already-sanitized page text + findings. Changes one
  file (`src/offscreen/offscreen.js`).
- **Done when:** asking the bridge to read the active tab returns sanitized text and
  a findings list, with provably no raw text leaking (checked on the actual message).

### T2 — Playground talks to the bridge over direct socket — ready (T1 done)
- **What/why:** today the playground UI only knows the dead fake server. Point it at
  the real bridge: pair with token, send tool calls, wait up to ~70s for human-gated
  answers, show connection truthfully. Guiding rule: the playground is the *window
  into* PerScope, not a second engine — display / request / observe / visualize only.
- Dual-leg client behind one `callTool`: WS agent leg (`role:"agent"`, T1
  multiplexing) first, MCP HTTP leg (`:7332/mcp`) second. T1 is what makes speaking
  to 7331 legitimate — paired agent role, never an anonymous socket.
- **Open point (flagged, not improvised):** browser→`:7332` fetch is cross-origin
  and the bridge sends no CORS headers today. Either serve the UI same-origin or add
  localhost-only CORS to the bridge (recommend the latter — contained, localhost
  only). Needs a lead nod before T2 implements it.
- **Done when:** with the fake server stopped, Start reaches the bridge; a hand-typed
  screenshot-redaction call shows a real redacted image; killing the bridge program
  turns the dot red with no freezing; no trace of the old push-notification protocol
  remains in the connection code.

### T2a — Retire the fake server — ready
- **What/why:** the program that pretends to be an extension (`:8080`, canned
  answers, home-grown danger check) must stop being the default world, or someone
  will demo fake results as real. Concrete relocation: mock server →
  `playground/mock/`, test clients → `playground/tests/`, frozen (no new features,
  never graft `capture_tab` onto it). UI gets a mode toggle — **Real PerScope
  (default)** vs **Demo/Mock (explicit, development-only)** — so the fallback exists
  without confusing anyone. Fake mode may survive only behind that explicit mode,
  off by default, and must never fake *decisions*.
- **Done when:** normal startup serves nothing canned.

### T7 — Playground pairing screen — ready (T1 + D1 done)
- **What/why:** the playground needs the same one-time code entry the extension has,
  plus a stored token and a status display that tells "bridge is down" apart from
  "not paired yet."
- **Done when:** fresh browser → type code → paired forever across reloads; wrong
  code gives a retryable error; the secret token never appears in any visible panel.

### T3 — Playground speaks the real tool language — ready after T2
- **What/why:** the UI still sends the dead `element_id` dialect and has no
  screenshot button at all. Migrate to `ref`, lengthen timeouts past the 60s human
  window, add the screenshot tool with image + evidence display, and show honest
  "not built yet" errors verbatim instead of hiding them.
- Structure: UI calls a runtime-client module (transport hidden), runtime events
  flow through an event-handler into state, UI renders. Tool metadata
  (`read`/`gated`/`action` badges) lives in a UI-side registry, not in call logic.
  Screen State shows real URL/title/counts/findings (never hardcoded page/element
  text); inspector gains request direction (who→who) and latency from real calls;
  action log records the runtime path (requested → validator verdict → executed).
  Demo/Real mode toggle from T2a applies here too.
- **Done when:** no `element_id` text remains in `playground/`; screenshot renders;
  unbuilt tools display their honest errors; a deliberately 65-second-delayed answer
  still resolves (proves the UI really waits).

### T2c — List clickable elements over the bridge — ready after T2b
- **What/why:** reading text (T2b) isn't enough for an agent — it needs the list of
  buttons/fields with stable names (`ref`s) it can act on later. Derive them from
  the already-captured page segments.
- **Blocker inside the task: the lead must spend 5 minutes confirming the `ref`
  format first (segment number vs page-path vs plain index) — do not guess.**
- **Done when:** repeated listings of an unchanged page return identical `ref`s;
  responses match the bridge's `[{ref, tag, label, role}]` shape; stale names get a
  `stale_element` error.

### T5 — Manual side tab picker — ready after T2
- **What/why:** the Manual side's core promise — "pick a tab you can see, see what
  the agent would see." Start with a hand-typed tab number (works now, no new
  permissions); graduate to the real tab list once D4's `list_tabs` exists.
  Prove-out ladder once execution exists: `scroll` → `type` → `select_option` →
  `click` → `submit`, each against real refs; until T6d lands, gated rungs prove
  honest verdicts/errors instead of executing. Canonical demo scenario: a
  registration form (name/email/country/submit) driven entirely from listed refs.
- **Done when:** the chosen tab's screenshot matches what's on screen, and the raw
  message panes show exactly what an agent gets for the same call.

### T8 (scoped slice) — tests for T2–T5, T2b, T2c only
- **What/why:** repoint the smoke/schema tests at the real bridge and fix the one
  that asserts a self-contradictory expectation (it demands `ok` for a click the
  fake server itself would block).
- **Done when:** green against the real bridge with no fake server in the path,
  including the 65-second-wait case. (Full T8 waits for the chat loop; this slice
  doesn't.) Coverage gates: connection/real-tools/no-fake-data/safety-observability
  (verdicts displayed, never decided)/privacy (sanitized shown, raw never) — the
  action-execution rows stay unchecked until T6d.

### T4 — MCP demonstration leg — approved, lowest priority, free-parallel only
- **What/why:** scripts + a display pane showing the literal MCP messages a real
  agent exchanges, proving the agent path returns byte-identical results to the
  direct-socket path. May be picked up only if it costs the ordered list nothing.

### T1-release — publish bridge `0.2.0` — after T9 only
- Deliberately last: no per-task republishes, so downstream never tests a stale
  published copy by accident.

## 4. Blocked on decisions (do not start)

### T6a — Chat loop, reading + reasoning only
- **What/why:** the heart of the required Server Side Integration demo: user chats →
  local model thinks over sanitized results → calls read-only tools through the
  bridge → answers. Needs T2 built; needs no D6 decision to *build*.
- **Done when:** a scripted task completes on read-only tools; garbled model output
  is repaired/re-asked, provably never forwarded raw; final answer renders in chat.

### T6b — Chat loop, full action-gated version
- Blocked by T6a + approval UI (T6d). **Done when:** a destructive suggestion visibly
  pauses on the extension's human verdict and obeys it.

### T6d — Real actions + approval window
- Blocked by D7 (approved: popup window) + T2c's element names. Wires the tested
  danger-detector in front of every mutating action.
- **Done when:** dangerous clicks hold (≤60s), pop the approval window, resolve
  `ok`/`denied`/`timeout` end-to-end; harmless ones run instantly; identical for
  every caller; **the chat survives the popup stealing focus mid-conversation,
  verified both verdicts.**

### TX — Simultaneous-use rule enforcement
- Blocked by D3 (approved: instant `extension-busy` rejection). Owner: extension
  maintainer (untested shared-GPU behavior makes the exact spot their call).
- **Done when:** with a 60s approval pending, a second caller gets exactly
  `extension-busy`, verified live.

### T9 — Joint final acceptance (lead go/no-go)
- Blocked by everything + D3. **Done when:** on a cold machine, following only the
  written setup order (bridge program → extension paired → playground paired → run),
  the manual screenshot, the chat task, and the MCP demo all pass in one session;
  firing two sides at once behaves per D3; and someone who didn't write the setup
  instructions can execute them.

## 5. Deferred (explicitly out of scope for now)

- **T6, T6d, D6** — chat loop, approval wiring, model pick. Not started, not
  prepped; T2c/T5 must not silently grow to accommodate them.
- Image-to-model adapter ("vision") — named future work, pending the D6 A/B call.
- Side-panel approval UI — the correct long-term home, not the beta path (D7).

## 6. Critical path

Decisions D1/D2 (done) → T1 (done) → **T2b + T2** → T2c/T3/T5 → T8-slice → T9.
D3/D4/D5/D7 decided; D6 open but blocks nothing except chat acceptance.

## 7. External review deltas (two playground plans, read 2026-09-16 — adopted vs rejected)

Adopted into the tasks above: window-not-engine rule; `ref`/`text`/`value`/`direction`/`amount`/`tabId` schema table; keep-list for UI panels; mock relocation paths + freeze + Demo/Real toggle; UI-metadata registry + runtime-event separation; honest screen-state/inspector/log rendering; registration-form demo scenario; harmless-action ladder; DoD coverage gates; demo-state gradual evolution (no big-bang rewrite); lockfile-via-npm-only hygiene.
Rejected with locked-decision grounds: playground collecting/sending approval *decisions* (blocking contract — verdicts are observed, approval lives in the extension's D7 surface); "never point 8080→7331" as an absolute (superseded by T1's paired agent role); capture_tab-last ordering (beta proves capture_tab + read_page first — they're the only runnable tools); any new browser-action/validator implementation in playground code.
Noted gaps the external plans don't cover: the entire chat side (T6 — LM Studio/Ollama loop exists nowhere in those docs; their "agent" is an abstraction); the browser→`:7332` CORS point (T2 open point above); their file tables still say `perscopee.*` (resolved by T0 — follow `playground.*` on disk).
