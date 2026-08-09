(function () {
    "use strict";

    var activeEditor = null;

    function closeEditor() {
        if (!activeEditor) return;
        activeEditor.hidden = true;
        activeEditor = null;
    }

    document.querySelectorAll("[data-settings-open]").forEach(function (button) {
        button.addEventListener("click", function () {
            activeEditor = document.querySelector('[data-settings-editor="' + button.dataset.settingsOpen + '"]');
            if (!activeEditor) return;
            activeEditor.hidden = false;
            var input = activeEditor.querySelector("input");
            if (input) input.focus();
        });
    });

    document.querySelectorAll("[data-settings-close]").forEach(function (button) {
        button.addEventListener("click", closeEditor);
    });

    document.querySelectorAll(".mobile-settings-editor form").forEach(function (form) {
        form.addEventListener("submit", function (event) {
            event.preventDefault();
            var password = form.querySelector("[data-new-password]");
            var confirmation = form.querySelector("[data-confirm-password]");
            if (password && confirmation && password.value !== confirmation.value) {
                confirmation.setCustomValidity("Passwords must match");
                confirmation.reportValidity();
                return;
            }
            closeEditor();
        });
    });

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") closeEditor();
    });

    var copyButton = document.querySelector("[data-copy-referral]");
    if (copyButton) {
        copyButton.addEventListener("click", function () {
            var link = document.querySelector(".mobile-referral-link").textContent;
            if (navigator.clipboard) navigator.clipboard.writeText(link);
            copyButton.textContent = "Copied";
        });
    }

})();
