/**
 * PerScope Playground code-copy buttons — additive clipboard helper.
 *
 * Adds a small Copy button to long-lived code blocks (.raw-json,
 * .inspector-content). Blocks are never re-created by playground.js (only
 * their textContent changes), so buttons are attached once. Confirmation
 * goes through the toast module when present.
 */
(function () {
  function copyText(value, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(
        function () { done(true); },
        function () { done(false); }
      );
      return;
    }
    try {
      var ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      done(true);
    } catch (err) {
      done(false);
    }
  }

  function attach(block) {
    if (!block || block.querySelector(".pg-copy-btn")) return;
    block.classList.add("pg-copyable");
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pg-copy-btn";
    btn.textContent = "Copy";
    btn.setAttribute("aria-label", "Copy block contents");
    btn.addEventListener("click", function () {
      // Clone minus the button itself so its label never lands in the copy.
      var clone = block.cloneNode(true);
      var stray = clone.querySelector(".pg-copy-btn");
      if (stray) stray.remove();
      copyText(clone.innerText || clone.textContent || "", function (ok) {
        if (ok) {
          btn.textContent = "Copied";
          setTimeout(function () { btn.textContent = "Copy"; }, 1500);
          if (window.PGToast) window.PGToast.show("Copied to clipboard.", "success");
        } else if (window.PGToast) {
          window.PGToast.show("Copy failed in this browser.", "error");
        }
      });
    });
    block.appendChild(btn);
  }

  function init() {
    document.querySelectorAll(".raw-json, .inspector-content").forEach(attach);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
