(function () {
  "use strict";

  if (!window.ForgeAPI) return;

  function displayName(user, profile) {
    return (profile && profile.display_name) ||
      (user.user_metadata && (user.user_metadata.display_name || user.user_metadata.full_name)) ||
      (user.email ? user.email.split("@")[0] : "Creator");
  }

  async function hydrate(session) {
    if (!session || !session.user) return;
    var profile = null;
    try {
      var result = await window.ForgeAPI.client()
        .from("profiles")
        .select("display_name, avatar_url, has_completed_onboarding")
        .eq("id", session.user.id)
        .maybeSingle();
      if (!result.error) profile = result.data;
    } catch (_) {
      // Authenticated navigation should remain usable if optional profile data fails.
    }

    if (profile && profile.has_completed_onboarding === false) {
      await window.ForgeAPI.client()
        .from("profiles")
        .update({ has_completed_onboarding: true })
        .eq("id", session.user.id);
    }

    var name = displayName(session.user, profile);
    document.querySelectorAll("[data-user-name]").forEach(function (element) {
      element.textContent = name;
    });
    document.querySelectorAll("[data-user-email]").forEach(function (element) {
      element.textContent = session.user.email || "";
    });
    var avatar = (profile && profile.avatar_url) ||
      (session.user.user_metadata && session.user.user_metadata.avatar_url);
    if (avatar) {
      document.querySelectorAll("img[data-user-avatar]").forEach(function (image) {
        image.src = avatar;
      });
    }
    document.querySelectorAll("[data-auth-actions]").forEach(function (actions) {
      actions.innerHTML = "";
      var appLink = document.createElement("a");
      appLink.href = window.ForgeAPI.routeUrl("home.html").href;
      appLink.textContent = "Open App";
      var signOut = document.createElement("button");
      signOut.type = "button";
      signOut.dataset.authSignout = "";
      signOut.textContent = "Sign Out";
      actions.append(appLink, signOut);
    });
  }

  document.addEventListener("click", async function (event) {
    var button = event.target.closest("[data-auth-signout]");
    if (!button) return;
    event.preventDefault();
    button.disabled = true;
    try {
      var current = await window.ForgeAPI.auth.session();
      await window.ForgeAPI.auth.signOut();
      if (current && window.ForgeCache) window.ForgeCache.clearUser(current.user.id);
      location.assign(new URL("index.html", window.ForgeAPI.root()).href);
    } catch (error) {
      button.disabled = false;
      button.title = error.message;
    }
  });

  var routeMeta = document.querySelector('meta[name="forge-route"]');
  var route = routeMeta ? routeMeta.content : "";
  window.ForgeAPI.auth.requireSession(route, window.ForgeAPI.root())
    .then(function (allowed) {
      if (!allowed) return null;
      return window.ForgeAPI.auth.session();
    })
    .then(hydrate)
    .catch(function () {});
  try {
    window.ForgeAPI.auth.client().auth.onAuthStateChange(function (_, session) {
      hydrate(session);
    });
  } catch (_) {
    // Public pages surface missing configuration only when an auth action is used.
  }
})();
