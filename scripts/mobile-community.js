(function () {
    "use strict";
    var views = document.querySelectorAll("[data-community-view]");
    var activeView = "feed";

    function showView(name) {
        activeView = name;
        views.forEach(function (view) { view.hidden = view.dataset.communityView !== name; });
        var target = document.querySelector('[data-community-view="' + name + '"]');
        if (target) target.scrollTop = 0;
    }

    document.querySelectorAll("[data-community-open]").forEach(function (element) {
        function open(event) {
            if (event.target.closest("button") && !element.matches("button")) return;
            showView(element.dataset.communityOpen);
        }
        element.addEventListener("click", open);
        element.addEventListener("keydown", function (event) { if (event.key === "Enter") open(event); });
    });
    document.querySelectorAll("[data-community-close]").forEach(function (button) { button.addEventListener("click", function () { showView("feed"); }); });
    document.addEventListener("keydown", function (event) { if (event.key === "Escape" && activeView !== "feed") showView("feed"); });

    document.querySelectorAll(".mobile-community-categories button").forEach(function (button) {
        button.addEventListener("click", function () {
            document.querySelectorAll(".mobile-community-categories button").forEach(function (item) { item.classList.toggle("is-active", item === button); });
        });
    });

    var search = document.querySelector("[data-community-search]");
    if (search) search.addEventListener("input", function () {
        var query = search.value.trim().toLowerCase();
        document.querySelectorAll(".mobile-feed-post").forEach(function (post) { post.hidden = query && !post.dataset.communityItem.includes(query); });
    });

    document.querySelectorAll("[data-like]").forEach(function (button) {
        button.addEventListener("click", function (event) {
            event.stopPropagation();
            var liked = button.classList.toggle("is-liked");
            var count = button.querySelector("em");
            count.textContent = String(Number(count.textContent) + (liked ? 1 : -1));
        });
    });

    var follow = document.querySelector("[data-follow-community]");
    if (follow) follow.addEventListener("click", function () { var on = follow.classList.toggle("is-following"); follow.firstChild.textContent = on ? "Following " : "Follow "; });

    document.querySelectorAll(".mobile-post-field input, .mobile-post-field textarea").forEach(function (field) {
        field.addEventListener("input", function () { field.parentElement.querySelector("span").textContent = field.value.length + "/" + field.maxLength; });
    });

    var commentForm = document.querySelector("[data-comment-form]");
    if (commentForm) commentForm.addEventListener("submit", function (event) {
        event.preventDefault(); var input = commentForm.querySelector("input"); if (!input.value.trim()) return;
        var article = document.createElement("article"); article.innerHTML = "<h3>You</h3><p></p>"; article.querySelector("p").textContent = input.value.trim(); document.querySelector("[data-comments-list]").prepend(article); input.value = "";
        var count = document.querySelector("[data-comment-count]"); count.textContent = String(Number(count.textContent) + 1);
    });

    var createForm = document.querySelector("[data-create-post-form]");
    if (createForm) createForm.addEventListener("submit", function (event) {
        event.preventDefault(); var title = createForm.querySelector("input").value.trim(); var text = createForm.querySelector("textarea").value.trim(); if (!title && !text) return;
        var post = document.createElement("article"); post.className = "mobile-feed-post"; post.dataset.communityItem = (title + " " + text).toLowerCase(); post.innerHTML = '<header><img src="assets/generic.png" alt=""><strong>You</strong><i></i><span>Now</span></header><div class="mobile-feed-text"><h2></h2><p></p></div>'; post.querySelector("h2").textContent = title || "New Post"; post.querySelector("p").textContent = text; document.querySelector(".mobile-community-posts").prepend(post); createForm.reset(); createForm.querySelectorAll(".mobile-post-field span").forEach(function (counter) { counter.textContent = counter.textContent.replace(/^\d+/, "0"); }); showView("feed");
    });

    showView("feed");
})();
