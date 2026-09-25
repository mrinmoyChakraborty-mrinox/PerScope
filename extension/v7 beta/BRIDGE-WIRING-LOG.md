# v7 Beta — Bridge Wiring Log (extension side)

Date: 2026-09-16. Owner: extension maintainer. Status: code complete, build-verified.
Live-Chrome load test + bridge round-trip are the remaining manual steps (§4).

DOM is **deferred, not skipped**: no `content.js` exists in this beta by design
decision (README §7.3 Phase 1 comes later). All DOM tools answer explicitly.

## 1. What was built

| # | File | Change |
|---|---|---|
| 1 | `src/offscreen/bridge-link.js` (new, ~260 lines) | WS client to `ws://127.0.0.1:7331` (const `BRIDGE_WS_URL`). Pair/hello handshake, per-message `auth` attach, `{id,tool,params}` dispatch, exp backoff 1s→30s+jitter, reconnect-forever. **Housed in offscreen, not SW** — MV3 workers suspend ~30s and kill sockets |
| 2 | `src/offscreen/offscreen.js` | `RUN_PIPELINE` body refactored into `runPipelineJob()` shared by popup + bridge (no divergent logic). `handleBridgeTool()`: `capture_tab` → active-tab capture via SW + full pipeline → `{status:"ok", redactedImage, evidence, …}`; DOM tools → `{status:"error", reason:"dom-not-implemented-in-beta"}`; `tabId` targeting → `tab-targeting-requires-tabs-permission`; unknown → `unknown-tool:*`. `BRIDGE_STATUS`/`BRIDGE_PAIR` control plane |
| 3 | `src/background/service-worker.js` | `BRIDGE_STATUS` / `BRIDGE_PAIR` relay (SW owns no sockets), `BRIDGE_STATUS_UPDATE` → action badge: green paired / orange reachable-unpaired / grey+empty otherwise. All failures degrade; Human Mode paths untouched |
| 4 | `src/app/dashboard.html` + `dashboard.js` + `dashboard.css` | "Bridge Connection" sidebar card: status pill (5s poll), 6-digit code field + Pair button, sticky result line |
| 5 | `src/popup/popup.html` + `popup.js` + `popup.css` | Bridge status row in settings panel (queried on popup open) |
| 6 | `src/shared/is-destructive.js` (new) + `tests/is-destructive.test.mjs` | First-pass heuristic as a pure, tested module. **Not wired to live actions** (none exist yet). Caller-agnostic by construction — takes no caller input |
| 7 | (env) `npm install` in `v7 beta/` | Tooling was missing (`esbuild` not installed); installed per lockfile + patches applied |

Manifest: `host_permissions` widened from huggingface-only to `<all_urls>` (Site access → "On all sites"), so bridge-triggered capture/scripting works without a user gesture — `activeTab` alone only covers user-invoked flows. No new permission *keys*. `tabs` + `scripting` keys are still Final scope.

## 2. Evidence

- `node --test tests/is-destructive.test.mjs` → **5/5 pass**.
- `npm run build` → SUCCESS, all 4 bundles. `dist/offscreen.js` contains `BRIDGE_WS_URL`, `dom-not-implemented-in-beta`, `tab-targeting-requires-tabs-permission`; `dist/background.js` contains `BRIDGE_STATUS*` + `setBadgeText`; `dist/dashboard.js/html` + `dist/popup.js` contain the pairing UI hooks.
- Forbidden-import scan (`node:fs/path`, `onnxruntime-node`, `sharp`, `process.exit`) over all 4 bundles → **CLEAN**.
- `npm run check` → fails pre-existing at `models/blazeface/blaze.onnx` — `models/` does not exist in this checkout (weights never downloaded here); unrelated to this change.
- Wire-contract cross-check vs `bridge/src/ws-server.js`: extension sends `{type:"pair",code}` / `{type:"hello",auth}` / `{id,tool,params,auth}`; bridge expects exactly those shapes. Port `7331` matches `PERSCOPE_BRIDGE_PORT`.

## 3. Coordination answers locked with bridge dev (done, no open items)

Port `7331` ✓ · envelope `{id,tool,params}` **plus top-level `auth`** (differs from task text §2/§4 — this is the as-built contract) ✓ · handshake pair→paired/hello→welcome/pair-error ✓ · token in `chrome.storage.local` (`perscope.bridgeToken`) ✓.

## 4. Manual steps remaining (needs Chrome, not doable headless here)

1. `chrome://extensions` → load unpacked → `dist/` (slim; big models first-run download).
2. Terminal: `npx @perscope/bridge daemon` → copy 6-digit code → dashboard card → Pair → pill shows "Connected + paired", badge turns green. Reload extension → still paired (storage) without re-entering.
3. Kill daemon → badge grey, popup row "not running", popup capture still works (Human Mode unaffected). Restart daemon → auto-reconnect (no re-pair).
4. With mock MCP client: `capture_tab` → redacted PNG + evidence; `read_page` → `dom-not-implemented-in-beta`; `click` with `ref` → same (gate arrives with content.js).
5. Confirm no console errors from bridge-link during a full popup pipeline run (shared `runPipelineJob` regression check).

## 5. Known limitation (state honestly)

`capture_tab` on CPU/WASM can exceed the bridge 60s ceiling → bridge synthesizes `{status:"timeout"}` while the pipeline still runs. Beta: document + demo on WebGPU. A real fix (async jobs) breaks the locked blocking contract — Final discussion.

## 6. Final scope (explicitly NOT this beta)

- `content.js` (TreeWalker extraction + form values + aria/label/placeholder/name context; action execution with framework-safe input events; `data-perscope-ref` scheme) — needs `scripting` permission + `chrome.scripting.executeScript` on-demand injection.
- Real routing for `read_page` / `list_interactive_elements` / `click` / `type` / `select_option` / `submit` / `scroll`; `tabId` targeting (needs `tabs` permission).
- Wire `isDestructive()` in front of every mutating action + blocking Approve/Deny UI (side-panel-vs-popup-window decision open — beta has neither surface).
- `isDestructive()` list refinement; timeout mitigation (§5); reconnection edge cases under load.
