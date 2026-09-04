# Person 4 — Browser Extension & Automation Engineer (Shritama)

**Scope expanded — standalone task doc exists; this is the summary tracked here.**

## Concrete Tasks

1. **Manifest.** `extension/manifest.json` — MV3, `minimum_chrome_version:"116"`, add `permissions: ["tabs","scripting","offscreen","storage"]` + `host_permissions: ["<all_urls>"]` for Chat Destination & Injection Layer. **Make explicit Firefox decision** (build real `browser_specific_settings.gecko` or document Chrome-first).

2. **WebSocket client.** `extension/background/background.js` — now multiplexes **three** connection types (Playground, Bridge, Reasoning Server) on same schema `{id,tool,params}`; no branching per caller; test against all three; 20s keepalive.

3. **Route `list_interactive_elements`.** `background.js` → `offscreen.js` (3 extractors → tiered → plan → deterministic redaction → self-audit) → response. You are the router; reflect stages in loading-state UI.

4. **Action validator.** `isDestructive()` in `background.js` — unchanged logic, now gates Reasoning Server actions identically. Same pending map (`pending_id` → 60s timeout) for all callers.

5. **Popup Capture flow (high-priority, was "lowest priority")** — `extension/popup/popup.html` + `popup.js`:
   - Tab selector (defaults to current tab) + **Capture** button (not Analyze).
   - Live progress: `page captured → text extracted → sensitive detected → sanitizing` with persistent *“Everything stays on this device.”* + `Privacy protected ✓`.
   - **Capture Review** (required before send): **Visual view** (screenshot with masked regions) + **Context view** (structured sanitized JSON with `[PERSON]`/`[EMAIL]` placeholders). States: **Clean** ("No sensitive info detected" ≠ "0 redacted"), **Ambiguous/low-confidence** (fail-closed, review), **Blocked** (cannot sanitize, no send).
   - Stats: count/type redacted.
   - **Send** (inject to chat input only, safer default) vs **Send & Submit** (inject+submit, explicit opt-in).
   - Destination: auto-detect open AI-chat tabs (ChatGPT/Claude/Gemini) + manual pick.

6. **Chat Destination & Injection Layer (new).** `extension/content/chat-adapters/` — tab discovery for known chat UIs, 2–3 per-site adapters (input-box selectors), execution via `content.js` `chrome.scripting`/`tabs.sendMessage`, clipboard fallback for unsupported destinations. Wrapped sanitized content inside explanatory header so target AI understands placeholders.

7. **Dashboard + Side Panel.** `extension/dashboard/` (Privacy Log: per-capture source, count/type, destination, redacted-only storage, Clear All; Security Log: blocked+confirm outcomes) + `extension/sidepanel/` (live view + Approve/Deny prompt). Privacy Log entries now read as **captures**, not raw events.

8. **Prompt-injection demo path.** Staged page with hidden white-on-white instruction targeting destructive action — must be **blocked by same validator** regardless of caller; narrate it.

## Files

- `extension/manifest.json`
- `extension/background/background.js`
- `extension/offscreen/offscreen.html`, `offscreen.js`
- `extension/content/content.js` + `chat-adapters/*.js`
- `extension/popup/*`, `extension/sidepanel/*`, `extension/dashboard/*`

## Permissions Disclosure

`tabs` + `scripting` increase is real — disclose in pitch and README, not silently added.
