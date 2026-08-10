(function () {
  "use strict";

  var api = window.ForgeAPI;
  var modal = document.querySelector("[data-login-modal]");
  if (!api || !modal) return;

  function status(form, message, success) {
    var element = form.querySelector("[data-auth-status]");
    if (!element) return;
    element.textContent = message || "";
    element.hidden = !message;
    element.classList.toggle("success", Boolean(success));
  }

  function setBusy(form, busy) {
    form.querySelectorAll("button, input").forEach(function (element) {
      element.disabled = busy;
    });
    form.setAttribute("aria-busy", String(busy));
  }

  function destination(fallback) {
    return api.routeUrl(api.auth.consumeReturnPath(fallback)).href;
  }

  function showStep(name) {
    modal.querySelectorAll("[data-login-step]").forEach(function (step) {
      step.hidden = step.dataset.loginStep !== name;
    });
    modal.hidden = false;
    document.body.classList.add("modal-open");
  }

  function captchaDialog() {
    var overlay = document.createElement("div");
    overlay.className = "forge-captcha";
    overlay.innerHTML = [
      '<section class="forge-captcha-panel" role="dialog" aria-modal="true" aria-labelledby="forge-captcha-title">',
      '<header class="forge-captcha-header"><h3 id="forge-captcha-title">Verify you are human</h3>',
      '<button class="forge-captcha-close" type="button" aria-label="Close">Close</button></header>',
      '<p class="forge-captcha-prompt">Loading challenge...</p>',
      '<div class="forge-captcha-grid"></div>',
      '<p class="forge-captcha-error" role="status"></p>',
      '<button class="forge-captcha-refresh" type="button">Refresh challenge</button>',
      "</section>",
    ].join("");
    document.body.appendChild(overlay);

    var challenge = null;
    var grid = overlay.querySelector(".forge-captcha-grid");
    var prompt = overlay.querySelector(".forge-captcha-prompt");
    var errorElement = overlay.querySelector(".forge-captcha-error");
    var settled = false;

    return new Promise(function (resolve, reject) {
      function close(error) {
        if (settled) return;
        settled = true;
        overlay.remove();
        if (error) reject(error);
        else resolve(null);
      }

      async function load() {
        grid.innerHTML = "";
        errorElement.textContent = "";
        prompt.textContent = "Loading challenge...";
        try {
          challenge = await api.function("captcha-issue", { body: {} });
          prompt.textContent = challenge.prompt;
          challenge.tiles.forEach(function (tile, index) {
            var button = document.createElement("button");
            button.className = "forge-captcha-tile";
            button.type = "button";
            button.textContent = tile.icon;
            button.setAttribute("aria-label", tile.icon);
            button.addEventListener("click", function () { verify(index); });
            grid.appendChild(button);
          });
        } catch (error) {
          prompt.textContent = "Challenge unavailable";
          errorElement.textContent = error.message;
        }
      }

      async function verify(index) {
        if (!challenge) return;
        grid.querySelectorAll("button").forEach(function (button) {
          button.disabled = true;
        });
        try {
          var result = await api.function("captcha-verify", {
            body: {
              challenge_id: challenge.challenge_id,
              answer: String(index),
            },
          });
          settled = true;
          overlay.remove();
          resolve({ challengeId: challenge.challenge_id, token: result.token });
        } catch (error) {
          errorElement.textContent = error.message;
          await load();
        }
      }

      overlay.querySelector(".forge-captcha-close").addEventListener("click", function () {
        close();
      });
      overlay.querySelector(".forge-captcha-refresh").addEventListener("click", load);
      overlay.addEventListener("click", function (event) {
        if (event.target === overlay) close();
      });
      load();
    });
  }

  modal.querySelectorAll("[data-auth-form]").forEach(function (form) {
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      var values = new FormData(form);
      var email = String(values.get("email") || "");
      var password = String(values.get("password") || "");
      var mode = form.dataset.authMode;
      status(form, "");

      if (password.length < 8 && mode === "signup") {
        status(form, "Password must be at least 8 characters.");
        return;
      }
      if (mode === "signup" && password !== String(values.get("confirmPassword") || "")) {
        status(form, "Passwords do not match.");
        return;
      }

      try {
        setBusy(form, true);
        if (mode === "signin") {
          await api.auth.signInWithPassword(email, password);
          status(form, "Signed in. Opening your workspace...", true);
          location.assign(destination("home.html"));
          return;
        }

        var captcha = await captchaDialog();
        if (!captcha) return;
        await api.auth.signUpWithCaptcha({
          name: String(values.get("name") || ""),
          email: email,
          password: password,
          challengeId: captcha.challengeId,
          captchaToken: captcha.token,
        });
        status(form, "Account created. Starting setup...", true);
        location.assign(destination("home.html"));
      } catch (error) {
        status(form, error.message || "Authentication failed. Please try again.");
      } finally {
        setBusy(form, false);
      }
    });
  });

  modal.querySelectorAll("[data-auth-google]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var form = modal.querySelector('[data-auth-mode="signin"]');
      status(form, "");
      button.disabled = true;
      try {
        var returnRoute = api.auth.consumeReturnPath("home.html");
        await api.auth.signInWithGoogle(returnRoute);
      } catch (error) {
        status(form, error.message || "Unable to start Google sign-in.");
        showStep("signin");
        button.disabled = false;
      }
    });
  });

  modal.querySelectorAll("[data-auth-forgot]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var form = button.closest("form");
      var input = form.elements.email;
      if (!input || !input.reportValidity()) return;
      button.disabled = true;
      status(form, "");
      try {
        await api.auth.resetPasswordForEmail(input.value);
        status(form, "Password reset link sent. Check your email.", true);
      } catch (error) {
        status(form, error.message || "Unable to send a reset link.");
      } finally {
        button.disabled = false;
      }
    });
  });

  var requestedMode = new URLSearchParams(location.search).get("auth");
  if (requestedMode === "signin" || requestedMode === "signup") {
    showStep(requestedMode);
  }
})();
