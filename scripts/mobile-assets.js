(function () {
    "use strict";

    function installSearch(input, container) {
        if (!input || !container) return;

        input.addEventListener("input", function () {
            var query = input.value.trim().toLowerCase();
            container.querySelectorAll("[data-search-item]").forEach(function (item) {
                item.hidden = query !== "" && !item.dataset.searchItem.includes(query);
            });
        });
    }

    installSearch(
        document.querySelector("[data-project-search]"),
        document.querySelector(".mobile-project-list"),
    );
    installSearch(
        document.querySelector("[data-community-search]"),
        document.querySelector(".mobile-community-grid"),
    );
})();
