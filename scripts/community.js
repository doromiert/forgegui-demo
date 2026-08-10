(function () {
  "use strict";

  if (!window.ForgeAPI) return;
  var routeMeta = document.querySelector('meta[name="forge-route"]');
  if (!routeMeta || routeMeta.content !== "community.html") return;

  var api = window.ForgeAPI;
  var client;
  var session;
  var posts = new Map();
  var activePost = null;
  var selectedAuthorId = null;
  var selectedCategory = "";
  var selectedFiles = [];
  var activeView = "feed";
  var isMobile = !!document.querySelector(".mobile-community");
  var fallbackAvatar = api.routeUrl("assets/generic.png").href;

  function all(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function text(selector, value, root) {
    all(selector, root).forEach(function (element) { element.textContent = value; });
  }

  function countLabel(value) {
    return Number(value || 0).toLocaleString();
  }

  function userHandle(name) {
    var value = String(name || "user").toLowerCase().replace(/[^a-z0-9_]+/g, "");
    return "@" + (value || "user");
  }

  function relativeTime(value) {
    var elapsed = Date.now() - new Date(value).getTime();
    if (!Number.isFinite(elapsed) || elapsed < 60000) return "now";
    var minutes = Math.floor(elapsed / 60000);
    if (minutes < 60) return minutes + "m ago";
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + "h ago";
    var days = Math.floor(hours / 24);
    if (days < 30) return days + "d ago";
    return new Date(value).toLocaleDateString();
  }

  function postImages(post) {
    var values = post.image_urls;
    if (typeof values === "string") {
      try { values = JSON.parse(values); } catch (_) { values = []; }
    }
    if (!Array.isArray(values)) values = [];
    if (!values.length && post.image_url) values = [post.image_url];
    return values.filter(function (value) { return typeof value === "string" && value; }).slice(0, 4);
  }

  function toast(message, failed) {
    var status = document.querySelector("[data-community-toast]");
    if (!status) {
      status = document.createElement("div");
      status.dataset.communityToast = "";
      status.setAttribute("role", "status");
      status.style.cssText = "position:fixed;right:18px;top:18px;z-index:1000000000;max-width:min(390px,calc(100vw - 36px));padding:12px 16px;border:1px solid rgba(255,255,255,.18);border-radius:10px;background:#181818;color:#fff;box-shadow:0 16px 46px rgba(0,0,0,.5);font:500 16px/1.35 system-ui,sans-serif";
      document.body.appendChild(status);
    }
    status.style.borderColor = failed ? "rgba(255,100,100,.55)" : "rgba(100,210,150,.45)";
    status.textContent = message;
    status.hidden = false;
    clearTimeout(status._timer);
    status._timer = setTimeout(function () { status.hidden = true; }, 4000);
  }

  function showFeedStatus(message, failed) {
    var feed = document.querySelector("[data-community-feed]");
    if (!feed) return;
    feed.innerHTML = "";
    var status = document.createElement("p");
    status.className = "communityStatus" + (failed ? " is-error" : "");
    status.dataset.communityStatus = "";
    status.textContent = message;
    feed.appendChild(status);
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      button.dataset.idleHtml = button.innerHTML;
      button.disabled = true;
      if (label) button.textContent = label;
    } else {
      button.disabled = false;
      if (button.dataset.idleHtml !== undefined) button.innerHTML = button.dataset.idleHtml;
      delete button.dataset.idleHtml;
    }
  }

  function createImage(source, alt) {
    var image = document.createElement("img");
    image.src = source || fallbackAvatar;
    image.alt = alt || "";
    return image;
  }

  function createDesktopPost(post) {
    var article = document.createElement("fg-post");
    article.dataset.postId = post.id;
    article.dataset.authorId = post.user_id;
    article.dataset.communityItem = [post.title, post.description, post.dev_type_tag, post.platform_tag, post.author_display_name].join(" ").toLowerCase();
    article.tabIndex = 0;

    var header = document.createElement("fg-top");
    var avatar = createImage(post.author_avatar_url, post.author_display_name || "Post author");
    avatar.dataset.communityAuthorAvatar = "";
    var name = document.createElement("fg-username");
    name.textContent = post.author_display_name || "User";
    var dot = document.createElement("div");
    dot.style.cssText = "width:6px;height:6px;border-radius:50%;background:white;flex-shrink:0";
    var timestamp = document.createElement("fg-timestamp");
    timestamp.textContent = relativeTime(post.created_at);
    var spacer = document.createElement("div");
    spacer.style.flex = "1";
    header.append(avatar, name, dot, timestamp, spacer);
    var tagText = post.dev_type_tag || post.platform_tag;
    if (tagText) {
      var tag = document.createElement("fg-posttag");
      tag.textContent = tagText;
      if (/ai/i.test(tagText)) tag.className = "ai";
      header.appendChild(tag);
    }
    var options = createImage(api.routeUrl("icons/3dots.svg").href, "");
    options.dataset.communityOptions = "";
    header.appendChild(options);
    article.appendChild(header);

    var images = postImages(post);
    var content = document.createElement("fg-content");
    if (images.length) {
      content.className = "img";
      content.appendChild(createImage(images[0], post.title));
    } else {
      content.className = "text";
      var title = document.createElement("h1");
      title.textContent = post.title;
      var description = document.createElement("p");
      description.textContent = post.description || "";
      content.append(title, description);
    }
    article.appendChild(content);

    var footer = document.createElement("fg-bottom");
    var share = createImage(api.routeUrl("icons/share.svg").href, "Share");
    share.dataset.communityShare = "";
    share.dataset.postId = post.id;
    var footerSpacer = document.createElement("div");
    footerSpacer.style.flex = "1";
    var like = document.createElement("fg-engagement");
    like.dataset.communityLike = "";
    like.dataset.postId = post.id;
    like.tabIndex = 0;
    like.setAttribute("role", "button");
    like.setAttribute("aria-pressed", String(!!post.has_liked));
    like.classList.toggle("is-liked", !!post.has_liked);
    like.append(createImage(api.routeUrl("icons/heart.svg").href, "Like"), document.createElement("span"));
    like.querySelector("span").textContent = countLabel(post.likes_count);
    var comments = document.createElement("fg-engagement");
    comments.dataset.communityComments = "";
    comments.dataset.postId = post.id;
    comments.tabIndex = 0;
    comments.setAttribute("role", "button");
    comments.append(createImage(api.routeUrl("icons/message.svg").href, "Comments"), document.createElement("span"));
    comments.querySelector("span").textContent = countLabel(post.comments_count);
    footer.append(share, footerSpacer, like, comments);
    article.appendChild(footer);
    return article;
  }

  function createMobilePost(post) {
    var article = document.createElement("article");
    article.className = "mobile-feed-post";
    article.dataset.postId = post.id;
    article.dataset.authorId = post.user_id;
    article.dataset.communityItem = [post.title, post.description, post.dev_type_tag, post.platform_tag, post.author_display_name].join(" ").toLowerCase();
    article.tabIndex = 0;
    var header = document.createElement("header");
    var avatar = createImage(post.author_avatar_url, post.author_display_name || "Post author");
    avatar.dataset.communityAuthorAvatar = "";
    var name = document.createElement("strong");
    name.textContent = post.author_display_name || "User";
    var dot = document.createElement("i");
    var timestamp = document.createElement("span");
    timestamp.textContent = relativeTime(post.created_at);
    header.append(avatar, name, dot, timestamp);
    var tagText = post.dev_type_tag || post.platform_tag;
    if (tagText) {
      var tag = document.createElement("b");
      tag.textContent = tagText;
      header.appendChild(tag);
    }
    var options = document.createElement("button");
    options.type = "button";
    options.dataset.communityOptions = "";
    options.setAttribute("aria-label", "Post options");
    options.appendChild(createImage(api.routeUrl("icons/3dots.svg").href));
    header.appendChild(options);
    article.appendChild(header);
    var images = postImages(post);
    if (images.length) {
      var media = createImage(images[0], post.title);
      media.className = "mobile-feed-media";
      article.appendChild(media);
    } else {
      var copy = document.createElement("div");
      copy.className = "mobile-feed-text";
      var title = document.createElement("h2");
      title.textContent = post.title;
      var description = document.createElement("p");
      description.textContent = post.description || "";
      copy.append(title, description);
      article.appendChild(copy);
    }
    var footer = document.createElement("footer");
    var share = document.createElement("button");
    share.type = "button";
    share.dataset.communityShare = "";
    share.dataset.postId = post.id;
    share.setAttribute("aria-label", "Share");
    share.appendChild(createImage(api.routeUrl("icons/share.svg").href));
    var spacer = document.createElement("span");
    var like = document.createElement("button");
    like.type = "button";
    like.dataset.communityLike = "";
    like.dataset.postId = post.id;
    like.classList.toggle("is-liked", !!post.has_liked);
    like.setAttribute("aria-pressed", String(!!post.has_liked));
    like.append(createImage(api.routeUrl("icons/heart.svg").href), document.createElement("em"));
    like.querySelector("em").textContent = countLabel(post.likes_count);
    var comments = document.createElement("button");
    comments.type = "button";
    comments.dataset.communityComments = "";
    comments.dataset.postId = post.id;
    comments.append(createImage(api.routeUrl("icons/message.svg").href), document.createElement("em"));
    comments.querySelector("em").textContent = countLabel(post.comments_count);
    footer.append(share, spacer, like, comments);
    article.appendChild(footer);
    return article;
  }

  function renderFeed(feedPosts, root) {
    var feed = root || document.querySelector("[data-community-feed]");
    if (!feed) return;
    feed.innerHTML = "";
    if (!feedPosts.length) {
      var empty = document.createElement("p");
      empty.className = "communityStatus";
      empty.textContent = selectedCategory
        ? "No posts in " + selectedCategory + " yet."
        : "No Community posts yet. Be the first to share something.";
      feed.appendChild(empty);
      return;
    }
    feedPosts.forEach(function (post) {
      feed.appendChild(isMobile ? createMobilePost(post) : createDesktopPost(post));
    });
    applySearch();
  }

  async function enrichPosts(feedPosts) {
    if (!feedPosts.length) return [];
    var userIds = Array.from(new Set(feedPosts.map(function (post) { return post.user_id; })));
    var postIds = feedPosts.map(function (post) { return post.id; });
    var results = await Promise.all([
      client.from("profiles").select("id,display_name,avatar_url,bio,banner_url").in("id", userIds),
      client.from("community_post_likes").select("post_id").eq("user_id", session.user.id).in("post_id", postIds),
    ]);
    var profileMap = new Map((results[0].data || []).map(function (profile) { return [profile.id, profile]; }));
    var liked = new Set((results[1].data || []).map(function (row) { return row.post_id; }));
    return feedPosts.map(function (post) {
      var profile = profileMap.get(post.user_id) || {};
      return Object.assign({}, post, {
        author_display_name: profile.display_name || "User",
        author_avatar_url: profile.avatar_url || null,
        author_bio: profile.bio || "",
        author_banner_url: profile.banner_url || "",
        has_liked: liked.has(post.id),
      });
    });
  }

  async function loadFeed() {
    showFeedStatus("Loading Community...");
    var result = await client.rpc("get_community_feed", {
      p_limit: 30,
      p_offset: 0,
      p_sort: "trending",
      p_platform_tags: null,
      p_dev_type_tags: selectedCategory ? [selectedCategory] : null,
    });
    if (result.error) throw result.error;
    var enriched = await enrichPosts(result.data || []);
    posts = new Map(enriched.map(function (post) { return [post.id, post]; }));
    renderFeed(enriched);
    var requested = new URLSearchParams(location.search).get("post");
    if (requested) {
      var post = posts.get(requested) || await loadSinglePost(requested);
      if (post) openDetail(post, false);
    }
  }

  async function loadSinglePost(id) {
    var result = await client.from("community_posts").select("*").eq("id", id).maybeSingle();
    if (result.error || !result.data) return null;
    var enriched = await enrichPosts([result.data]);
    if (!enriched[0]) return null;
    posts.set(id, enriched[0]);
    return enriched[0];
  }

  function showMobileView(name) {
    activeView = name;
    all("[data-community-view]").forEach(function (view) {
      view.hidden = view.dataset.communityView !== name;
    });
    var target = document.querySelector('[data-community-view="' + name + '"]');
    if (target) target.scrollTop = 0;
  }

  function renderDetail(post) {
    var name = post.author_display_name || "User";
    text("[data-community-detail-name]", name);
    text("[data-community-detail-handle]", userHandle(name));
    text("[data-community-detail-title]", post.title || "Community post");
    text("[data-community-detail-description]", post.description || "");
    text("[data-community-detail-likes]", countLabel(post.likes_count));
    text("[data-community-detail-comments]", countLabel(post.comments_count));
    text("[data-community-comment-count]", countLabel(post.comments_count));
    all("[data-community-detail-avatar]").forEach(function (image) {
      image.src = post.author_avatar_url || fallbackAvatar;
    });
    all("[data-community-like]").forEach(function (button) {
      if (button.closest("[data-community-feed]")) return;
      button.dataset.postId = post.id;
      button.classList.toggle("is-liked", !!post.has_liked);
      button.setAttribute("aria-pressed", String(!!post.has_liked));
    });
    var images = postImages(post);
    all("[data-community-detail-media]").forEach(function (media) {
      var image = media.matches("img") ? media : media.querySelector("img");
      media.hidden = !images.length;
      if (image && images.length) {
        image.src = images[0];
        image.alt = post.title || "Community post image";
      }
    });
    all("[data-community-detail-tags]").forEach(function (tags) {
      tags.innerHTML = "";
      [post.dev_type_tag, post.platform_tag].filter(Boolean).forEach(function (value) {
        var tag = document.createElement(isMobile ? "b" : "fg-tag");
        tag.textContent = value;
        tags.appendChild(tag);
      });
    });
    all("[data-community-follow]").forEach(function (button) {
      button.hidden = post.user_id === session.user.id;
      button.dataset.authorId = post.user_id;
    });
  }

  async function loadComments(post) {
    var result = await client
      .from("community_comments")
      .select("id,user_id,content,created_at,likes_count")
      .eq("post_id", post.id)
      .order("created_at", { ascending: true });
    if (result.error) throw result.error;
    var comments = result.data || [];
    var userIds = Array.from(new Set(comments.map(function (comment) { return comment.user_id; })));
    var profiles = userIds.length
      ? await client.from("profiles").select("id,display_name,avatar_url").in("id", userIds)
      : { data: [] };
    var profileMap = new Map((profiles.data || []).map(function (profile) { return [profile.id, profile]; }));
    var list = document.querySelector("[data-community-comments-list]");
    if (!list) return;
    list.innerHTML = "";
    if (!comments.length) {
      var empty = document.createElement("p");
      empty.className = "communityCommentEmpty";
      empty.textContent = "No comments yet.";
      list.appendChild(empty);
    } else {
      comments.forEach(function (comment) {
        var profile = profileMap.get(comment.user_id) || {};
        if (isMobile) {
          var article = document.createElement("article");
          var header = document.createElement("header");
          header.append(createImage(profile.avatar_url, profile.display_name || "User"), document.createElement("strong"), document.createElement("span"));
          header.querySelector("strong").textContent = profile.display_name || "User";
          header.querySelector("span").textContent = relativeTime(comment.created_at);
          var body = document.createElement("p");
          body.textContent = comment.content;
          article.append(header, body);
          list.appendChild(article);
        } else {
          var postElement = document.createElement("fg-post");
          postElement.className = "communityComment";
          var top = document.createElement("fg-top");
          top.append(createImage(profile.avatar_url, profile.display_name || "User"), document.createElement("fg-username"), document.createElement("fg-timestamp"));
          top.querySelector("fg-username").textContent = profile.display_name || "User";
          top.querySelector("fg-timestamp").textContent = relativeTime(comment.created_at);
          var content = document.createElement("fg-content");
          content.className = "text";
          var bodyText = document.createElement("p");
          bodyText.textContent = comment.content;
          content.appendChild(bodyText);
          postElement.append(top, content);
          list.appendChild(postElement);
        }
      });
    }
    post.comments_count = comments.length;
    text("[data-community-detail-comments]", countLabel(comments.length));
    text("[data-community-comment-count]", countLabel(comments.length));
    updateFeedPost(post);
  }

  async function loadFollowing(authorId) {
    if (authorId === session.user.id) return;
    var result = await client.from("community_follows")
      .select("id")
      .eq("follower_id", session.user.id)
      .eq("following_id", authorId)
      .maybeSingle();
    setFollowing(authorId, !!result.data);
  }

  function setFollowing(authorId, following) {
    all('[data-community-follow][data-author-id="' + authorId + '"]').forEach(function (button) {
      button.classList.toggle("is-following", following);
      var label = button.querySelector("b");
      if (label) label.textContent = following ? "Following" : "Follow";
      else if (button.firstChild) button.firstChild.textContent = following ? "Following " : "Follow ";
      button.setAttribute("aria-pressed", String(following));
    });
  }

  async function openDetail(post, updateUrl) {
    activePost = post;
    selectedAuthorId = post.user_id;
    renderDetail(post);
    if (isMobile) showMobileView("detail");
    else if (typeof window.openPopup === "function") window.openPopup("post-detail");
    if (updateUrl !== false) {
      var url = new URL(location.href);
      url.searchParams.set("post", post.id);
      history.replaceState({}, "", url.href);
    }
    await Promise.all([loadComments(post), loadFollowing(post.user_id)]);
  }

  function closeDetail() {
    if (isMobile) showMobileView("feed");
    var url = new URL(location.href);
    url.searchParams.delete("post");
    history.replaceState({}, "", url.href);
    activePost = null;
  }

  function updateFeedPost(post) {
    posts.set(post.id, post);
    all('[data-post-id="' + post.id + '"]').forEach(function (element) {
      if (element.matches("[data-community-like]")) {
        element.classList.toggle("is-liked", !!post.has_liked);
        element.setAttribute("aria-pressed", String(!!post.has_liked));
        var count = element.querySelector("span,em");
        if (count) count.textContent = countLabel(post.likes_count);
      }
      if (element.matches("[data-community-comments]")) {
        var comments = element.querySelector("span,em");
        if (comments) comments.textContent = countLabel(post.comments_count);
      }
    });
    if (activePost && activePost.id === post.id) renderDetail(post);
  }

  async function toggleLike(postId) {
    var post = posts.get(postId) || activePost;
    if (!post || post.id !== postId) return;
    var previous = { liked: !!post.has_liked, count: Number(post.likes_count || 0) };
    post.has_liked = !previous.liked;
    post.likes_count = Math.max(0, previous.count + (post.has_liked ? 1 : -1));
    updateFeedPost(post);
    var result = await client.rpc("toggle_my_community_post_like", { p_post_id: postId });
    if (result.error) {
      post.has_liked = previous.liked;
      post.likes_count = previous.count;
      updateFeedPost(post);
      throw result.error;
    }
    post.has_liked = !!result.data.liked;
    post.likes_count = Number(result.data.count || 0);
    updateFeedPost(post);
  }

  async function toggleFollow(authorId, button) {
    if (!authorId || authorId === session.user.id) return;
    button.disabled = true;
    try {
      var result = await client.rpc("toggle_my_community_follow", { p_following_id: authorId });
      if (result.error) throw result.error;
      setFollowing(authorId, !!result.data.following);
      text("[data-community-context-followers]", countLabel(result.data.count));
      text("[data-community-profile-followers]", countLabel(result.data.count));
    } finally {
      button.disabled = false;
    }
  }

  async function submitComment(form) {
    if (!activePost) return;
    var input = form.querySelector("input");
    var content = input.value.trim();
    if (!content) return;
    var button = form.querySelector('[type="submit"]');
    setBusy(button, true);
    try {
      var moderation = await api.function("moderate-post", {
        body: { title: "", description: content, imageUrls: [], contentType: "comment" },
      });
      if (!moderation.approved) throw new Error(moderation.reason || "That comment cannot be posted.");
      var result = await client.rpc("add_my_community_comment", {
        p_post_id: activePost.id,
        p_content: content,
      });
      if (result.error) throw result.error;
      input.value = "";
      activePost.comments_count = Number(result.data.count || 0);
      await loadComments(activePost);
    } finally {
      setBusy(button, false);
    }
  }

  function renderMediaPreviews() {
    var desktop = document.querySelector("fg-mediaplaceholder[data-community-media-preview]");
    if (desktop) {
      desktop.innerHTML = "";
      selectedFiles.forEach(function (file) {
        var image = createImage(URL.createObjectURL(file), file.name);
        image.onload = function () { URL.revokeObjectURL(image.src); };
        desktop.appendChild(image);
      });
    }
    var mobile = document.querySelector(".mobile-post-media [data-community-media-preview]");
    if (mobile) {
      mobile.innerHTML = "";
      selectedFiles.forEach(function (file) {
        var image = createImage(URL.createObjectURL(file), file.name);
        image.onload = function () { URL.revokeObjectURL(image.src); };
        mobile.appendChild(image);
      });
    }
  }

  function selectMedia(input) {
    var files = Array.from(input.files || []).filter(function (file) {
      return file.type.startsWith("image/") && file.size <= 10 * 1024 * 1024;
    });
    selectedFiles = selectedFiles.concat(files).slice(0, 4);
    input.value = "";
    renderMediaPreviews();
    if (files.length < (input.files || []).length) toast("Only image files under 10 MB can be uploaded.", true);
  }

  async function uploadMedia() {
    var storage = client.storage.from("asset-images");
    var uploaded = [];
    for (var index = 0; index < selectedFiles.length; index += 1) {
      var file = selectedFiles[index];
      var extension = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
      var path = session.user.id + "/community/" + api.uuid() + "." + extension;
      var result = await storage.upload(path, file, { cacheControl: "31536000", contentType: file.type });
      if (result.error) throw result.error;
      uploaded.push({ path: path, url: storage.getPublicUrl(path).data.publicUrl });
    }
    return uploaded;
  }

  async function submitPost(form, button) {
    var titleInput = form.elements.title;
    var descriptionInput = form.elements.description;
    var title = titleInput.value.trim();
    var description = descriptionInput.value.trim();
    if (!title && !description && !selectedFiles.length) throw new Error("Add a title, some text, or an image first.");
    setBusy(button, true, "Uploading...");
    var uploaded = [];
    try {
      var textModeration = await api.function("moderate-post", {
        body: { title: title, description: description, imageUrls: [], contentType: "post" },
      });
      if (!textModeration.approved) throw new Error(textModeration.reason || "That post cannot be published.");
      uploaded = await uploadMedia();
      if (uploaded.length) {
        var imageModeration = await api.function("moderate-post", {
          body: { title: title, description: description, imageUrls: uploaded.map(function (item) { return item.url; }), contentType: "post" },
        });
        if (!imageModeration.approved) throw new Error(imageModeration.reason || "One of those images cannot be published.");
      }
      var result = await client.rpc("create_my_community_post", {
        p_title: title,
        p_description: description,
        p_image_urls: uploaded.map(function (item) { return item.url; }),
        p_platform_tag: "",
        p_dev_type_tag: selectedCategory,
      });
      if (result.error) throw result.error;
      form.reset();
      selectedFiles = [];
      renderMediaPreviews();
      if (isMobile) showMobileView("feed");
      else if (typeof window.closePopup === "function") window.closePopup();
      selectedCategory = "";
      all("[data-community-category]").forEach(function (item) {
        item.classList.toggle(isMobile ? "is-active" : "active", !item.dataset.communityCategory);
      });
      await loadFeed();
      toast("Post published.");
    } catch (error) {
      if (uploaded.length) {
        await client.storage.from("asset-images").remove(uploaded.map(function (item) { return item.path; }));
      }
      throw error;
    } finally {
      setBusy(button, false);
    }
  }

  async function sharePost(postId) {
    var url = new URL(api.routeUrl("community.html").href);
    url.searchParams.set("post", postId);
    if (navigator.share) {
      await navigator.share({ title: "ForgeGUI Community", url: url.href }).catch(function () {});
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(url.href);
      toast("Post link copied.");
    }
  }

  function openAuthorContext(post, avatar) {
    if (isMobile) return;
    selectedAuthorId = post.user_id;
    var context = document.querySelector("[data-community-user-context]");
    if (!context) return;
    text("[data-community-context-name]", post.author_display_name || "User", context);
    text("[data-community-context-handle]", userHandle(post.author_display_name), context);
    var image = context.querySelector("[data-community-context-avatar]");
    if (image) image.src = post.author_avatar_url || fallbackAvatar;
    all("[data-community-follow]", context).forEach(function (button) {
      button.hidden = post.user_id === session.user.id;
      button.dataset.authorId = post.user_id;
    });
    var rect = avatar.getBoundingClientRect();
    context.style.top = rect.top + "px";
    context.style.left = Math.max(10, rect.left - 290) + "px";
    context.classList.add("visible");
    client.from("community_follows").select("*", { count: "exact", head: true }).eq("following_id", post.user_id)
      .then(function (result) { text("[data-community-context-followers]", countLabel(result.count), context); });
    loadFollowing(post.user_id);
  }

  async function loadProfile(authorId) {
    var results = await Promise.all([
      client.from("profiles").select("id,display_name,avatar_url,bio,banner_url").eq("id", authorId).maybeSingle(),
      client.from("community_follows").select("*", { count: "exact", head: true }).eq("following_id", authorId),
      client.from("community_post_likes").select("post_id,community_posts!inner(user_id)", { count: "exact", head: true }).eq("community_posts.user_id", authorId),
      client.from("community_posts").select("*").eq("user_id", authorId).order("created_at", { ascending: false }).limit(20),
    ]);
    var profile = results[0].data;
    if (!profile) throw new Error("Profile not found.");
    var name = profile.display_name || "User";
    text("[data-community-profile-name]", name);
    text("[data-community-profile-handle]", userHandle(name));
    text("[data-community-profile-followers]", countLabel(results[1].count));
    text("[data-community-profile-likes]", countLabel(results[2].count));
    text("[data-community-profile-bio]", profile.bio || "No biography yet.");
    all("[data-community-profile-avatar]").forEach(function (image) { image.src = profile.avatar_url || fallbackAvatar; });
    all("#user-profile [data-community-follow]").forEach(function (button) {
      button.hidden = authorId === session.user.id;
      button.dataset.authorId = authorId;
    });
    var enriched = await enrichPosts(results[3].data || []);
    var host = document.querySelector("[data-community-profile-posts]");
    if (host) renderFeed(enriched, host);
    await loadFollowing(authorId);
  }

  function applySearch() {
    var search = document.querySelector("[data-community-search]");
    var query = search ? search.value.trim().toLowerCase() : "";
    all("[data-community-feed] [data-community-item]").forEach(function (post) {
      post.hidden = !!query && !post.dataset.communityItem.includes(query);
    });
  }

  document.addEventListener("click", function (event) {
    var category = event.target.closest("[data-community-category]");
    if (category) {
      selectedCategory = category.dataset.communityCategory;
      all("[data-community-category]").forEach(function (item) {
        item.classList.toggle(isMobile ? "is-active" : "active", item === category);
      });
      loadFeed().catch(function (error) { showFeedStatus(error.message, true); });
      return;
    }
    var addMedia = event.target.closest("[data-community-add-media]");
    if (addMedia) {
      var input = document.querySelector("[data-community-media-input]");
      if (input) input.click();
      return;
    }
    var createOpen = event.target.closest('[data-community-open="create"]');
    if (createOpen) {
      showMobileView("create");
      return;
    }
    var close = event.target.closest("[data-community-close]");
    if (close) {
      closeDetail();
      return;
    }
    var like = event.target.closest("[data-community-like]");
    if (like) {
      event.stopPropagation();
      var likeId = like.dataset.postId || (activePost && activePost.id);
      if (likeId) toggleLike(likeId).catch(function (error) { toast(error.message, true); });
      return;
    }
    var share = event.target.closest("[data-community-share]");
    if (share) {
      event.stopPropagation();
      var shareId = share.dataset.postId || (activePost && activePost.id);
      if (shareId) sharePost(shareId).catch(function (error) { toast(error.message, true); });
      return;
    }
    var follow = event.target.closest("[data-community-follow]");
    if (follow) {
      event.stopPropagation();
      toggleFollow(follow.dataset.authorId || selectedAuthorId, follow).catch(function (error) { toast(error.message, true); });
      return;
    }
    var profile = event.target.closest('[data-popup-open="user-profile"]');
    if (profile && selectedAuthorId) {
      loadProfile(selectedAuthorId).catch(function (error) { toast(error.message, true); });
      return;
    }
    var postElement = event.target.closest("[data-post-id]");
    if (postElement && postElement.closest("[data-community-feed]")) {
      var post = posts.get(postElement.dataset.postId);
      if (!post) return;
      if (event.target.closest("[data-community-author-avatar]")) {
        event.stopPropagation();
        openAuthorContext(post, event.target.closest("[data-community-author-avatar]"));
        return;
      }
      if (event.target.closest("[data-community-options]")) return;
      openDetail(post).catch(function (error) { toast(error.message, true); });
      return;
    }
    var context = document.querySelector("[data-community-user-context]");
    if (context && !context.contains(event.target)) context.classList.remove("visible");
  });

  document.addEventListener("submit", function (event) {
    var createForm = event.target.closest("[data-create-post-form], [data-community-create-form]");
    if (createForm) {
      event.preventDefault();
      var button = createForm.querySelector('[type="submit"]') || document.querySelector("[data-community-create-submit]");
      submitPost(createForm, button).catch(function (error) { toast(error.message, true); });
      return;
    }
    var commentForm = event.target.closest("[data-comment-form], [data-community-comment-form]");
    if (commentForm) {
      event.preventDefault();
      submitComment(commentForm).catch(function (error) { toast(error.message, true); });
    }
  });

  document.addEventListener("change", function (event) {
    if (event.target.matches("[data-community-media-input]")) selectMedia(event.target);
  });

  document.addEventListener("input", function (event) {
    if (event.target.matches("[data-community-search]")) applySearch();
    if (event.target.matches(".postField input, .postField textarea, .mobile-post-field input, .mobile-post-field textarea")) {
      var host = event.target.closest(".postField, .mobile-post-field");
      var counter = host && host.querySelector(".charCounter, span");
      if (counter) counter.textContent = event.target.value.length + "/" + event.target.maxLength;
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && isMobile && activeView !== "feed") closeDetail();
    if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-community-category]")) {
      event.preventDefault();
      event.target.click();
    }
    if (event.key === "Enter" && event.target.matches("[data-post-id]")) event.target.click();
  });

  async function initialize() {
    session = await api.auth.session();
    if (!session) return;
    client = api.client();
    if (isMobile) showMobileView("feed");
    await loadFeed();
  }

  initialize().catch(function (error) {
    showFeedStatus(error.message || "Could not load Community.", true);
  });
})();
