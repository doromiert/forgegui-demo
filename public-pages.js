(function () {
  "use strict";

  function syncList(input) {
    var target = document.getElementById(input.dataset.listTarget);
    if (!target) return;
    var query = input.value.trim().toLowerCase();
    var visible = 0;

    target.querySelectorAll("[data-search-item]").forEach(function (item) {
      var matchesSearch = !query || item.dataset.searchItem.includes(query);
      var matchesFilters = true;

      if (target.id === "jobs-grid") {
        document.querySelectorAll("[data-job-filter]").forEach(function (filter) {
          var value = filter.value;
          if (value !== "any" && item.dataset[filter.dataset.jobFilter] !== value) {
            matchesFilters = false;
          }
        });
      }

      var show = matchesSearch && matchesFilters;
      item.hidden = !show;
      if (show) visible += 1;
    });

    var empty = target.parentElement.querySelector("[data-list-empty]");
    if (empty) empty.hidden = visible !== 0;
  }

  document.addEventListener("input", function (event) {
    if (event.target.matches("[data-list-search]")) syncList(event.target);
  });

  document.addEventListener("change", function (event) {
    if (!event.target.matches("[data-job-filter]")) return;
    var search = document.querySelector('[data-list-target="jobs-grid"]');
    if (search) syncList(search);
  });

  document.addEventListener("click", function (event) {
    var button = event.target.closest("[data-summarize]");
    if (!button) return;
    var summary = button.parentElement.querySelector(".articleSummary");
    if (!summary) return;
    var expanded = summary.hidden;
    summary.hidden = !expanded;
    button.setAttribute("aria-expanded", String(expanded));
    button.lastChild.textContent = expanded ? " Hide AI Summary" : " Summarize with AI";
  });
})();
