/**
 * PerScope Playground composer autosize — additive chat helper.
 *
 * Grows #chat-input with content up to a cap, then scrolls internally.
 * Send behavior (Enter vs Shift+Enter) stays entirely in playground.js.
 */
(function () {
  var MAX_HEIGHT = 160;

  function init() {
    var input = document.getElementById("chat-input");
    if (!input) return;
    function fit() {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, MAX_HEIGHT) + "px";
      input.style.overflowY = input.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
    }
    input.addEventListener("input", fit);
    fit();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
