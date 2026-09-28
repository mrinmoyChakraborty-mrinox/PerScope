// src/approval/approval.js
(function() {
  const params = new URLSearchParams(location.search || "");
  const id = params.get("id") || "";
  const set = (nodeId, value) => {
    const node2 = document.getElementById(nodeId);
    if (node2) node2.textContent = value || "\u2014";
  };
  set("f-tool", params.get("tool"));
  const label = params.get("label") || "";
  const text = params.get("text") || "";
  set("f-target", [label, text].filter(Boolean).join(" \u2014 ") || "\u2014");
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
        approved: !!approved
      });
    } catch {
    }
    window.close();
  }
  document.getElementById("approve").addEventListener("click", () => resolve(true));
  document.getElementById("deny").addEventListener("click", () => resolve(false));
  const node = document.getElementById("countdown");
  const deadline = Date.now() + 55e3;
  const timer = setInterval(() => {
    const left = Math.max(0, Math.round((deadline - Date.now()) / 1e3));
    if (node) node.textContent = left > 0 ? `Expires in ${left}s` : "Expired \u2014 closing\u2026";
    if (left <= 0) {
      clearInterval(timer);
      resolve(false);
    }
  }, 500);
})();
;globalThis.__PERSCOPE_BUILD={"commit":"d8072c4","time":"2026-09-28T17:26:47.256Z"};
