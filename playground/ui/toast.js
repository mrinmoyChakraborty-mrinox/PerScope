/**
 * PerScope Playground toasts — additive, non-blocking feedback.
 *
 * Loaded as a classic script BEFORE the playground module, so
 * `window.PGToast` exists by the time playground.js runs. playground.js
 * mirrors notable `addUIEvent` outcomes (error / warning / success) here;
 * the Logs page event table remains the record of truth.
 */
(function () {
  var MAX_VISIBLE = 3;
  var TTL = { error: 6000, warning: 5000, success: 3500, info: 3500 };

  function ensureHost() {
    var host = document.getElementById("pg-toasts");
    if (!host) {
      host = document.createElement("div");
      host.id = "pg-toasts";
      host.className = "pg-toasts";
      host.setAttribute("aria-live", "polite");
      document.body.appendChild(host);
    }
    return host;
  }

  function show(message, type) {
    var kind = type === "error" || type === "warning" || type === "success" ? type : "info";
    var host = ensureHost();
    while (host.children.length >= MAX_VISIBLE) {
      host.removeChild(host.firstChild);
    }
    var el = document.createElement("div");
    el.className = "pg-toast pg-toast-" + kind;
    el.setAttribute("role", "status");

    var dot = document.createElement("span");
    dot.className = "pg-toast-dot";
    dot.setAttribute("aria-hidden", "true");

    var text = document.createElement("span");
    text.className = "pg-toast-text";
    text.textContent = String(message);

    var close = document.createElement("button");
    close.className = "pg-toast-close";
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss notification");
    close.textContent = "\u00D7";
    close.addEventListener("click", function () {
      el.remove();
    });

    el.appendChild(dot);
    el.appendChild(text);
    el.appendChild(close);
    host.appendChild(el);

    setTimeout(function () {
      el.classList.add("pg-toast-out");
      setTimeout(function () {
        el.remove();
      }, 250);
    }, TTL[kind] || 3500);
  }

  window.PGToast = { show: show };
})();
