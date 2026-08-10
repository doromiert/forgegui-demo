(function () {
  "use strict";

  if (!window.ForgeAPI) return;
  var routeMeta = document.querySelector('meta[name="forge-route"]');
  var route = routeMeta ? routeMeta.content : "";
  if (!route.startsWith("library/")) return;

  var api = window.ForgeAPI;
  var cache = window.ForgeCache;
  var CATALOG_MAX_AGE = 24 * 60 * 60 * 1000;
  var PERSONAL_ASSETS_MAX_AGE = 24 * 60 * 60 * 1000;
  var client;
  var session;
  var personalAssets = new Map();
  var catalogItems = new Map();
  var selectedAsset = null;
  var selectedCatalogItem = null;
  var isMobile = document.body.classList.contains("mobile-assets");
  var fallbackPreview = api.routeUrl("assets/coursePlaceholder.jpg").href;

  function labelForKind(kind) {
    return String(kind || "Generated asset")
      .replaceAll("_", " ")
      .replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
  }

  function generatedDate(value) {
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Generated recently";
    return "Generated " + date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    });
  }

  function assetTitle(task, index) {
    var prompt = String(task.prompt || "").trim().replace(/\s+/g, " ");
    if (prompt) return prompt.length > 62 ? prompt.slice(0, 59) + "..." : prompt;
    var label = labelForKind(task.kind);
    return index ? label + " " + (index + 1) : label;
  }

  function imageUrl(value) {
    return typeof value === "string" && /\.(?:png|jpe?g|webp|gif)(?:\?|$)/i.test(value);
  }

  function pushAsset(output, task, url, preview, index, type) {
    if (typeof url !== "string" || !url) return;
    output.push({
      id: task.id + ":" + index,
      taskId: task.id,
      conversationId: task.conversation_id,
      title: assetTitle(task, index),
      kind: task.kind,
      type: type,
      url: url,
      preview: preview || (imageUrl(url) ? url : fallbackPreview),
      createdAt: task.created_at,
    });
  }

  function flattenTasks(tasks) {
    var output = [];
    tasks.forEach(function (task) {
      var model = task.model_urls && typeof task.model_urls === "object" ? task.model_urls : {};
      if (task.kind === "model_3d" && model.glb) {
        var modelPreview = model.thumbnail || model.base_color || (task.result_image_urls || [])[0];
        var modelUrls = [model.glb];
        var rigged = model.rigged && typeof model.rigged === "object" ? model.rigged : {};
        [rigged.glb, rigged.rigged_glb, rigged.walking_glb, rigged.running_glb].forEach(function (url) {
          if (url && !modelUrls.includes(url)) modelUrls.push(url);
        });
        (Array.isArray(model.animations) ? model.animations : []).forEach(function (animation) {
          var url = animation && animation.animation_glb;
          if (url && !modelUrls.includes(url)) modelUrls.push(url);
        });
        modelUrls.forEach(function (url, index) {
          pushAsset(output, task, url, modelPreview, index, "model");
        });
        return;
      }
      var audio = Array.isArray(model.audio_urls) ? model.audio_urls.filter(Boolean) : [];
      if (audio.length) {
        audio.forEach(function (url, index) { pushAsset(output, task, url, fallbackPreview, index, "audio"); });
        return;
      }
      (Array.isArray(task.result_image_urls) ? task.result_image_urls : []).forEach(function (url, index) {
        pushAsset(output, task, url, imageUrl(url) ? url : fallbackPreview, index, imageUrl(url) ? "image" : "file");
      });
    });
    return output;
  }

  function createPersonalCard(asset) {
    var card = document.createElement("fg-asset");
    card.dataset.assetId = asset.id;
    card.dataset.popupOpen = "asset-preview";
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-haspopup", "dialog");
    var preview = document.createElement("img");
    preview.src = asset.preview;
    preview.alt = asset.title;
    var bottom = document.createElement("fg-bottom");
    var copy = document.createElement("fg-vertical");
    var title = document.createElement("b");
    title.textContent = asset.title;
    var date = document.createElement("span");
    date.textContent = generatedDate(asset.createdAt);
    copy.append(title, date);
    var options = document.createElement("img");
    options.src = api.routeUrl("icons/3dots.svg").href;
    options.alt = "";
    bottom.append(copy, options);
    card.append(preview, bottom);
    return card;
  }

  function renderPersonalAssets(assets) {
    var grid = document.querySelector("[data-personal-assets]");
    if (!grid) return;
    grid.innerHTML = "";
    personalAssets = new Map(assets.map(function (asset) { return [asset.id, asset]; }));
    if (!assets.length) {
      var empty = document.createElement("p");
      empty.className = "assetBackendStatus";
      empty.textContent = "Your completed generations will appear here.";
      grid.appendChild(empty);
      return;
    }
    assets.forEach(function (asset) { grid.appendChild(createPersonalCard(asset)); });
  }

  function createDesktopCatalogCard(item, index) {
    var card = document.createElement("fg-communityasset");
    var id = String(item.id || item.slug || "catalog-" + index);
    if (index % 5 === 0) card.className = "long";
    card.dataset.catalogItem = [item.title, item.description, item.creator_name, item.category, item.tags || []].join(" ").toLowerCase();
    card.dataset.catalogId = id;
    card.dataset.popupOpen = "community-asset-preview";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-haspopup", "dialog");
    var image = document.createElement("img");
    image.src = item.image_url || fallbackPreview;
    image.alt = item.title || "Community asset";
    var top = document.createElement("fg-top");
    var creator = document.createElement("span");
    creator.textContent = item.creator_name || "ForgeGUI Creator";
    top.appendChild(creator);
    var bottom = document.createElement("fg-bottom");
    var title = document.createElement("b");
    title.textContent = item.title || "Untitled asset";
    var description = document.createElement("span");
    description.textContent = item.description || "";
    var tags = document.createElement("fg-tags");
    (Array.isArray(item.tags) ? item.tags : []).slice(0, 3).forEach(function (value) {
      var tag = document.createElement("fg-tag");
      tag.textContent = value;
      tags.appendChild(tag);
    });
    bottom.append(title, description, tags);
    card.append(image, top, bottom);
    return card;
  }

  function createMobileCatalogCard(item, index) {
    var card = document.createElement("article");
    var id = String(item.id || item.slug || "catalog-" + index);
    card.className = "mobile-community-card" + (index % 5 === 0 ? " is-wide" : "");
    card.dataset.catalogItem = [item.title, item.description, item.creator_name, item.category, item.tags || []].join(" ").toLowerCase();
    card.dataset.searchItem = card.dataset.catalogItem;
    card.dataset.catalogId = id;
    card.dataset.popupOpen = "community-asset-preview";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-haspopup", "dialog");
    var image = document.createElement("img");
    image.src = item.image_url || fallbackPreview;
    image.alt = item.title || "Community asset";
    var copy = document.createElement("div");
    var creator = document.createElement("p");
    var creatorName = document.createElement("strong");
    creatorName.textContent = item.creator_name || "ForgeGUI Creator";
    creator.appendChild(creatorName);
    var title = document.createElement("h2");
    title.textContent = item.title || "Untitled asset";
    var description = document.createElement("span");
    description.textContent = item.description || "";
    var tags = document.createElement("footer");
    (Array.isArray(item.tags) ? item.tags : []).slice(0, 3).forEach(function (value) {
      var tag = document.createElement("b");
      tag.textContent = value;
      tags.appendChild(tag);
    });
    copy.append(creator, title, description, tags);
    card.append(image, copy);
    return card;
  }

  function renderCatalog(items) {
    var grid = document.querySelector("[data-catalog-grid]");
    if (!grid || !items.length) return;
    grid.innerHTML = "";
    catalogItems = new Map();
    items.forEach(function (item, index) {
      catalogItems.set(String(item.id || item.slug || "catalog-" + index), item);
      grid.appendChild(isMobile ? createMobileCatalogCard(item, index) : createDesktopCatalogCard(item, index));
    });
  }

  function staticCatalogItem(card, index) {
    var title = card.querySelector("fg-bottom b, h2");
    var description = card.querySelector("fg-bottom > span, div > span");
    var creator = card.querySelector("fg-top span, p strong");
    var image = card.querySelector(":scope > img");
    var tags = Array.from(card.querySelectorAll("fg-tag, footer b")).map(function (tag) {
      return tag.textContent.trim();
    }).filter(Boolean);
    return {
      id: "fixture-" + index,
      title: title ? title.textContent.trim() : "Community asset",
      description: description ? description.textContent.trim() : "",
      creator_name: creator ? creator.textContent.trim() : "ForgeGUI Creator",
      image_url: image ? image.src : fallbackPreview,
      download_url: image ? image.src : fallbackPreview,
      asset_type: "image",
      tags: tags,
    };
  }

  function registerStaticCatalog() {
    var grid = document.querySelector("[data-catalog-grid]");
    if (!grid) return;
    Array.from(grid.children).forEach(function (card, index) {
      if (card.dataset.catalogId) return;
      var item = staticCatalogItem(card, index);
      card.dataset.catalogId = item.id;
      card.dataset.catalogItem = [item.title, item.description, item.creator_name, item.tags].join(" ").toLowerCase();
      card.dataset.searchItem = card.dataset.catalogItem;
      card.dataset.popupOpen = "community-asset-preview";
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-haspopup", "dialog");
      catalogItems.set(item.id, item);
    });
  }

  function filterCatalog() {
    var search = document.querySelector("[data-catalog-search]");
    var query = search ? search.value.trim().toLowerCase() : "";
    document.querySelectorAll("[data-catalog-item]").forEach(function (card) {
      card.hidden = !!query && !card.dataset.catalogItem.includes(query);
    });
  }

  function selectAsset(asset) {
    selectedAsset = asset;
    var title = document.querySelector("[data-asset-preview-title]");
    var preview = document.querySelector("[data-asset-preview-image]");
    var chat = document.querySelector("[data-asset-view-chat]");
    if (title) title.textContent = asset.title;
    if (preview) {
      preview.src = asset.preview;
      preview.alt = asset.title;
    }
    if (chat) chat.disabled = !asset.conversationId;
  }

  function catalogType(item) {
    var value = String(item.asset_type || item.file_type || "image").toLowerCase();
    if (value.includes("3d") || value.includes("model") || value.includes("glb")) {
      return { key: "model", label: "3D Object", icon: "icons/3d.svg" };
    }
    if (value.includes("audio") || value.includes("sound")) {
      return { key: "audio", label: "Audio", icon: "icons/file.svg" };
    }
    if (value.includes("image") || value.includes("png") || value.includes("jpg") || value.includes("webp")) {
      return { key: "image", label: "Image", icon: "icons/picture.svg" };
    }
    return { key: "file", label: labelForKind(value), icon: "icons/file.svg" };
  }

  function creatorHandle(name) {
    var slug = String(name || "forgegui").replace(/[^a-z0-9]+/gi, "");
    return "@" + (slug || "forgegui");
  }

  function selectCatalogItem(item) {
    selectedCatalogItem = item;
    var type = catalogType(item);
    var title = document.querySelector("[data-community-title]");
    var description = document.querySelector("[data-community-description]");
    var descriptionToggle = document.querySelector("[data-community-description-toggle]");
    var creator = document.querySelector("[data-community-creator]");
    var handle = document.querySelector("[data-community-handle]");
    var avatar = document.querySelector("[data-community-avatar]");
    var typeLabel = document.querySelector("[data-community-type]");
    var typeIcon = document.querySelector("[data-community-type-icon]");
    var preview = document.querySelector("[data-community-preview-image]");
    var previewFallback = document.querySelector("[data-community-preview-fallback]");
    var previewIcon = document.querySelector("[data-community-preview-icon]");
    var previewMessage = document.querySelector("[data-community-preview-message]");
    var likes = document.querySelector("[data-community-likes]");
    var likeCount = document.querySelector("[data-community-like-count]");
    var download = document.querySelector("[data-community-download]");
    var share = document.querySelector("[data-community-share]");
    var name = item.creator_name || "ForgeGUI Creator";
    var url = item.download_url || item.image_url || "";
    var showImage = type.key === "image" && item.image_url;

    if (title) title.textContent = item.title || "Community asset";
    if (description) {
      description.textContent = item.description || "No description provided.";
      description.classList.remove("isExpanded");
    }
    if (descriptionToggle) {
      descriptionToggle.textContent = "View Full Description";
      descriptionToggle.setAttribute("aria-expanded", "false");
    }
    if (creator) creator.textContent = name;
    if (handle) handle.textContent = item.creator_handle || creatorHandle(name);
    if (avatar) {
      avatar.src = item.creator_avatar_url || api.routeUrl("assets/community-avatar.png").href;
      avatar.alt = name;
    }
    if (typeLabel) typeLabel.textContent = type.label;
    if (typeIcon) typeIcon.src = api.routeUrl(type.icon).href;
    if (preview) {
      preview.hidden = !showImage;
      if (showImage) {
        preview.src = item.image_url;
        preview.alt = item.title || "Community asset";
      }
    }
    if (previewFallback) previewFallback.hidden = !!showImage;
    if (previewIcon) previewIcon.src = api.routeUrl(type.icon).href;
    if (previewMessage) previewMessage.textContent = type.label + " preview is not available in this mockup.";
    if (likes) likes.hidden = !Number.isFinite(Number(item.like_count));
    if (likeCount && Number.isFinite(Number(item.like_count))) likeCount.textContent = String(item.like_count);
    if (download) download.disabled = !url;
    if (share) share.disabled = !url;
  }

  function openAssetUrl(url, download) {
    if (!url) return;
    var link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    if (download) link.download = "";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  document.addEventListener("click", function (event) {
    var personal = event.target.closest("[data-asset-id]");
    if (personal) {
      var asset = personalAssets.get(personal.dataset.assetId);
      if (asset) selectAsset(asset);
      return;
    }
    var catalog = event.target.closest("[data-catalog-item]");
    if (catalog) {
      var item = catalogItems.get(catalog.dataset.catalogId);
      if (item) selectCatalogItem(item);
      return;
    }
    if (event.target.closest("[data-community-download]") && selectedCatalogItem) {
      openAssetUrl(selectedCatalogItem.download_url || selectedCatalogItem.image_url, true);
      return;
    }
    if (event.target.closest("[data-community-share]") && selectedCatalogItem) {
      var communityUrl = selectedCatalogItem.download_url || selectedCatalogItem.image_url;
      if (navigator.share) navigator.share({ title: selectedCatalogItem.title, url: communityUrl }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(communityUrl);
      return;
    }
    var descriptionToggle = event.target.closest("[data-community-description-toggle]");
    if (descriptionToggle) {
      var description = document.querySelector("[data-community-description]");
      var expanded = description && description.classList.toggle("isExpanded");
      descriptionToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
      descriptionToggle.textContent = expanded ? "Show Less" : "View Full Description";
      return;
    }
    if (event.target.closest("[data-asset-download]") && selectedAsset) {
      openAssetUrl(selectedAsset.url, true);
      return;
    }
    if (event.target.closest("[data-asset-view-chat]") && selectedAsset && selectedAsset.conversationId) {
      location.assign(api.routeUrl("oldChat.html?conversation=" + selectedAsset.conversationId).href);
      return;
    }
    if (event.target.closest("[data-asset-share]") && selectedAsset) {
      if (navigator.share) navigator.share({ title: selectedAsset.title, url: selectedAsset.url }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(selectedAsset.url);
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    var personal = event.target.closest("[data-asset-id]");
    if (personal) {
      var asset = personalAssets.get(personal.dataset.assetId);
      if (asset) selectAsset(asset);
      return;
    }
    var card = event.target.closest("[data-catalog-item]");
    if (card) {
      event.preventDefault();
      card.click();
    }
  });

  document.addEventListener("input", function (event) {
    if (event.target.matches("[data-catalog-search]")) filterCatalog();
  });

  async function loadCatalog() {
    var cached = cache ? cache.read("public", "assets:catalog", CATALOG_MAX_AGE) : null;
    if (Array.isArray(cached) && cached.length) renderCatalog(cached);
    var result = await client.rpc("get_public_asset_catalog_entries", { p_slug: null });
    if (!result.error && Array.isArray(result.data) && result.data.length) {
      if (cache) cache.write("public", "assets:catalog", result.data);
      renderCatalog(result.data);
    }
  }

  async function loadPersonalAssets() {
    var grid = document.querySelector("[data-personal-assets]");
    var cached = cache
      ? cache.read(session.user.id, "assets:personal", PERSONAL_ASSETS_MAX_AGE)
      : null;
    if (Array.isArray(cached)) renderPersonalAssets(cached);
    else if (grid) {
      grid.innerHTML = '<p class="assetBackendStatus">Loading your generated assets...</p>';
    }
    var result = await client
      .from("conversation_tasks")
      .select("id,kind,prompt,result_image_urls,model_urls,status,created_at,count,conversation_id")
      .eq("user_id", session.user.id)
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(30);
    if (result.error) throw result.error;
    var assets = flattenTasks(result.data || []);
    if (cache) cache.write(session.user.id, "assets:personal", assets);
    renderPersonalAssets(assets);
  }

  async function initialize() {
    session = await api.auth.session();
    if (!session) return;
    client = api.client();
    if (route === "library/overview.html") {
      await loadCatalog();
      return;
    }
    if (route === "library/project.html") await loadPersonalAssets();
  }

  if (route === "library/overview.html") registerStaticCatalog();

  initialize().catch(function (error) {
    var status = document.querySelector(".assetBackendStatus");
    if (status) status.textContent = error.message || "Could not load assets.";
  });
})();
