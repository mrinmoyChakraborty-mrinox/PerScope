/**
 * PerScope Playground log filter — additive event-table helper.
 *
 * Filters rendered `.event-row`s by status level + free-text search.
 * playground.js rebuilds #event-log via innerHTML on every event, so a
 * MutationObserver re-applies the filter after each render. Filtering only
 * toggles row display; the underlying demoState.events are untouched.
 */
(function () {
  function init() {
    var log = document.getElementById("event-log");
    var level = document.getElementById("log-level");
    var search = document.getElementById("log-search");
    var count = document.getElementById("log-count");
    if (!log || !level || !search) return;

    function apply() {
      var lv = level.value;
      var q = search.value.trim().toLowerCase();
      var shown = 0;
      var total = 0;
      log.querySelectorAll(".event-row").forEach(function (row) {
        total++;
        var statusEl = row.querySelector(".event-status");
        var status = statusEl ? statusEl.textContent.trim().toLowerCase() : "";
        var text = row.textContent.toLowerCase();
        var hit = (!lv || status === lv) && (!q || text.indexOf(q) !== -1);
        row.style.display = hit ? "" : "none";
        if (hit) shown++;
      });
      if (count) count.textContent = total ? shown + " / " + total : "";
    }

    level.addEventListener("change", apply);
    search.addEventListener("input", apply);
    search.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        search.value = "";
        apply();
      }
    });

    if (window.MutationObserver) {
      new MutationObserver(apply).observe(log, { childList: true });
    }
    apply();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
