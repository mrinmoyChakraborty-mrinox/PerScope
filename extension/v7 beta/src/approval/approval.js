/**
 * D7 approval popup (T6d). Extension page opened by the service worker via
 * chrome.windows.create({type:"popup"}). Renders the proposed action from
 * URL params, resolves exactly once via APPROVAL_RESOLVE, then closes
 * itself. Closing without deciding = deny (the worker's onRemoved treats
 * an unresolved close as fail-closed, so this page never approves by
 * accident — but it still sends an explicit deny for a clean audit trail).
 */
(function () {
  const params = new URLSearchParams(location.search || "");
  const id = params.get("id") || "";
  const set = (nodeId, value) => {
    const node = document.getElementById(nodeId);
    // textContent only: label/text are live page strings, never HTML.
    if (node) node.textContent = value || "—";
  };
  set("f-tool", params.get("tool"));
  const label = params.get("label") || "";
  const text = params.get("text") || "";
  set("f-target", [label, text].filter(Boolean).join(" — ") || "—");
  set("f-reasons", (params.get("reasons") || "").split(";").filter(Boolean).join(", "));

  let resolved = false;
  function resolve(approved) {
    if (resolved || !id) return;
    resolved = true;
    try {
      chrome.runtime.sendMessage({
        target: "background",
        action: "APPROVAL_RESOLVE",
        id,
        approved: !!approved,
      });
    } catch {}
    window.close();
  }

  document.getElementById("approve").addEventListener("click", () => resolve(true));
  document.getElementById("deny").addEventListener("click", () => resolve(false));

  // Countdown mirrors the worker's 55s window; expiry is enforced
  // worker-side, this display is informational only.
  const node = document.getElementById("countdown");
  const deadline = Date.now() + 55000;
  const timer = setInterval(() => {
    const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    if (node) node.textContent = left > 0 ? `Expires in ${left}s` : "Expired — closing…";
    if (left <= 0) {
      clearInterval(timer);
      resolve(false);
    }
  }, 500);
})();
