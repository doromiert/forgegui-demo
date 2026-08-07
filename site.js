(function () {
  "use strict";

  window.showContext = function (id) {
    var context = document.getElementById(id);
    if (context) context.classList.toggle("hidden");
  };

  document.addEventListener("click", function (event) {
    if (event.target.closest("[data-toggle-sidebar]")) {
      var sidebar = document.querySelector("sidebar");
      if (sidebar) sidebar.classList.toggle("collapsed");
    }

    var contextTrigger = event.target.closest("[data-context-target]");
    if (contextTrigger) {
      window.showContext(contextTrigger.dataset.contextTarget);
    }
  });

  // Carousel API — call carousel.next(), carousel.prev(), or carousel.goTo(n)
  window.carousel = (function () {
    var index = 0;

    function syncSteps(n, total) {
      document.querySelectorAll("carouselSteps").forEach(function (el) {
        el.style.visibility = n === total - 1 ? "hidden" : "";
        if (el.children.length !== total) {
          el.innerHTML = "";
          for (var i = 0; i < total; i++) {
            el.appendChild(document.createElement("carouselStep"));
          }
        }
        Array.from(el.children).forEach(function (step, i) {
          step.classList.toggle("active", i === n);
        });
      });
    }

    function layout(n) {
      var pages = document.querySelectorAll("carouselPage");
      if (!pages.length) return;
      index = Math.max(0, Math.min(n, pages.length - 1));
      var w = (pages[0].parentElement || document.body).clientWidth;
      var persp = w * 0.8;
      pages.forEach(function (page, i) {
        var offset = i - index;
        page.style.transform =
          "perspective(" + persp + "px)" +
          " translateX(" + (offset * w * 1.05) + "px)" +
          " rotateY(" + (offset * -60) + "deg)";
      });
      syncSteps(index, pages.length);
    }

    var DEV_START_PAGE = 0;
    layout(DEV_START_PAGE);
    window.addEventListener("resize", function () { layout(index); });

    return {
      goTo: function (n) { layout(n); },
      next:  function ()  { layout(index + 1); },
      prev:  function ()  { layout(index - 1); },
    };
  })();

  // onboardingInput char counter — maxlength is enforced natively by the browser
  document.addEventListener("input", function (event) {
    if (!event.target.matches(".onboardingInput input")) return;
    var input = event.target;
    var max = parseInt(input.getAttribute("maxlength") || "50", 10);
    var counter = input.closest(".onboardingInput").querySelector(".charCounter");
    if (counter) counter.textContent = input.value.length + "/" + max;
  });

  // Popups — one shared backdrop, one visible popup at a time. Only the tags
  // listed here are managed; other popupContainer children (e.g. newPostPopup)
  // keep whatever toggling they already use.
  var POPUPS = "assetsPopup, newPopup, pluginPopup, installPopup, changeUsernamePopup, changeNamePopup, changeEmailPopup, changePasswordPopup";

  function setPopup(tag) {
    var container = document.querySelector("popupContainer");
    if (!container) return;
    var managed = container.querySelectorAll(POPUPS);
    if (!managed.length) return;
    managed.forEach(function (popup) {
      popup.classList.toggle("hidden", popup.tagName.toLowerCase() !== tag);
    });
    container.classList.toggle("hidden", !tag);
  }

  window.openAssetPopup = function () {
    setPopup("assetspopup");
  };
  window.closeAssetsPopup = function () {
    setPopup(null);
  };
  window.openNewPopup = function () {
    setPopup("newpopup");
  };
  window.closeNewPopup = function () {
    setPopup(null);
  };
  window.openPluginPopup = function () {
    setPopup("pluginpopup");
  };
  window.closePluginPopup = function () {
    setPopup(null);
  };
  // The Install (download) button inside pluginPopup swaps to the install steps.
  window.openInstallPopup = function () {
    setPopup("installpopup");
  };
  window.closeInstallPopup = function () {
    setPopup(null);
  };

  // Settings account popups — generic open/close used by overview.html.
  window.openSettingsPopup = function (tag) {
    // Clear any leftover errors from a previous open.
    var container = document.querySelector("popupContainer");
    if (container) {
      container.querySelectorAll("fieldGroup.hasError").forEach(function (g) {
        g.classList.remove("hasError");
      });
      container.querySelectorAll("fieldGroup input").forEach(function (i) {
        i.value = "";
      });
    }
    setPopup(tag.toLowerCase());
  };
  window.closeSettingsPopup = function () {
    setPopup(null);
  };
  // Legacy alias kept for backwards compat.
  window.closeUsernamePopup = window.closeSettingsPopup;

  // Validate all required fieldGroups in the active popup. Returns true if clean.
  window.confirmSettingsPopup = function (btn) {
    var popup = btn.closest("popupContainer > *");
    if (!popup) return;
    var groups = popup.querySelectorAll("fieldGroup:not([data-optional])");
    var valid = true;
    groups.forEach(function (group) {
      var input = group.querySelector("input");
      if (!input) return;
      var empty = input.value.trim() === "";
      // Special case: Confirm Password must match New Password.
      var mismatch = false;
      if (!empty && input.hasAttribute("data-match-source")) {
        var target = popup.querySelector("[data-match-target]");
        if (target && input.value !== target.value) mismatch = true;
      }
      group.classList.toggle("hasError", empty || mismatch);
      if (empty || mismatch) valid = false;
    });
    if (valid) closeSettingsPopup();
  };

  // Clear a field's error as soon as the user starts typing.
  document.addEventListener("input", function (event) {
    var group = event.target.closest && event.target.closest("fieldGroup");
    if (group) group.classList.remove("hasError");
  });

  // Listbox actions that flip to a "done" state — the unlinked label is stashed
  // on first click so the state can toggle back.
  window.toggleLinked = function (button) {
    if (!button.dataset.unlinkedLabel) {
      button.dataset.unlinkedLabel = button.textContent.trim();
    }
    var linked = button.classList.toggle("linked");
    button.textContent = linked
      ? button.dataset.linkedLabel || "Already Linked"
      : button.dataset.unlinkedLabel;
  };

  // Any plugin card opens the plugin detail popup.
  document.addEventListener("click", function (event) {
    if (event.target.closest("pluginGrid pluginBox")) window.openPluginPopup();
  });

  // Click the backdrop (not the popup) or press Escape to dismiss.
  document.addEventListener("click", function (event) {
    if (event.target.matches("popupContainer")) setPopup(null);
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") setPopup(null);
  });

  // Highlight any sidebar link whose href resolves to the current page.
  // Works off <meta name="forge-path"> injected at render time so nested
  // pages (e.g. course/part1.html) don't need manual data-route attributes.
  var forgeMeta = document.querySelector('meta[name="forge-path"]');
  if (forgeMeta) {
    var forgePath = forgeMeta.content;
    document.querySelectorAll("a.sidebarElem").forEach(function (link) {
      if (link.classList.contains("selected")) return;
      var linkPath = new URL(link.href).pathname.replace(/^\//, "");
      if (linkPath === forgePath) link.classList.add("selected");
    });
  }
})();
