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

### T2b — read_page over the bridge — done
- **What:** offscreen route maps the existing SW Tier0 capture to `{sanitizedText,
  findings}` (allowlisted fields via pure `read-page-mapping.js`); `tabId` variant
  errors pending D4.
- **Proven by:** 4 mapping tests (raw-text/locator exclusion asserted on the wire
  object); live-Chrome verification outstanding (manual).

### T2 — Playground WS leg — done
- **What:** new `ui/runtime-client.js` (paired agent role, hello re-auth, 70s
  blocking calls, close-rejects-pending, no push code); UI drives Start/Stop,
  pairing, send, and chat guard through it; heartbeat deleted (would get the
  socket closed as unauthorized).
- **Proven by:** live harness vs real daemon + mock extension (`T2-VERIFY-ALL-PASS`:
  pair, capture roundtrip with own id and no token leak, 3s blocking hold,
  token persistence, daemon-death settle + status flip).

### T2a — Mock retirement — done
- **What:** mock server → `playground/mock/` (DEMO-ONLY banner, frozen); test
  clients → `playground/tests/`; `npm start` serves static UI only, `npm run mock`
  is the explicit path.
- **Proven by:** explicit mock boot + moved smoke client passes; `npm start`
  cannot reach mock code by construction.

### T7 — Pairing UI — done
- **What:** three-state dot (red/orange/green), code entry with in-flight guard,
  token confined to transport closure + storage.
- **Proven by:** stub-socket harness asserting exact D1 frames (`pair`/`hello`
  byte-for-byte, `{ok:true}` carrying no token, wrong-code reason); `T7-VERIFY-ALL-PASS`.

### T3 — Dialect, timeouts, capture rendering — done
- **What:** zero `element_id` in UI; Screen State capture button + base64/evidence
  renderer; honest errors displayed verbatim.
- **Proven by:** grep-empty dialect; render harness on shipped code (img src, meta,
  unhide, event, button wiring); 65s verdict resolving at 65.0s inside the 70s
  ceiling (`T3-VERIFY-ALL-PASS`).

### T2c — list_interactive_elements with registry refs (format C) — done
- **What:** `src/content/refs.js` (opaque `el_N` per page load, deterministic
  re-list, live re-resolution, `stale_element` only on genuine mismatch);
  entry `LIST_ELEMENTS` + SW relay + offscreen route with wire allowlist.
- **Proven by:** 10 `content-refs` tests incl. DOM-mutation proofs (remove→stale,
  label/unrelated edits→resolve, tag/id swap→stale, read-only); full extension
  suite 51/51; shipped bundle confirmed `import.meta`-free.

### T5 — Manual tab picker (real list_tabs) — done
- **What:** bridge `list_tabs` (9th tool) + SW `chrome.tabs.query` relay with
  `titlesAvailable` in-band probe + offscreen route + UI picker/generic sender.
- **Proven by:** bridge 22/22 (9-name listing); live relay harness both D4
  branches; UI IDs wired both sides; build SUCCESS with routes in `dist/`.
  Empirical titles verdict still needs one live-browser Refresh (reported in-band).

### T8 (scoped slice) — done
- **What:** `playground/tests/{transport,schema}.test.mjs` vs real daemon (no
  mock in path); old mock-bound scripts deleted; `npm test` wired.
- **Proven by:** `npm test` in `playground/` → **8/8 pass** (roundtrip, honest
  error as data, delayed terminal verdict, daemon-death settle; contract shapes
  for all 9 tools; destructive click asserts `denied`, explicitly not `ok` —
  the old self-contradiction fixed with its flaw documented in-test).

## 3. Ready (ordered — work top to bottom)

All T2–T8-slice items are done (see §2 for what + proof). Remaining, in order:

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

Decisions D1–D5, D7 decided (D6 open, blocks chat acceptance only) → T0–T8-slice
done → T9 pending T6/T6d/TX. Outstanding manual checks: T2b live read_page,
`list_tabs` titles verdict.

## 7. External review deltas (two playground plans, read 2026-09-16 — adopted vs rejected)

Adopted into the tasks above: window-not-engine rule; `ref`/`text`/`value`/`direction`/`amount`/`tabId` schema table; keep-list for UI panels; mock relocation paths + freeze + Demo/Real toggle; UI-metadata registry + runtime-event separation; honest screen-state/inspector/log rendering; registration-form demo scenario; harmless-action ladder; DoD coverage gates; demo-state gradual evolution (no big-bang rewrite); lockfile-via-npm-only hygiene.
Rejected with locked-decision grounds: playground collecting/sending approval *decisions* (blocking contract — verdicts are observed, approval lives in the extension's D7 surface); "never point 8080→7331" as an absolute (superseded by T1's paired agent role); capture_tab-last ordering (beta proves capture_tab + read_page first — they're the only runnable tools); any new browser-action/validator implementation in playground code.
Noted gaps the external plans don't cover: the entire chat side (T6 — LM Studio/Ollama loop exists nowhere in those docs; their "agent" is an abstraction); the browser→`:7332` CORS point (T2 open point above); their file tables still say `perscopee.*` (resolved by T0 — follow `playground.*` on disk).
