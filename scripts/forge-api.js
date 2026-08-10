(function () {
  "use strict";

  if (window.ForgeAPI) return;

  var RETURN_PATH_KEY = "forgegui.auth.return_path";
  var PUBLIC_ROUTES = new Set([
    "index.html",
    "blog.html",
    "blog/article.html",
    "jobs.html",
    "jobs-empty.html",
    "auth/callback.html",
    "auth/reset-password.html",
  ]);

  function configuration() {
    var config = window.__FORGE_CONFIG__ || {};
    var url = typeof config.supabaseUrl === "string" ? config.supabaseUrl.trim() : "";
    var key = typeof config.supabaseAnonKey === "string" ? config.supabaseAnonKey.trim() : "";
    if (!url || !key) {
      throw new Error(
        "ForgeGUI authentication is not configured. Set FORGE_SUPABASE_URL and FORGE_SUPABASE_ANON_KEY before serving or building the site.",
      );
    }
    return { url: url.replace(/\/$/, ""), key: key };
  }

  function getClient() {
    if (window.__FORGE_SUPABASE_CLIENT__) return window.__FORGE_SUPABASE_CLIENT__;
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("The Supabase browser client did not load.");
    }
    var config = configuration();
    window.__FORGE_SUPABASE_CLIENT__ = window.supabase.createClient(
      config.url,
      config.key,
      {
        auth: {
          flowType: "pkce",
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: window.localStorage,
        },
      },
    );
    return window.__FORGE_SUPABASE_CLIENT__;
  }

  function randomUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    var bytes = new Uint8Array(16);
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      window.crypto.getRandomValues(bytes);
    } else {
      for (var index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.from(bytes, function (byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
  }

  function normalizeRoute(route, fallback) {
    if (typeof route !== "string" || !route || route.startsWith("//")) return fallback;
    try {
      var parsed = new URL(route, "https://forgegui.invalid/");
      if (parsed.origin !== "https://forgegui.invalid") return fallback;
      return parsed.pathname.replace(/^\//, "") + parsed.search + parsed.hash;
    } catch (_) {
      return fallback;
    }
  }

  function rootUrl() {
    var rootMeta = document.querySelector('meta[name="forge-root"]');
    if (rootMeta) return new URL(rootMeta.content, location.href);
    var pathMeta = document.querySelector('meta[name="forge-path"]');
    if (pathMeta && location.pathname.endsWith(pathMeta.content)) {
      return new URL(
        location.pathname.slice(0, -pathMeta.content.length),
        location.origin,
      );
    }
    var routeMeta = document.querySelector('meta[name="forge-route"]');
    if (routeMeta) {
      var route = routeMeta.content;
      var path = location.pathname;
      if (path.endsWith(route)) return new URL(path.slice(0, -route.length), location.origin);
    }
    return new URL("./", location.href);
  }

  function routeUrl(route, root) {
    return new URL(normalizeRoute(route, "home.html"), root || rootUrl());
  }

  function rememberReturnPath(route) {
    try {
      sessionStorage.setItem(RETURN_PATH_KEY, normalizeRoute(route, "home.html"));
    } catch (_) {
      // Authentication still works when storage is blocked; only the return path is lost.
    }
  }

  function consumeReturnPath(fallback) {
    try {
      var route = sessionStorage.getItem(RETURN_PATH_KEY);
      sessionStorage.removeItem(RETURN_PATH_KEY);
      return normalizeRoute(route, fallback);
    } catch (_) {
      return fallback;
    }
  }

  function isProtectedRoute(route) {
    var path = normalizeRoute(route, "").split(/[?#]/)[0];
    return !PUBLIC_ROUTES.has(path);
  }

  async function currentSession() {
    var result = await getClient().auth.getSession();
    if (result.error) throw result.error;
    return result.data.session;
  }

  function renderBlockedPage(title, message, root) {
    var body = document.body || document.createElement("body");
    body.innerHTML = "";
    var main = document.createElement("main");
    main.style.cssText = "min-height:100vh;display:grid;place-content:center;gap:12px;padding:32px;background:#0a0a0a;color:#fff;font:16px/1.5 system-ui;text-align:center";
    var heading = document.createElement("h1");
    heading.textContent = title;
    var copy = document.createElement("p");
    copy.textContent = message;
    var link = document.createElement("a");
    link.href = new URL("index.html?auth=signin", root).href;
    link.textContent = "Return to sign in";
    link.style.color = "#68a8ff";
    main.append(heading, copy, link);
    body.appendChild(main);
    if (!body.isConnected) document.documentElement.appendChild(body);
  }

  async function requireSession(route, root) {
    if (!isProtectedRoute(route)) return true;
    try {
      if (await currentSession()) {
        if (normalizeRoute(route, "").split(/[?#]/)[0] === "onboarding.html") {
          location.replace(new URL("home.html", root).href);
          return false;
        }
        return true;
      }
      rememberReturnPath(route);
      location.replace(new URL("index.html?auth=signin", root).href);
      return false;
    } catch (error) {
      renderBlockedPage("Unable to open ForgeGUI", error.message, root);
      return false;
    }
  }

  async function functionRequest(name, options) {
    var config = configuration();
    var session = await currentSession();
    var request = options || {};
    var headers = new Headers(request.headers || {});
    headers.set("apikey", config.key);
    headers.set("Authorization", "Bearer " + (session ? session.access_token : config.key));
    if (request.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    var response = await fetch(config.url + "/functions/v1/" + name, {
      method: request.method || "POST",
      headers: headers,
      body: request.body === undefined
        ? undefined
        : typeof request.body === "string"
          ? request.body
          : JSON.stringify(request.body),
      signal: request.signal,
    });
    var contentType = response.headers.get("content-type") || "";
    var data = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
    if (!response.ok) {
      var message = data && typeof data === "object" && (data.error || data.message || data.msg)
        ? data.error || data.message || data.msg
        : "Request failed with status " + response.status;
      var error = new Error(message);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  async function signInWithPassword(email, password) {
    var result = await getClient().auth.signInWithPassword({
      email: email.trim(),
      password: password,
    });
    if (result.error) throw result.error;
    return result.data;
  }

  async function signUpWithCaptcha(input) {
    await functionRequest("signup-with-captcha", {
      body: {
        email: input.email.trim(),
        password: input.password,
        challenge_id: input.challengeId,
        captcha_token: input.captchaToken,
      },
    });
    var signedIn = await signInWithPassword(input.email, input.password);
    if (input.name && signedIn.user) {
      var displayName = input.name.trim().slice(0, 50);
      var profileResult = await getClient()
        .from("profiles")
        .update({ display_name: displayName })
        .eq("id", signedIn.user.id);
      if (profileResult.error) throw profileResult.error;
      await getClient().auth.updateUser({ data: { display_name: displayName } });
    }
    return signedIn;
  }

  async function signInWithGoogle(returnRoute) {
    var route = normalizeRoute(returnRoute, "home.html");
    rememberReturnPath(route);
    var callback = new URL("auth/callback.html", rootUrl());
    var result = await getClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callback.href,
        queryParams: { prompt: "select_account" },
      },
    });
    if (result.error) throw result.error;
    return result.data;
  }

  async function finishOAuth() {
    var session = await currentSession();
    if (!session) throw new Error("Google sign-in did not return an authenticated session.");
    return consumeReturnPath("home.html");
  }

  async function resetPasswordForEmail(email) {
    var redirect = new URL("auth/reset-password.html", rootUrl());
    var result = await getClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: redirect.href,
    });
    if (result.error) throw result.error;
  }

  async function updatePassword(password) {
    var result = await getClient().auth.updateUser({ password: password });
    if (result.error) throw result.error;
    return result.data;
  }

  async function signOut() {
    var result = await getClient().auth.signOut({ scope: "local" });
    if (result.error) throw result.error;
  }

  window.ForgeAPI = Object.freeze({
    auth: Object.freeze({
      client: getClient,
      consumeReturnPath: consumeReturnPath,
      finishOAuth: finishOAuth,
      isProtectedRoute: isProtectedRoute,
      rememberReturnPath: rememberReturnPath,
      requireSession: requireSession,
      resetPasswordForEmail: resetPasswordForEmail,
      session: currentSession,
      signInWithGoogle: signInWithGoogle,
      signInWithPassword: signInWithPassword,
      signOut: signOut,
      updatePassword: updatePassword,
      signUpWithCaptcha: signUpWithCaptcha,
    }),
    client: getClient,
    function: functionRequest,
    root: rootUrl,
    routeUrl: routeUrl,
    uuid: randomUuid,
  });
})();
