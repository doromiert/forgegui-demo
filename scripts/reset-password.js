(function () {
  "use strict";

  var form = document.querySelector("[data-reset-password-form]");
  if (!form || !window.ForgeAPI) return;
  var status = form.querySelector("[data-reset-password-status]");

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!form.reportValidity()) return;
    var password = form.elements.password.value;
    var confirmation = form.elements.confirmPassword.value;
    status.classList.remove("success");
    if (password !== confirmation) {
      status.textContent = "Passwords do not match.";
      return;
    }
    if (password.length < 8) {
      status.textContent = "Password must be at least 8 characters.";
      return;
    }
    form.querySelectorAll("button, input").forEach(function (element) {
      element.disabled = true;
    });
    try {
      await window.ForgeAPI.auth.updatePassword(password);
      status.textContent = "Password updated. Opening your workspace...";
      status.classList.add("success");
      location.replace(window.ForgeAPI.routeUrl("home.html").href);
    } catch (error) {
      status.textContent = error.message || "Unable to update your password.";
      form.querySelectorAll("button, input").forEach(function (element) {
        element.disabled = false;
      });
    }
  });
})();
