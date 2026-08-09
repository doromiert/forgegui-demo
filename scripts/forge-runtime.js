(function () {
  "use strict";

  var MOBILE_QUERY = "(max-width: 700px)";
  var templateCache = new Map();
  var hydrationHandlers = new Map();
  var hydratedElements = new WeakSet();

  function forgeMeta(name) {
    var meta = document.querySelector('meta[name="' + name + '"]');
    return meta ? meta.content : "";
  }

  function projectRoot() {
    var root = forgeMeta("forge-root");
    if (root) return new URL(root, document.baseURI);
    var forgePath = forgeMeta("forge-path");
    var depth = forgePath ? forgePath.split("/").length - 1 : 0;
    return new URL("../".repeat(depth) || "./", document.baseURI);
  }

  function isExternalPath(value) {
    return !value || /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(value);
  }

  function asset(path) {
    return new URL(path, projectRoot()).href;
  }

  function rewriteSrcset(value) {
    return value.split(",").map(function (candidate) {
      var parts = candidate.trim().split(/\s+/);
      if (!isExternalPath(parts[0])) parts[0] = asset(parts[0]);
      return parts.join(" ");
    }).join(", ");
  }

  function rewriteStyleUrls(value) {
    return value.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, function (match, quote, path) {
      if (isExternalPath(path)) return match;
      return "url(" + quote + asset(path) + quote + ")";
    });
  }

  function resolveTemplatePaths(root) {
    var pathAttributes = ["src", "href", "action", "poster", "data-template"];
    root.querySelectorAll("*").forEach(function (element) {
      pathAttributes.forEach(function (name) {
        var value = element.getAttribute(name);
        if (value !== null && !isExternalPath(value)) {
          element.setAttribute(name, asset(value));
        }
      });
      if (element.hasAttribute("srcset")) {
        element.setAttribute("srcset", rewriteSrcset(element.getAttribute("srcset")));
      }
      if (element.hasAttribute("style")) {
        element.setAttribute("style", rewriteStyleUrls(element.getAttribute("style")));
      }
    });
  }

  function cloneProjectedNodes(nodes) {
    return nodes.map(function (node) { return node.cloneNode(true); });
  }

  function collectProjection(host) {
    var projection = new Map();
    projection.set("", []);
    Array.from(host.childNodes).forEach(function (node) {
      var name = "";
      if (node.nodeType === Node.ELEMENT_NODE && node.hasAttribute("data-slot")) {
        name = node.getAttribute("data-slot");
        node = node.cloneNode(true);
        node.removeAttribute("data-slot");
      }
      if (!projection.has(name)) projection.set(name, []);
      projection.get(name).push(node);
    });
    return projection;
  }

  function projectSlots(fragment, projection) {
    fragment.querySelectorAll("fg-slot").forEach(function (slot) {
      var name = slot.getAttribute("data-name") || "";
      var supplied = projection.get(name);
      var replacement = supplied && supplied.length
        ? cloneProjectedNodes(supplied)
        : Array.from(slot.childNodes);
      slot.replaceWith.apply(slot, replacement);
    });
  }

  function applyHostClasses(fragment, classes) {
    if (!classes) return;
    var root = fragment.firstElementChild;
    if (root) root.classList.add.apply(root.classList, classes.split(/\s+/).filter(Boolean));
  }

  function fetchTemplate(url) {
    if (!templateCache.has(url)) {
      templateCache.set(url, fetch(url).then(function (response) {
        if (!response.ok) throw new Error("Template request failed: " + response.status + " " + url);
        return response.text();
      }).catch(function (error) {
        templateCache.delete(url);
        throw error;
      }));
    }
    return templateCache.get(url);
  }

  function hydrate(root) {
    var elements = [];
    if (root.nodeType === Node.ELEMENT_NODE && root.hasAttribute("data-hydrate")) {
      elements.push(root);
    }
    root.querySelectorAll("[data-hydrate]").forEach(function (element) {
      elements.push(element);
    });
    elements.forEach(function (element) {
      if (hydratedElements.has(element)) return;
      var handler = hydrationHandlers.get(element.dataset.hydrate);
      if (!handler) return;
      hydratedElements.add(element);
      handler(element, window.ForgeUI);
    });
  }

  async function renderInclude(host) {
    if (host.dataset.rendering === "true") return;
    host.dataset.rendering = "true";
    var source = host.getAttribute("data-template");
    if (!source) throw new Error("fg-client-include requires data-template");
    var url = new URL(source, document.baseURI).href;
    var html = await fetchTemplate(url);
    var template = document.createElement("template");
    template.innerHTML = html;
    var fragment = template.content;
    projectSlots(fragment, collectProjection(host));
    applyHostClasses(fragment, host.className);
    resolveTemplatePaths(fragment);
    await render(fragment);
    var renderedNodes = Array.from(fragment.childNodes);
    host.replaceWith(fragment);
    renderedNodes.forEach(function (node) {
      if (node.nodeType === Node.ELEMENT_NODE) hydrate(node);
    });
    document.dispatchEvent(new CustomEvent("forge:template-rendered", {
      detail: { source: source, nodes: renderedNodes },
    }));
  }

  async function render(root) {
    var includes = Array.from(root.querySelectorAll("fg-client-include[data-template]")).filter(
      function (include) {
        return !include.parentElement || !include.parentElement.closest("fg-client-include");
      },
    );
    await Promise.all(includes.map(renderInclude));
    hydrate(root);
  }

  function register(name, handler) {
    hydrationHandlers.set(name, handler);
    hydrate(document);
  }

  function installVariantSwitching() {
    var variant = forgeMeta("forge-variant");
    var route = forgeMeta("forge-route");
    if (!variant || !route) return;
    var media = window.matchMedia(MOBILE_QUERY);
    function syncVariant() {
      var next = media.matches ? "mobile" : "desktop";
      if (next === variant) return;
      if (window.ForgeLoader) window.ForgeLoader.load(next, route);
    }
    media.addEventListener("change", syncVariant);
    syncVariant();
  }

  window.ForgeUI = {
    asset: asset,
    hydrate: hydrate,
    register: register,
    render: render,
    root: projectRoot,
  };

  installVariantSwitching();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { render(document); }, { once: true });
  } else {
    render(document);
  }
})();
