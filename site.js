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
})();
