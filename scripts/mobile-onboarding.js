(function () {
    "use strict";

    var steps = Array.from(document.querySelectorAll("[data-onboarding-step]"));
    var progress = document.querySelector(".mobile-progress");
    var nextButton = document.querySelector("[data-next-step]");
    var currentStep = 0;

    if (!steps.length || !progress || !nextButton) return;

    steps.forEach(function () {
        progress.appendChild(document.createElement("fg-carouselstep"));
    });

    function showStep(index) {
        currentStep = Math.max(0, Math.min(index, steps.length - 1));

        steps.forEach(function (step, stepIndex) {
            step.hidden = stepIndex !== currentStep;
            if (stepIndex === currentStep) step.scrollTop = 0;
        });

        progress.setAttribute(
            "aria-label",
            "Step " + (currentStep + 1) + " of " + steps.length,
        );
        Array.from(progress.children).forEach(function (dot, dotIndex) {
            dot.classList.toggle("active", dotIndex === currentStep);
        });
        nextButton.textContent = currentStep === 6 ? "Skip..." : currentStep === 7 ? "Upgrade" : "Next";
    }

    document.querySelectorAll("[data-choice-group]").forEach(function (group) {
        group.addEventListener("click", function (event) {
            var choice = event.target.closest("button");
            if (!choice || !group.contains(choice)) return;

            group.querySelectorAll("button").forEach(function (button) {
                var selected = button === choice;
                button.classList.toggle("is-selected", selected);
                button.setAttribute("aria-pressed", String(selected));
            });
        });
    });

    document.querySelectorAll("[data-follow]").forEach(function (button) {
        button.addEventListener("click", function () {
            var following = button.classList.toggle("is-following");
            button.textContent = following ? "Following" : "Not Followed";
        });
    });

    var followAllButton = document.querySelector("[data-follow-all]");
    if (followAllButton) {
        followAllButton.addEventListener("click", function () {
            document.querySelectorAll("[data-follow]").forEach(function (button) {
                button.classList.add("is-following");
                button.textContent = "Following";
            });
        });
    }

    var projectName = document.querySelector("[data-project-name]");
    var characterCount = document.querySelector("[data-character-count]");

    function updateCharacterCount() {
        if (projectName && characterCount) {
            characterCount.textContent = projectName.value.length + "/50";
        }
    }

    if (projectName) projectName.addEventListener("input", updateCharacterCount);

    var nameSuggestion = document.querySelector("[data-name-suggestion]");
    if (nameSuggestion && projectName) {
        nameSuggestion.addEventListener("click", function () {
            projectName.value = "Epic Gun Game";
            updateCharacterCount();
            projectName.focus();
        });
    }

    var customPromptButton = document.querySelector("[data-custom-prompt]");
    if (customPromptButton) {
        customPromptButton.addEventListener("click", function () {
            var input = customPromptButton.closest("label").querySelector("input");
            if (input.value.trim()) showStep(6);
            else input.focus();
        });
    }

    nextButton.addEventListener("click", function () {
        if (currentStep < 7) {
            showStep(currentStep + 1);
            return;
        }

        window.location.href = "plans.html";
    });

    showStep(0);
})();
