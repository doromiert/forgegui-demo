(function () {
  "use strict";

  if (window.ForgeCache) return;

  var PREFIX = "forgegui.data-cache.v1:";
  var VERSION = 1;
  var MAX_ENTRIES = 40;
  var MAX_ITEM_CHARS = 400000;
  var MAX_TOTAL_CHARS = 2000000;

  function store() {
    try {
      return window.localStorage;
    } catch (_) {
      return null;
    }
  }

  function cacheKey(userId, name) {
    return PREFIX + encodeURIComponent(String(userId || "public")) + ":" + encodeURIComponent(String(name));
  }

  function cacheEntries(storage) {
    var entries = [];
    for (var index = 0; index < storage.length; index += 1) {
      var key = storage.key(index);
      if (!key || !key.startsWith(PREFIX)) continue;
      var raw = storage.getItem(key) || "";
      var savedAt = 0;
      try { savedAt = Number(JSON.parse(raw).savedAt || 0); } catch (_) {}
      entries.push({ key: key, length: raw.length, savedAt: savedAt });
    }
    return entries;
  }

  function prune(storage, incomingKey, incomingLength) {
    var entries = cacheEntries(storage).filter(function (entry) {
      return entry.key !== incomingKey;
    }).sort(function (first, second) {
      return first.savedAt - second.savedAt;
    });
    var total = entries.reduce(function (sum, entry) { return sum + entry.length; }, incomingLength);
    while (entries.length >= MAX_ENTRIES || total > MAX_TOTAL_CHARS) {
      var oldest = entries.shift();
      if (!oldest) break;
      storage.removeItem(oldest.key);
      total -= oldest.length;
    }
  }

  function read(userId, name, maxAgeMs) {
    var storage = store();
    if (!storage) return null;
    var key = cacheKey(userId, name);
    try {
      var raw = storage.getItem(key);
      if (!raw) return null;
      var entry = JSON.parse(raw);
      var age = Date.now() - Number(entry.savedAt || 0);
      if (
        entry.version !== VERSION ||
        entry.userId !== String(userId || "public") ||
        !Number.isFinite(age) ||
        age < 0 ||
        (Number.isFinite(maxAgeMs) && age > maxAgeMs)
      ) {
        storage.removeItem(key);
        return null;
      }
      return entry.data;
    } catch (_) {
      storage.removeItem(key);
      return null;
    }
  }

  function write(userId, name, data) {
    var storage = store();
    if (!storage) return false;
    var key = cacheKey(userId, name);
    var raw;
    try {
      raw = JSON.stringify({
        version: VERSION,
        userId: String(userId || "public"),
        savedAt: Date.now(),
        data: data,
      });
    } catch (_) {
      return false;
    }
    if (raw.length > MAX_ITEM_CHARS) return false;
    try {
      prune(storage, key, raw.length);
      storage.setItem(key, raw);
      return true;
    } catch (_) {
      prune(storage, key, MAX_TOTAL_CHARS + 1);
      try {
        storage.setItem(key, raw);
        return true;
      } catch (_) {
        return false;
      }
    }
  }

  function remove(userId, name) {
    var storage = store();
    if (!storage) return;
    storage.removeItem(cacheKey(userId, name));
  }

  function clearUser(userId) {
    var storage = store();
    if (!storage) return;
    var userPrefix = PREFIX + encodeURIComponent(String(userId || "public")) + ":";
    var keys = [];
    for (var index = 0; index < storage.length; index += 1) {
      var key = storage.key(index);
      if (key && key.startsWith(userPrefix)) keys.push(key);
    }
    keys.forEach(function (key) { storage.removeItem(key); });
  }

  window.ForgeCache = Object.freeze({
    clearUser: clearUser,
    read: read,
    remove: remove,
    write: write,
  });
})();
