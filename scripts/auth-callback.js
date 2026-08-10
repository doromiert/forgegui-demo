(function () {
  "use strict";

  var status = document.querySelector("[data-auth-callback-status]");
  if (!status || !window.ForgeAPI) return;
  var params = new URLSearchParams(location.search);
  if (params.has("error") || params.has("error_code")) {
    status.textContent = "Google sign-in was cancelled or denied.";
    return;
  }

  window.ForgeAPI.auth.finishOAuth().then(function (route) {
    status.textContent = "Signed in. Opening your workspace...";
    location.replace(window.ForgeAPI.routeUrl(route).href);
  }).catch(function (error) {
    status.textContent = error.message;
  });
})();
