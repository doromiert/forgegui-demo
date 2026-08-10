import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../scripts/forge-cache.js", import.meta.url), "utf8");

function loadCache() {
  const values = new Map();
  const localStorage = {
    get length() { return values.size; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    key(index) { return Array.from(values.keys())[index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, String(value)); },
  };
  const window = { localStorage };
  vm.runInNewContext(source, { Date, JSON, Number, String, encodeURIComponent, window });
  return { cache: window.ForgeCache, values };
}

test("keeps cached data scoped to one user", () => {
  const { cache } = loadCache();
  assert.equal(cache.write("user-a", "conversations", [{ id: "one" }]), true);
  assert.deepEqual(cache.read("user-a", "conversations", 1000), [{ id: "one" }]);
  assert.equal(cache.read("user-b", "conversations", 1000), null);
});

test("expires old entries and removes malformed data", () => {
  const { cache, values } = loadCache();
  cache.write("user-a", "feed", [1]);
  const key = Array.from(values.keys())[0];
  const entry = JSON.parse(values.get(key));
  entry.savedAt = Date.now() - 2000;
  values.set(key, JSON.stringify(entry));
  assert.equal(cache.read("user-a", "feed", 1000), null);
  values.set(key, "not-json");
  assert.equal(cache.read("user-a", "feed", 1000), null);
});

test("clears only the selected user's entries", () => {
  const { cache } = loadCache();
  cache.write("user-a", "feed", [1]);
  cache.write("user-a", "conversations", [2]);
  cache.write("user-b", "feed", [3]);
  cache.clearUser("user-a");
  assert.equal(cache.read("user-a", "feed", 1000), null);
  assert.equal(cache.read("user-a", "conversations", 1000), null);
  assert.deepEqual(cache.read("user-b", "feed", 1000), [3]);
});

test("rejects oversized entries instead of exhausting local storage", () => {
  const { cache, values } = loadCache();
  assert.equal(cache.write("user-a", "oversized", "x".repeat(400001)), false);
  assert.equal(values.size, 0);
});
