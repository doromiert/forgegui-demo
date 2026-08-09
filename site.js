(function () {
  "use strict";

  function closeContexts() {
    document.querySelectorAll("fg-contextmenu:not(.hidden)").forEach(function (menu) {
      menu.classList.add("hidden");
      document.querySelectorAll('[data-context-target="' + menu.id + '"]').forEach(function (trigger) {
        trigger.setAttribute("aria-expanded", "false");
      });
    });
  }

  window.showContext = function (id, trigger) {
    var context = document.getElementById(id);
    if (!context) return;
    var opening = context.classList.contains("hidden");
    closeContexts();
    context.classList.toggle("hidden", !opening);
    if (trigger) trigger.setAttribute("aria-expanded", opening ? "true" : "false");
  };

  document.querySelectorAll("[data-context-target]").forEach(function (trigger) {
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", trigger.dataset.contextTarget);
  });
  document.querySelectorAll("fg-contextmenu").forEach(function (menu) {
    menu.setAttribute("role", "menu");
  });

  document.addEventListener("click", function (event) {
    if (event.target.closest("[data-toggle-sidebar]")) {
      var sidebar = document.querySelector("fg-sidebar");
      if (sidebar) sidebar.classList.toggle("collapsed");
    }

    var contextTrigger = event.target.closest("[data-context-target]");
    if (contextTrigger) {
      window.showContext(contextTrigger.dataset.contextTarget, contextTrigger);
    } else if (event.target.closest("fg-contextmenu button")) {
      closeContexts();
    } else if (!event.target.closest("fg-contextmenu")) {
      closeContexts();
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeContexts();
  });

  document.addEventListener("click", function (event) {
    var menuButton = event.target.closest(".menu-button");
    if (!menuButton) return;
    var nav = document.querySelector(".main-nav");
    if (!nav) return;
    var open = nav.classList.toggle("is-open");
    menuButton.setAttribute("aria-expanded", String(open));
  });

  // Carousel API — call carousel.next(), carousel.prev(), or carousel.goTo(n)
  window.carousel = (function () {
    var index = 0;

    function syncSteps(n, total) {
      document.querySelectorAll("fg-carouselsteps").forEach(function (el) {
        el.style.visibility = n === total - 1 ? "hidden" : "";
        if (el.children.length !== total) {
          el.innerHTML = "";
          for (var i = 0; i < total; i++) {
            el.appendChild(document.createElement("fg-carouselstep"));
          }
        }
        Array.from(el.children).forEach(function (step, i) {
          step.classList.toggle("active", i === n);
        });
      });
    }

    function layout(n) {
      var pages = document.querySelectorAll("fg-carouselpage");
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

  // One accessible controller owns every application popup. Pages declare
  // relationships with data-popup-open/data-popup-close instead of adding JS.
  var activePopup = null;
  var popupTrigger = null;

  function popupFocusables(popup) {
    return Array.from(
      popup.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(function (element) {
      return !element.hidden && element.getClientRects().length > 0;
    });
  }

  function preparePopup(popup) {
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-modal", "true");
    popup.setAttribute("aria-hidden", popup.classList.contains("hidden") ? "true" : "false");

    var heading = popup.querySelector("h1");
    if (heading && !popup.hasAttribute("aria-labelledby") && !popup.hasAttribute("aria-label")) {
      if (!heading.id) heading.id = popup.id + "-title";
      popup.setAttribute("aria-labelledby", heading.id);
    }
  }

  window.openPopup = function (id, trigger) {
    var popup = document.getElementById(id);
    if (!popup || popup.tagName.toLowerCase() !== "fg-popup") return;

    var container = popup.closest("fg-popupcontainer");
    if (!container) return;

    if (!activePopup || !trigger || !activePopup.contains(trigger)) {
      popupTrigger = trigger || document.activeElement;
    }

    document.querySelectorAll("fg-popupcontainer > fg-popup").forEach(function (item) {
      var visible = item === popup;
      item.classList.toggle("hidden", !visible);
      item.setAttribute("aria-hidden", visible ? "false" : "true");
    });
    document.querySelectorAll("fg-popupcontainer").forEach(function (item) {
      var visible = item === container;
      item.classList.toggle("hidden", !visible);
      item.setAttribute("aria-hidden", visible ? "false" : "true");
    });

    if (popup.classList.contains("settingsPopup")) {
      popup.querySelectorAll("fg-fieldgroup.hasError").forEach(function (group) {
        group.classList.remove("hasError");
      });
      popup.querySelectorAll("fg-fieldgroup input").forEach(function (input) {
        input.value = "";
      });
    }

    activePopup = popup;
    document.body.classList.add("popupOpen");
    requestAnimationFrame(function () {
      var focusTarget = popup.querySelector("[autofocus]") || popupFocusables(popup)[0];
      if (focusTarget) focusTarget.focus();
      else {
        popup.setAttribute("tabindex", "-1");
        popup.focus();
      }
    });
  };

  window.closePopup = function () {
    if (!activePopup) return;
    var container = activePopup.closest("fg-popupcontainer");
    activePopup.classList.add("hidden");
    activePopup.setAttribute("aria-hidden", "true");
    if (container) {
      container.classList.add("hidden");
      container.setAttribute("aria-hidden", "true");
    }
    activePopup = null;
    document.body.classList.remove("popupOpen");
    if (popupTrigger && popupTrigger.isConnected) popupTrigger.focus();
    popupTrigger = null;
  };

  document.querySelectorAll("fg-popupcontainer").forEach(function (container) {
    container.setAttribute("aria-hidden", "true");
  });
  document.querySelectorAll("fg-popupcontainer > fg-popup").forEach(preparePopup);

  // Validate all required fieldGroups in the active popup. Returns true if clean.
  window.confirmSettingsPopup = function (btn) {
    var popup = btn.closest("fg-popup");
    if (!popup) return;
    var groups = popup.querySelectorAll("fg-fieldgroup:not([data-optional])");
    var valid = true;
    groups.forEach(function (group) {
      var input = group.querySelector("input");
      if (!input) return;
      var empty = input.value.trim() === "";
      var invalid = !input.checkValidity();
      // Special case: Confirm Password must match New Password.
      var mismatch = false;
      if (!empty && input.hasAttribute("data-match-source")) {
        var target = popup.querySelector("[data-match-target]");
        if (target && input.value !== target.value) mismatch = true;
      }
      group.classList.toggle("hasError", empty || invalid || mismatch);
      if (empty || invalid || mismatch) valid = false;
    });
    if (valid) closePopup();
  };

  // Clear a field's error as soon as the user starts typing.
  document.addEventListener("input", function (event) {
    var group = event.target.closest && event.target.closest("fg-fieldgroup");
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

  // Declarative triggers, close controls, backdrop dismissal, and focus trap.
  document.addEventListener("click", function (event) {
    var trigger = event.target.closest("[data-popup-open]");
    if (trigger) {
      window.openPopup(trigger.dataset.popupOpen, trigger);
      return;
    }
    if (event.target.closest("[data-popup-close]") || event.target.matches("fg-popupcontainer")) {
      window.closePopup();
    }
  });
  document.addEventListener("keydown", function (event) {
    var trigger = event.target.closest && event.target.closest("[data-popup-open]");
    if (trigger && !trigger.matches("button, a, input, select, textarea") && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      window.openPopup(trigger.dataset.popupOpen, trigger);
      return;
    }
    if (event.key === "Escape" && activePopup) {
      event.preventDefault();
      window.closePopup();
      return;
    }
    if (event.key !== "Tab" || !activePopup) return;

    var focusables = popupFocusables(activePopup);
    if (!focusables.length) {
      event.preventDefault();
      activePopup.focus();
      return;
    }
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (!activePopup.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
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

  (function installMouseTail() {
    if (
      !document.body.classList.contains("landing-page") ||
      !window.matchMedia("(pointer: fine)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    var canvas = document.createElement("canvas");
    var context = canvas.getContext("2d");
    var points = [];
    var frameId = 0;
    var fadeDuration = 460;
    var maximumPoints = 64;
    var pixelRatio = 1;

    canvas.setAttribute("aria-hidden", "true");
    canvas.style.position = "fixed";
    canvas.style.zIndex = "9999";
    canvas.style.inset = "0";
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    canvas.style.pointerEvents = "none";
    canvas.style.contain = "strict";
    document.body.appendChild(canvas);

    function resizeCanvas() {
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * pixelRatio);
      canvas.height = Math.round(window.innerHeight * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      points = [];
    }

    function scheduleFrame() {
      if (!frameId) frameId = requestAnimationFrame(drawTail);
    }

    function addPoint(event) {
      var now = performance.now();
      var previous = points[points.length - 1];
      var x = event.clientX;
      var y = event.clientY;

      if (previous) {
        var dx = x - previous.x;
        var dy = y - previous.y;
        var distance = Math.hypot(dx, dy);

        if (distance < 2) {
          previous.x = x;
          previous.y = y;
          previous.time = now;
          scheduleFrame();
          return;
        }

        if (now - previous.time < 12 && distance < 12) return;
      }

      points.push({ x: x, y: y, time: now });
      if (points.length > maximumPoints) points.shift();
      scheduleFrame();
    }

    function pointAlpha(point, now, index) {
      var ageProgress = (now - point.time) / fadeDuration;
      var alpha = Math.max(0, 1 - ageProgress);
      var edgeFade = Math.min(1, index / 3, (points.length - 1 - index) / 2);
      return alpha * edgeFade;
    }

    function drawTail(now) {
      frameId = 0;
      points = points.filter(function (point) {
        return now - point.time < fadeDuration;
      });
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);

      if (points.length > 1) {
        context.lineCap = "round";
        context.lineJoin = "round";
        context.globalCompositeOperation = "lighter";
        context.shadowBlur = 12;
        context.shadowColor = "rgba(0, 119, 255, 0.7)";

        for (var index = 1; index < points.length; index += 1) {
          var previous = points[index - 1];
          var current = points[index];
          var next = points[index + 1] || current;
          var startX =
            index === 1 ? previous.x : (previous.x + current.x) / 2;
          var startY =
            index === 1 ? previous.y : (previous.y + current.y) / 2;
          var endX =
            index === points.length - 1
              ? current.x
              : (current.x + next.x) / 2;
          var endY =
            index === points.length - 1
              ? current.y
              : (current.y + next.y) / 2;
          var startAlpha = pointAlpha(previous, now, index - 1);
          var endAlpha = pointAlpha(current, now, index);
          var gradient = context.createLinearGradient(
            startX,
            startY,
            endX,
            endY,
          );

          gradient.addColorStop(
            0,
            "rgba(0, 89, 255, " + (startAlpha * 0.72).toFixed(3) + ")",
          );
          gradient.addColorStop(
            1,
            "rgba(89, 167, 255, " + (endAlpha * 0.92).toFixed(3) + ")",
          );

          context.beginPath();
          context.moveTo(startX, startY);
          context.quadraticCurveTo(current.x, current.y, endX, endY);
          context.lineWidth = 2.5 + Math.max(startAlpha, endAlpha) * 3.5;
          context.strokeStyle = gradient;
          context.stroke();
        }

        context.globalCompositeOperation = "source-over";
        context.shadowBlur = 0;
      }

      if (points.length) scheduleFrame();
    }

    document.addEventListener("pointermove", function (event) {
      var samples = event.getCoalescedEvents
        ? event.getCoalescedEvents()
        : [event];
      samples.forEach(addPoint);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) points = [];
    });
    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();
  })();
})();
