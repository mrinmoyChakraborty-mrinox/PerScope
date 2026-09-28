/**
 * PerScope Playground tools filter — additive sidebar helper.
 *
 * Filters the static `.tool-row` list by name substring as you type.
 * Hiding rows never breaks playground.js: it matches rows by first-child
 * text and still updates hidden rows harmlessly. Escape clears.
 */
(function () {
  function init() {
    var input = document.getElementById("tool-filter");
    var panel = document.querySelector(".tools-panel");
    if (!input || !panel) return;
    var heading = panel.querySelector("h3");
    var baseHeading = heading ? heading.textContent : "Tools";
    var total = panel.querySelectorAll(".tool-row").length;

    var empty = document.createElement("div");
    empty.className = "tool-filter-empty";
    empty.textContent = "No tools match.";
    empty.style.display = "none";
    panel.appendChild(empty);

    function apply() {
      var q = input.value.trim().toLowerCase();
      var shown = 0;
      panel.querySelectorAll(".tool-row").forEach(function (row) {
        var name = ((row.children[0] && row.children[0].textContent) || "").trim().toLowerCase();
        var hit = !q || name.indexOf(q) !== -1;
        row.style.display = hit ? "" : "none";
        if (hit) shown++;
      });
      empty.style.display = shown === 0 ? "" : "none";
      if (heading) heading.textContent = q ? "Tools (" + shown + "/" + total + ")" : baseHeading;
    }

    input.addEventListener("input", apply);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        input.value = "";
        apply();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
