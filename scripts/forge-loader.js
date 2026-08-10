(function () {
  "use strict";

  var MOBILE_QUERY = "(max-width: 700px)";

  function isExternalPath(value) {
    return !value || /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(value);
  }

  function logicalRoot(route) {
    var path = location.pathname;
    if (path.endsWith(route)) return path.slice(0, -route.length);
    if (route === "index.html" && path.endsWith("/")) return path;
    return path.slice(0, path.lastIndexOf("/") + 1);
  }

  function rewriteUrlFunctions(value, baseUrl) {
    return value.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, function (match, quote, path) {
      if (isExternalPath(path)) return match;
      return "url(" + quote + new URL(path, baseUrl).href + quote + ")";
    });
  }

  function rewriteSrcset(value, baseUrl) {
    return value.split(",").map(function (candidate) {
      var parts = candidate.trim().split(/\s+/);
      if (!isExternalPath(parts[0])) parts[0] = new URL(parts[0], baseUrl).href;
      return parts.join(" ");
    }).join(", ");
  }

  function normalizeDocumentPaths(html, baseUrl, rootUrl) {
    var parsed = new DOMParser().parseFromString(html, "text/html");
    var pathAttributes = ["src", "href", "action", "poster", "data-template"];
    parsed.querySelectorAll("*").forEach(function (element) {
      pathAttributes.forEach(function (name) {
        var value = element.getAttribute(name);
        if (value !== null && !isExternalPath(value)) {
          element.setAttribute(name, new URL(value, baseUrl).href);
        }
      });
      if (element.hasAttribute("srcset")) {
        element.setAttribute("srcset", rewriteSrcset(element.getAttribute("srcset"), baseUrl));
      }
      if (element.hasAttribute("style")) {
        element.setAttribute(
          "style",
          rewriteUrlFunctions(element.getAttribute("style"), baseUrl),
        );
      }
    });
    parsed.querySelectorAll("style").forEach(function (style) {
      style.textContent = rewriteUrlFunctions(style.textContent, baseUrl);
    });
    var rootMeta = parsed.createElement("meta");
    rootMeta.name = "forge-root";
    rootMeta.content = rootUrl;
    parsed.head.prepend(rootMeta);
    return "<!doctype html>\n" + parsed.documentElement.outerHTML;
  }

  async function load(variant, route) {
    var root = logicalRoot(route);
    if (window.ForgeAPI) {
      var allowed = await window.ForgeAPI.auth.requireSession(
        route + location.search + location.hash,
        new URL(root, location.origin),
      );
      if (!allowed) return;
    }
    var target = new URL(root + variant + "/" + route, location.origin);
    var response = await fetch(target.href, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("UI variant request failed: " + response.status + " " + target.href);
    }
    var html = normalizeDocumentPaths(
      await response.text(),
      target.href,
      new URL(root, location.origin).href,
    );
    document.open();
    document.write(html);
    document.close();
  }

  window.ForgeLoader = { load: load };

  var bootstrap = document.querySelector('meta[name="forge-bootstrap"]');
  if (bootstrap) {
    var variant = window.matchMedia(MOBILE_QUERY).matches ? "mobile" : "desktop";
    load(variant, bootstrap.content).catch(function (error) {
      console.error(error);
      document.body.innerHTML = '<main style="padding:2rem;color:white;background:#0a0a0a;font-family:sans-serif">Unable to load this page.</main>';
    });
  }
})();
