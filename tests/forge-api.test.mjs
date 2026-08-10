import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../scripts/forge-api.js", import.meta.url), "utf8");

function loadApi(metadata = {}) {
  const location = {
    href: "https://example.com/forge/desktop/settings/overview.html",
    origin: "https://example.com",
    pathname: "/forge/desktop/settings/overview.html",
  };
  const document = {
    querySelector(selector) {
      const name = selector.match(/name="([^"]+)"/)?.[1];
      return name && metadata[name] ? { content: metadata[name] } : null;
    },
  };
  const window = {
    __FORGE_CONFIG__: {
      supabaseUrl: "https://project.supabase.co",
      supabaseAnonKey: "public-key",
    },
  };
  const context = {
    URL,
    Headers,
    document,
    fetch,
    location,
    sessionStorage: {
      getItem() { return null; },
      removeItem() {},
      setItem() {},
    },
    window,
  };
  vm.runInNewContext(source, context);
  return window.ForgeAPI;
}

test("classifies protected and public routes", () => {
  const api = loadApi();
  assert.equal(api.auth.isProtectedRoute("home.html"), true);
  assert.equal(api.auth.isProtectedRoute("settings/account.html"), true);
  assert.equal(api.auth.isProtectedRoute("community.html"), true);
  assert.equal(api.auth.isProtectedRoute("plans.html"), true);
  assert.equal(api.auth.isProtectedRoute("docs/index.html"), true);
  assert.equal(api.auth.isProtectedRoute("onboarding.html"), true);
  assert.equal(api.auth.isProtectedRoute("auth/callback.html"), false);
  assert.equal(api.auth.isProtectedRoute("index.html"), false);
  assert.equal(api.auth.isProtectedRoute("blog.html"), false);
  assert.equal(api.auth.isProtectedRoute("jobs.html"), false);
});

test("resolves the logical root from direct variant pages", () => {
  const api = loadApi({ "forge-path": "desktop/settings/overview.html" });
  assert.equal(api.root().href, "https://example.com/forge/");
  assert.equal(
    api.routeUrl("auth/callback.html").href,
    "https://example.com/forge/auth/callback.html",
  );
});

test("rejects external return destinations", () => {
  const api = loadApi({ "forge-path": "desktop/settings/overview.html" });
  assert.equal(
    api.routeUrl("https://malicious.example/").href,
    "https://example.com/forge/home.html",
  );
});

test("generates UUIDs when randomUUID is unavailable", () => {
  const api = loadApi();
  assert.match(api.uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
