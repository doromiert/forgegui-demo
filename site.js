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
      var persp = w * 2;
      pages.forEach(function (page, i) {
        var offset = i - index;
        page.style.transform =
          "perspective(" + persp + "px)" +
          " translateX(" + (offset * w * 1.1) + "px)" +
          " rotateY(" + (offset * -20) + "deg)";
      });
      syncSteps(index, pages.length);
    }

    layout(0);
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
