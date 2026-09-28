/**
 * PerScope Playground keyboard shortcuts — additive navigation helper.
 *
 * - "/" focuses the chat composer (unless already typing)
 * - "1".."6" activate the sidebar pages in order (synthetic clicks, so the
 *   existing nav handlers, persistence and rendering run unchanged)
 * - "t" toggles the light/dark theme
 * - "Escape" blurs the composer / clears filters handled by their owners
 * Never fires while typing in an input, textarea or select, and never with
 * Ctrl/Cmd/Alt held (leaves browser shortcuts alone).
 */
(function () {
  var PAGE_ORDER = ["chat", "manual-model", "screen-state", "agent-input", "logs", "settings"];

  function isTyping(target) {
    return !!target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
  }

  function navItemFor(section) {
    var items = document.querySelectorAll(".nav-item");
    for (var i = 0; i < items.length; i++) {
      if (items[i].dataset && items[i].dataset.section === section) return items[i];
    }
    return null;
  }

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.target)) return;

    if (e.key === "/") {
      var input = document.getElementById("chat-input");
      if (input) {
        e.preventDefault();
        input.focus();
      }
      return;
    }

    if (e.key === "t" || e.key === "T") {
      var toggle = document.getElementById("theme-toggle");
      if (toggle) toggle.click();
      return;
    }

    var n = parseInt(e.key, 10);
    if (n >= 1 && n <= PAGE_ORDER.length) {
      var item = navItemFor(PAGE_ORDER[n - 1]);
      if (item) item.click();
    }
  }

  document.addEventListener("keydown", onKey);
})();
