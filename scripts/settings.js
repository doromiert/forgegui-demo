(function () {
  "use strict";

  if (!window.ForgeAPI) return;

  var routeMeta = document.querySelector('meta[name="forge-route"]');
  if (!routeMeta || !routeMeta.content.startsWith("settings/")) return;

  var state = {
    session: null,
    profile: {},
    roblox: null,
  };

  function text(selector, value) {
    document.querySelectorAll(selector).forEach(function (element) {
      element.textContent = value;
    });
  }

  function displayName() {
    var user = state.session && state.session.user;
    return state.profile.display_name ||
      (user && user.user_metadata && (user.user_metadata.display_name || user.user_metadata.full_name)) ||
      (user && user.email ? user.email.split("@")[0] : "Creator");
  }

  function username(name) {
    var handle = String(name || "creator").toLowerCase().replace(/[^a-z0-9_]+/g, "");
    return "@" + (handle || "creator");
  }

  function planLabel(plan) {
    var labels = {
      free: "ForgeGUI Free",
      "starter-v4": "ForgeGUI Starter",
      "starter-v3": "ForgeGUI Starter",
      "starter-v2": "ForgeGUI Starter",
      "pro-v2": "ForgeGUI Pro",
      studio: "ForgeGUI Studio",
      lite: "ForgeGUI Lite",
      starter: "ForgeGUI Starter",
      growth: "ForgeGUI Growth",
      pro: "ForgeGUI Pro",
      ultra: "ForgeGUI Ultra",
      max: "ForgeGUI Max",
    };
    if (labels[plan]) return labels[plan];
    return "ForgeGUI " + String(plan || "Free").replace(/[-_]/g, " ").replace(/\b\w/g, function (letter) {
      return letter.toUpperCase();
    });
  }

  function notify(message, error) {
    var status = document.querySelector("[data-settings-status]");
    if (!status) {
      status = document.createElement("div");
      status.dataset.settingsStatus = "";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      status.style.cssText = "position:fixed;right:20px;top:20px;z-index:10000;max-width:min(390px,calc(100vw - 40px));padding:12px 16px;border:1px solid rgba(255,255,255,.16);border-radius:10px;background:#202020;color:#fff;box-shadow:0 14px 40px rgba(0,0,0,.45);font:500 16px/1.35 system-ui,sans-serif";
      document.body.appendChild(status);
    }
    status.style.borderColor = error ? "rgba(255,110,110,.5)" : "rgba(110,210,150,.4)";
    status.textContent = message;
    status.hidden = false;
    clearTimeout(status._hideTimer);
    status._hideTimer = setTimeout(function () { status.hidden = true; }, 4200);
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      button.dataset.idleLabel = button.textContent;
      button.textContent = label || "Saving...";
      button.disabled = true;
    } else {
      button.textContent = button.dataset.idleLabel || button.textContent;
      button.disabled = false;
      delete button.dataset.idleLabel;
    }
  }

  function closeEditor(form) {
    if (form.closest("fg-popup") && typeof window.closePopup === "function") {
      window.closePopup();
      return;
    }
    var editor = form.closest("[data-settings-editor]");
    if (editor) editor.hidden = true;
  }

  function renderIdentity() {
    var user = state.session.user;
    var name = displayName();
    text("[data-user-name]", name);
    text("[data-user-email]", user.email || "");
    text("[data-user-handle]", username(name));

    var avatar = state.profile.avatar_url ||
      (user.user_metadata && user.user_metadata.avatar_url);
    if (avatar) {
      document.querySelectorAll("img[data-user-avatar]").forEach(function (image) {
        image.src = avatar;
      });
    }
  }

  function renderBilling() {
    var credits = Number(state.profile.credits || 0);
    var cap = Number(state.profile.credits_cap || 0);
    text("[data-settings-plan]", planLabel(state.profile.plan));
    text("[data-settings-credits]", credits.toLocaleString() + " / " + cap.toLocaleString());
    text("[data-settings-subscription]", String(state.profile.subscription_status || "inactive").replace(/_/g, " ").replace(/^\w/, function (letter) {
      return letter.toUpperCase();
    }));
    document.querySelectorAll("[data-settings-billing-portal]").forEach(function (button) {
      button.disabled = !state.profile.stripe_customer_id;
      if (!state.profile.stripe_customer_id) {
        button.textContent = "No Billing Account";
        button.title = "This account does not have Stripe billing details.";
      }
    });
  }

  function referralLink(code) {
    return code ? "https://forgegui.com/join/" + code : "Referral link unavailable";
  }

  function renderReferral(summary, code) {
    var link = referralLink(code || (summary && summary.referral_code));
    text("[data-settings-referral-link]", link);
    text("[data-settings-referral-count]", Number(summary && summary.referral_count || 0).toLocaleString() + " People");
    text("[data-settings-referral-credits]", Number(summary && summary.referral_credits_earned || 0).toLocaleString() + " Credits");
    document.querySelectorAll("[data-copy-referral]").forEach(function (button) {
      button.disabled = !code && !(summary && summary.referral_code);
    });
  }

  function renderRoblox() {
    var connected = !!state.roblox;
    var label = connected
      ? state.roblox.display_name || state.roblox.username || "Linked"
      : "Not Linked";
    text("[data-settings-roblox-status]", label);
    document.querySelectorAll("[data-settings-roblox]").forEach(function (button) {
      button.textContent = connected ? "Disconnect" : "Link Roblox Account";
      button.dataset.robloxConnected = connected ? "true" : "false";
    });
  }

  async function loadRoblox() {
    try {
      var result = await window.ForgeAPI.function("roblox-oauth/status", { method: "GET" });
      state.roblox = result.connected ? result.connection : null;
    } catch (_) {
      state.roblox = null;
    }
    renderRoblox();
  }

  async function loadReferral() {
    var client = window.ForgeAPI.client();
    var results = await Promise.all([
      client.rpc("ensure_referral_code"),
      client.rpc("get_my_referral_summary"),
    ]);
    renderReferral(
      results[1].error ? null : results[1].data,
      results[0].error ? null : results[0].data,
    );
  }

  async function saveName(form, button) {
    var first = form.elements.firstName.value.trim();
    var last = form.elements.lastName ? form.elements.lastName.value.trim() : "";
    var cleaned = (first + (last ? " " + last : "")).replace(/\s+/g, " ").slice(0, 50);
    if (!cleaned) {
      form.elements.firstName.reportValidity();
      return;
    }
    setBusy(button, true);
    try {
      var result = await window.ForgeAPI.client()
        .from("profiles")
        .update({ display_name: cleaned })
        .eq("id", state.session.user.id);
      if (result.error) throw result.error;
      state.profile.display_name = cleaned;
      await window.ForgeAPI.client().auth.updateUser({ data: { display_name: cleaned } });
      renderIdentity();
      closeEditor(form);
      notify("Name updated.");
    } catch (error) {
      notify(error.message || "Could not update your name.", true);
    } finally {
      setBusy(button, false);
    }
  }

  async function reauthenticate(password) {
    if (!password) throw new Error("Enter your current password.");
    await window.ForgeAPI.auth.signInWithPassword(state.session.user.email, password);
    state.session = await window.ForgeAPI.auth.session();
  }

  async function saveEmail(form, button) {
    var nextEmail = form.elements.email.value.trim();
    setBusy(button, true);
    try {
      await reauthenticate(form.elements.currentPassword.value);
      var result = await window.ForgeAPI.client().auth.updateUser({ email: nextEmail });
      if (result.error) throw result.error;
      closeEditor(form);
      notify(result.data.user && result.data.user.email === nextEmail
        ? "Email updated."
        : "Confirmation links were sent to complete the email change.");
    } catch (error) {
      notify(error.message || "Could not update your email.", true);
    } finally {
      setBusy(button, false);
    }
  }

  async function savePassword(form, button) {
    var password = form.elements.password.value;
    var confirmation = form.elements.passwordConfirmation.value;
    if (password !== confirmation) {
      form.elements.passwordConfirmation.setCustomValidity("Passwords must match");
      form.elements.passwordConfirmation.reportValidity();
      return;
    }
    form.elements.passwordConfirmation.setCustomValidity("");
    setBusy(button, true);
    try {
      await reauthenticate(form.elements.currentPassword.value);
      await window.ForgeAPI.auth.updatePassword(password);
      closeEditor(form);
      form.reset();
      notify("Password updated.");
    } catch (error) {
      notify(error.message || "Could not update your password.", true);
    } finally {
      setBusy(button, false);
    }
  }

  async function uploadAvatar(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      notify("Choose an image file.", true);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      notify("Avatar images must be smaller than 5 MB.", true);
      return;
    }
    try {
      var extension = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
      var path = state.session.user.id + "/avatar." + extension;
      var storage = window.ForgeAPI.client().storage.from("avatars");
      var upload = await storage.upload(path, file, { upsert: true, contentType: file.type });
      if (upload.error) throw upload.error;
      var publicUrl = storage.getPublicUrl(path).data.publicUrl + "?t=" + Date.now();
      var update = await window.ForgeAPI.client()
        .from("profiles")
        .update({ avatar_url: publicUrl })
        .eq("id", state.session.user.id);
      if (update.error) throw update.error;
      state.profile.avatar_url = publicUrl;
      renderIdentity();
      notify("Profile image updated.");
    } catch (error) {
      notify(error.message || "Could not upload your profile image.", true);
    } finally {
      input.value = "";
    }
  }

  async function toggleRoblox(button) {
    setBusy(button, true, state.roblox ? "Disconnecting..." : "Connecting...");
    try {
      if (state.roblox) {
        await window.ForgeAPI.function("roblox-oauth/disconnect");
        state.roblox = null;
        setBusy(button, false);
        renderRoblox();
        notify("Roblox account disconnected.");
      } else {
        var result = await window.ForgeAPI.function("roblox-oauth/start", {
          body: { return_to: location.href },
        });
        if (!result.auth_url) throw new Error("Roblox did not return a connection URL.");
        location.assign(result.auth_url);
      }
    } catch (error) {
      notify(error.message || "Could not update the Roblox connection.", true);
      setBusy(button, false);
      renderRoblox();
    }
  }

  async function openBilling(button) {
    if (!state.profile.stripe_customer_id) return;
    setBusy(button, true, "Opening...");
    try {
      var result = await window.ForgeAPI.function("stripe-billing-portal", {
        body: { returnUrl: location.href },
      });
      if (!result.url) throw new Error("Billing management did not return a URL.");
      location.assign(result.url);
    } catch (error) {
      notify(error.message || "Could not open billing management.", true);
      setBusy(button, false);
    }
  }

  async function deleteAccount(button) {
    if (!window.confirm("This permanently deletes your account, projects, and remaining credits. Continue?")) return;
    if (window.prompt('Type "DELETE" to confirm.') !== "DELETE") return;
    setBusy(button, true, "Deleting...");
    try {
      await window.ForgeAPI.function("delete-account");
      try { await window.ForgeAPI.auth.signOut(); } catch (_) {}
      location.assign(window.ForgeAPI.routeUrl("index.html").href);
    } catch (error) {
      notify(error.message || "Could not delete your account.", true);
      setBusy(button, false);
    }
  }

  document.addEventListener("submit", function (event) {
    var form = event.target.closest("form[data-settings-action]");
    if (!form) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    var button = form.querySelector('[type="submit"]') ||
      document.querySelector('[data-settings-submit="' + form.dataset.settingsAction + '"]');
    if (form.dataset.settingsAction === "name") saveName(form, button);
    if (form.dataset.settingsAction === "email") saveEmail(form, button);
    if (form.dataset.settingsAction === "password") savePassword(form, button);
  });

  document.addEventListener("input", function (event) {
    if (event.target.name === "passwordConfirmation") event.target.setCustomValidity("");
  });

  document.addEventListener("click", function (event) {
    var nameEditor = event.target.closest('[data-popup-open="change-name"], [data-settings-open="change-name"]');
    if (nameEditor) {
      setTimeout(function () {
        var form = document.querySelector('form[data-settings-action="name"]');
        if (form && form.elements.firstName) form.elements.firstName.value = displayName();
        if (form && form.elements.lastName) form.elements.lastName.value = "";
      });
    }
    var submit = event.target.closest("[data-settings-submit]");
    if (submit) {
      var popup = submit.closest("fg-popup");
      var form = popup && popup.querySelector("form[data-settings-action]");
      if (form) form.requestSubmit();
      return;
    }
    var avatar = event.target.closest("[data-avatar-upload]");
    if (avatar) {
      var input = document.querySelector("[data-avatar-input]");
      if (input) input.click();
      return;
    }
    var roblox = event.target.closest("[data-settings-roblox]");
    if (roblox) {
      toggleRoblox(roblox);
      return;
    }
    var billing = event.target.closest("[data-settings-billing-portal]");
    if (billing) {
      openBilling(billing);
      return;
    }
    var plans = event.target.closest("[data-settings-plans]");
    if (plans) {
      location.assign(window.ForgeAPI.routeUrl("plans.html").href);
      return;
    }
    var copy = event.target.closest("[data-copy-referral]");
    if (copy) {
      var link = document.querySelector("[data-settings-referral-link]");
      if (link && navigator.clipboard) {
        navigator.clipboard.writeText(link.textContent).then(function () {
          notify("Referral link copied.");
        }).catch(function () { notify("Could not copy the referral link.", true); });
      }
      return;
    }
    var invitation = event.target.closest("[data-settings-invite]");
    if (invitation) {
      var referral = document.querySelector("[data-settings-referral-link]");
      if (referral && navigator.share) navigator.share({ title: "Join me on ForgeGUI", url: referral.textContent }).catch(function () {});
      else if (referral && navigator.clipboard) navigator.clipboard.writeText(referral.textContent).then(function () { notify("Referral link copied."); });
      return;
    }
    var deletion = event.target.closest("[data-settings-delete]");
    if (deletion) deleteAccount(deletion);
  });

  document.addEventListener("change", function (event) {
    if (event.target.matches("[data-avatar-input]")) uploadAvatar(event.target);
  });

  document.addEventListener("keydown", function (event) {
    if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-avatar-upload]")) {
      event.preventDefault();
      var input = document.querySelector("[data-avatar-input]");
      if (input) input.click();
    }
  });

  async function init() {
    state.session = await window.ForgeAPI.auth.session();
    if (!state.session || !state.session.user) return;
    var profile = await window.ForgeAPI.client().rpc("get_my_sensitive_profile");
    if (profile.error) throw profile.error;
    state.profile = profile.data || {};
    renderIdentity();
    renderBilling();

    var route = routeMeta.content;
    if (route === "settings/overview.html" || route === "settings/account.html") loadRoblox();
    if (route === "settings/rewards.html") loadReferral().catch(function () {
      renderReferral(null, null);
    });
  }

  init().catch(function (error) {
    notify(error.message || "Could not load account settings.", true);
  });
})();
