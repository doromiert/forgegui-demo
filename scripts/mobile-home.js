(function () {
    "use strict";

    var shell = document.querySelector(".mobile-home-shell");
    var drawer = document.querySelector(".mobile-home-drawer");
    var closeButton = document.querySelector(".mobile-drawer-close");
    var scrollContainer = document.querySelector("[data-home-scroll]");
    var topbar = document.querySelector(".mobile-home-topbar");

    if (!shell || !drawer || !scrollContainer || !topbar) return;

    function setDrawer(open) {
        shell.classList.toggle("is-drawer-open", open);
        drawer.setAttribute("aria-hidden", String(!open));
        document.querySelectorAll("[data-open-drawer]").forEach(function (button) {
            button.setAttribute("aria-expanded", String(open));
        });
        if (open && closeButton) closeButton.focus();
    }

    document.querySelectorAll("[data-open-drawer]").forEach(function (button) {
        button.addEventListener("click", function () {
            setDrawer(true);
        });
    });

    document.querySelectorAll("[data-close-drawer]").forEach(function (button) {
        button.addEventListener("click", function () {
            setDrawer(false);
        });
    });

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") setDrawer(false);
    });

    scrollContainer.addEventListener("scroll", function () {
        topbar.classList.toggle("is-scrolled", scrollContainer.scrollTop > 20);
    });

    var scrollTools = document.querySelector("[data-scroll-tools]");
    if (scrollTools) {
        scrollTools.addEventListener("click", function () {
            document.getElementById("mobile-quick-tools").scrollIntoView({ behavior: "smooth" });
        });
    }

    document.querySelectorAll("[data-gallery-direction]").forEach(function (button) {
        button.addEventListener("click", function () {
            var track = button.closest(".mobile-tool-section").querySelector(".mobile-tool-track");
            track.scrollBy({
                left: Number(button.dataset.galleryDirection) * 316,
                behavior: "smooth",
            });
        });
    });
})();
