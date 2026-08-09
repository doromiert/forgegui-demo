(function () {
  "use strict";

  var article = document.querySelector(".docsArticle");
  var summaryButton = document.querySelector(".docsSummaryButton");
  var summary = document.querySelector(".docsSummary");
  var search = document.querySelector("[data-docs-search]");

  if (summaryButton && summary) {
    summaryButton.addEventListener("click", function () {
      var expanded = summary.hidden;
      summary.hidden = !expanded;
      summaryButton.setAttribute("aria-expanded", String(expanded));
    });
  }

  document.querySelectorAll("[data-docs-rail]").forEach(function (button) {
    button.addEventListener("click", function () {
      var rail = document.getElementById(button.dataset.docsRail);
      if (!rail) return;
      var open = rail.classList.toggle("is-open");
      button.setAttribute("aria-expanded", String(open));
    });
  });

  function clearMatches() {
    document.querySelectorAll("mark.docsSearchMatch").forEach(function (mark) {
      mark.replaceWith(document.createTextNode(mark.textContent));
    });
    if (article) article.normalize();
  }

  if (search && article) {
    search.addEventListener("input", function () {
      clearMatches();
      var query = search.value.trim();
      if (!query) return;

      var pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      var walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
      var nodes = [];
      while (walker.nextNode()) {
        if (!walker.currentNode.parentElement.closest("code")) nodes.push(walker.currentNode);
      }

      nodes.forEach(function (node) {
        var text = node.nodeValue;
        var matches = Array.from(text.matchAll(pattern));
        if (!matches.length) return;
        var fragment = document.createDocumentFragment();
        var cursor = 0;
        matches.forEach(function (match) {
          fragment.append(text.slice(cursor, match.index));
          var mark = document.createElement("mark");
          mark.className = "docsSearchMatch";
          mark.textContent = match[0];
          fragment.append(mark);
          cursor = match.index + match[0].length;
        });
        fragment.append(text.slice(cursor));
        node.replaceWith(fragment);
      });

      document.querySelector(".docsSearchMatch")?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }

  var tocLinks = Array.from(document.querySelectorAll(".docsToc nav > a"));
  var headings = tocLinks.map(function (link) {
    return document.getElementById(decodeURIComponent(link.hash.slice(1)));
  }).filter(Boolean);

  if (headings.length && "IntersectionObserver" in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        tocLinks.forEach(function (link) {
          link.classList.toggle("current", link.hash === "#" + entry.target.id);
        });
      });
    }, { rootMargin: "-15% 0px -70%" });
    headings.forEach(function (heading) { observer.observe(heading); });
  }
})();
