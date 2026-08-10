(function () {
  "use strict";

  if (!window.ForgeAPI) return;

  var api = window.ForgeAPI;
  var cache = window.ForgeCache;
  var PENDING_TURN_KEY = "forgegui.workspace.pending_turn";
  var CONVERSATION_LIST_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
  var CONVERSATION_MAX_AGE = 24 * 60 * 60 * 1000;
  var client;
  var session;
  var activeConversationId = null;
  var pollTimer = null;
  var conversationListRequest = null;
  var renderedConversationCount = 0;
  var pendingClarification = null;
  var selectedAttachments = new WeakMap();
  var MAX_ATTACHMENTS = 9;
  var MAX_ATTACHMENT_SIZE = 8 * 1024 * 1024;
  var ALLOWED_ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  var taskColumns = [
    "id",
    "message_id",
    "position",
    "kind",
    "prompt",
    "reference_indices",
    "count",
    "status",
    "result_image_urls",
    "error",
    "model_urls",
    "nuance_meta",
    "created_at",
    "updated_at",
  ].join(",");

  function validUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
  }

  function conversationUrl(id) {
    var url = api.routeUrl("oldChat.html");
    if (id) url.searchParams.set("conversation", id);
    return url;
  }

  function normalizeReferences(references) {
    return (Array.isArray(references) ? references : []).filter(function (reference) {
      return reference && typeof reference.url === "string" && reference.url;
    }).slice(0, MAX_ATTACHMENTS).map(function (reference, index) {
      return {
        index: index,
        label: "reference " + (index + 1),
        name: reference.name || "Reference " + (index + 1),
        url: reference.url,
      };
    });
  }

  function queuePendingTurn(message, references) {
    var pending = {
      id: api.uuid(),
      message: message,
      references: normalizeReferences(references),
      createdAt: Date.now(),
    };
    try {
      sessionStorage.setItem(PENDING_TURN_KEY, JSON.stringify(pending));
    } catch (_) {
      return null;
    }
    return pending;
  }

  function consumePendingTurn(id) {
    if (!id) return null;
    try {
      var raw = sessionStorage.getItem(PENDING_TURN_KEY);
      if (!raw) return null;
      var pending = JSON.parse(raw);
      sessionStorage.removeItem(PENDING_TURN_KEY);
      if (
        pending.id !== id ||
        typeof pending.message !== "string" ||
        Date.now() - pending.createdAt > 5 * 60 * 1000
      ) return null;
      pending.references = normalizeReferences(pending.references);
      return pending;
    } catch (_) {
      return null;
    }
  }

  async function fetchConversations() {
    var result = await client.rpc("list_active_conversations", { p_limit: 100 });
    if (!result.error) return result.data || [];

    if (!session) throw new Error("Your session has expired.");
    result = await client
      .from("conversations")
      .select("id,title,updated_at")
      .eq("user_id", session.user.id)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (result.error) throw result.error;
    return result.data || [];
  }

  function listConversations() {
    if (conversationListRequest) return conversationListRequest;
    conversationListRequest = fetchConversations().finally(function () {
      conversationListRequest = null;
    });
    return conversationListRequest;
  }

  function conversationCache(name, maxAge) {
    if (!cache || !session) return null;
    return cache.read(session.user.id, name, maxAge);
  }

  function writeConversationCache(name, data) {
    if (cache && session) cache.write(session.user.id, name, data);
  }

  function renderConversationLists(conversations) {
    renderedConversationCount = conversations.length;
    document.querySelectorAll("[data-conversation-list]").forEach(function (list) {
      list.querySelectorAll("[data-conversation-entry]").forEach(function (entry) {
        entry.remove();
      });
      var status = list.querySelector("[data-conversation-status]");
      if (!conversations.length) {
        list.hidden = true;
        return;
      }
      list.hidden = false;
      if (status) status.hidden = true;
      conversations.forEach(function (conversation) {
        var link = document.createElement("a");
        link.href = conversationUrl(conversation.id).href;
        link.className = "sidebarElem conversationEntry";
        link.dataset.conversationEntry = conversation.id;
        if (conversation.id === activeConversationId) link.classList.add("selected");
        var icon = document.createElement("img");
        icon.src = api.routeUrl("icons/s-3d.svg").href;
        icon.alt = "";
        var title = document.createElement("span");
        title.textContent = conversation.title || "Untitled chat";
        link.append(icon, title);
        list.appendChild(link);
      });
    });
  }

  async function refreshConversationLists() {
    try {
      var conversations = await listConversations();
      writeConversationCache("conversations:list", conversations);
      renderConversationLists(conversations);
      return conversations;
    } catch (error) {
      if (!renderedConversationCount) {
        document.querySelectorAll("[data-conversation-list]").forEach(function (list) {
          list.hidden = true;
        });
      }
      return conversationCache("conversations:list", CONVERSATION_LIST_MAX_AGE) || [];
    }
  }

  async function loadConversation(id) {
    var messageResult = await client
      .from("conversation_messages")
      .select("id,role,content,created_at,reference_image_urls")
      .eq("conversation_id", id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(31);
    if (messageResult.error) throw messageResult.error;
    var messages = (messageResult.data || []).sort(function (first, second) {
      var timestampOrder = new Date(first.created_at).getTime() - new Date(second.created_at).getTime();
      if (timestampOrder) return timestampOrder;
      if (first.role === "user" && second.role !== "user") return -1;
      if (first.role !== "user" && second.role === "user") return 1;
      return first.id.localeCompare(second.id);
    }).slice(-30);
    var firstUserTurn = messages.findIndex(function (message) {
      return message.role === "user";
    });
    messages = firstUserTurn === -1 ? [] : messages.slice(firstUserTurn);
    var messageIds = messages.map(function (message) { return message.id; });
    var tasks = [];
    if (messageIds.length) {
      var taskResult = await client
        .from("conversation_tasks")
        .select(taskColumns)
        .eq("conversation_id", id)
        .in("message_id", messageIds)
        .order("position", { ascending: true });
      if (taskResult.error) throw taskResult.error;
      tasks = taskResult.data || [];
    }
    return { messages: messages, tasks: tasks };
  }

  function taskLabel(kind) {
    return String(kind || "generation")
      .replaceAll("_", " ")
      .replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
  }

  function taskAssets(task) {
    var assets = Array.isArray(task.result_image_urls)
      ? task.result_image_urls.filter(Boolean)
      : [];
    if (task.model_urls && typeof task.model_urls === "object") {
      ["glb", "fbx", "obj", "model", "url"].forEach(function (key) {
        if (typeof task.model_urls[key] === "string") assets.push(task.model_urls[key]);
      });
    }
    return Array.from(new Set(assets));
  }

  function createGeneratingTask(task) {
    var box = document.createElement("div");
    box.className = "genbox workspaceGenbox workspaceGenbox-" + task.status;
    box.dataset.taskId = task.id;
    box.setAttribute("role", "status");
    box.setAttribute("aria-label", task.status === "queued" ? "Generation queued" : "Generation in progress");
    if (typeof window.GenBox === "function") {
      new window.GenBox(box);
      var label = box.querySelector(".genbox-txt");
      if (label) {
        label.textContent = task.status === "queued"
          ? "Preparing " + taskLabel(task.kind) + "..."
          : "Generating " + taskLabel(task.kind) + "...";
      }
    } else {
      box.textContent = task.status === "queued" ? "Preparing generation..." : "Generating...";
    }
    return box;
  }

  function createTaskCard(task) {
    if (task.status === "queued" || task.status === "running") {
      return createGeneratingTask(task);
    }
    var card = document.createElement("section");
    card.className = "workspaceTask workspaceTask-" + task.status;
    card.dataset.taskId = task.id;
    var header = document.createElement("header");
    var title = document.createElement("strong");
    title.textContent = taskLabel(task.kind);
    var status = document.createElement("span");
    status.textContent = task.status === "done" ? "Complete" : task.status.replaceAll("_", " ");
    header.append(title, status);
    card.appendChild(header);
    if (task.prompt) {
      var prompt = document.createElement("p");
      prompt.textContent = task.prompt;
      card.appendChild(prompt);
    }
    taskAssets(task).forEach(function (url) {
      if (/\.(?:png|jpe?g|webp|gif)(?:\?|$)/i.test(url)) {
        var image = document.createElement("img");
        image.src = url;
        image.alt = taskLabel(task.kind) + " result";
        image.loading = "lazy";
        card.appendChild(image);
      } else {
        var download = document.createElement("a");
        download.href = url;
        download.target = "_blank";
        download.rel = "noopener";
        download.textContent = "Open generated asset";
        card.appendChild(download);
      }
    });
    if (task.error) {
      var error = document.createElement("p");
      error.className = "workspaceTaskError";
      error.textContent = task.error === "insufficient_credits"
        ? "You do not have enough credits for this generation."
        : task.error;
      card.appendChild(error);
    }
    var pending = task.nuance_meta &&
      task.nuance_meta.context_router &&
      task.nuance_meta.context_router.pending;
    if (task.status === "needs_clarification" && pending && pending.status === "pending") {
      pendingClarification = pending;
      var clarification = document.createElement("section");
      clarification.className = "workspaceClarification";
      var question = document.createElement("strong");
      question.textContent = pending.question || "Forge needs a little more detail.";
      clarification.appendChild(question);
      (pending.options || []).forEach(function (option) {
        var button = document.createElement("button");
        button.type = "button";
        button.textContent = option.label;
        button.addEventListener("click", function () {
          clarification.querySelectorAll("button").forEach(function (item) {
            item.disabled = true;
          });
          submitMessage(option.label, {
            contract_version: "context-router.v1",
            pending_request_id: pending.pending_request_id,
            clarification_id: pending.clarification_id,
            answer_id: api.uuid(),
            answer: { type: "option", option_id: option.option_id },
          }).catch(showWorkspaceError);
        });
        clarification.appendChild(button);
      });
      card.appendChild(clarification);
    }
    return card;
  }

  function renderConversation(history) {
    var stream = document.querySelector("[data-chat-messages]");
    if (!stream) return;
    stream.querySelectorAll(".genbox").forEach(function (box) {
      if (box.genbox) box.genbox.destroy();
    });
    stream.innerHTML = "";
    pendingClarification = null;
    if (!history.messages.length) {
      var empty = document.createElement("p");
      empty.className = "workspaceEmpty";
      empty.textContent = "Start the conversation below.";
      stream.appendChild(empty);
      return;
    }
    var tasksByMessage = new Map();
    history.tasks.forEach(function (task) {
      if (!tasksByMessage.has(task.message_id)) tasksByMessage.set(task.message_id, []);
      tasksByMessage.get(task.message_id).push(task);
    });
    history.messages.forEach(function (message) {
      var article = document.createElement("article");
      article.className = "workspaceMessage " + (message.role === "user" ? "you" : "forge");
      var author = document.createElement("strong");
      author.textContent = message.role === "user" ? "You" : "Forge";
      var content = document.createElement("p");
      content.textContent = message.content || "";
      article.append(author, content);
      (tasksByMessage.get(message.id) || []).forEach(function (task) {
        article.appendChild(createTaskCard(task));
      });
      stream.appendChild(article);
    });
    stream.scrollTop = stream.scrollHeight;
  }

  function renderAssets(tasks) {
    var grid = document.querySelector("[data-chat-assets]");
    if (!grid) return;
    grid.innerHTML = "";
    var count = 0;
    tasks.forEach(function (task) {
      taskAssets(task).forEach(function (url) {
        if (!/\.(?:png|jpe?g|webp|gif)(?:\?|$)/i.test(url)) return;
        var link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener";
        var image = document.createElement("img");
        image.src = url;
        image.alt = taskLabel(task.kind) + " result";
        image.loading = "lazy";
        link.appendChild(image);
        grid.appendChild(link);
        count += 1;
      });
    });
    if (!count) {
      var empty = document.createElement("p");
      empty.className = "workspaceEmpty";
      empty.textContent = "Generated assets will collect here.";
      grid.appendChild(empty);
    }
  }

  async function dispatchTask(task, resume, references) {
    var attached = references || [];
    try {
      await api.function("chat-dispatch", {
        body: {
          task_id: task.id,
          reference_urls: attached.map(function (reference) { return reference.url; }),
          reference_names: attached.map(function (reference) { return reference.name; }),
          mode: resume && task.kind === "model_3d" ? "resume" : undefined,
        },
      });
    } catch (_) {
      // The task row remains authoritative after ambiguous transport failures.
    }
  }

  function renderConversationHistory(history) {
    renderConversation(history);
    renderAssets(history.tasks);
  }

  async function hydrateActiveConversation(useCached) {
    if (!activeConversationId) return;
    var cacheName = "conversation:" + activeConversationId;
    if (useCached) {
      var cached = conversationCache(cacheName, CONVERSATION_MAX_AGE);
      if (cached && Array.isArray(cached.messages) && Array.isArray(cached.tasks)) {
        renderConversationHistory(cached);
      }
    }
    var history = await loadConversation(activeConversationId);
    writeConversationCache(cacheName, history);
    renderConversationHistory(history);
    history.tasks.forEach(function (task) {
      if (task.status !== "queued") return;
      var message = history.messages.find(function (item) { return item.id === task.message_id; });
      var references = (message && message.reference_image_urls || []).map(function (url, index) {
        return { url: url, name: "Reference " + (index + 1) };
      });
      dispatchTask(task, false, references);
    });
    startPolling(history.tasks);
  }

  function startPolling(tasks) {
    var active = tasks.some(function (task) {
      return task.status === "queued" || task.status === "running";
    });
    if (!active) {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      return;
    }
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      hydrateActiveConversation().catch(showWorkspaceError);
    }, 2500);
  }

  function setChatBusy(busy) {
    document.querySelectorAll("[data-chat-input], [data-chat-submit], [data-chat-attachment], [data-chat-attachment-remove]").forEach(function (control) {
      control.disabled = busy;
    });
    document.querySelectorAll("[data-chat-form]").forEach(function (form) {
      form.setAttribute("aria-busy", String(busy));
    });
  }

  function showWorkspaceError(error) {
    document.querySelectorAll("[data-chat-status]").forEach(function (status) {
      status.hidden = false;
      status.textContent = error.message || "ForgeGUI could not complete that request.";
    });
  }

  function clearWorkspaceError() {
    document.querySelectorAll("[data-chat-status]").forEach(function (status) {
      status.hidden = true;
      status.textContent = "";
    });
  }

  async function uploadAttachments(files, startIndex) {
    if (!files || !files.length) return [];
    files.forEach(function (file) {
      if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type) || file.size > MAX_ATTACHMENT_SIZE) {
        throw new Error("Reference images must be JPEG, PNG, WebP, or GIF files under 8 MB.");
      }
    });
    var current = await api.auth.session();
    if (!current) throw new Error("Your session has expired.");
    var storage = client.storage.from("asset-images");
    var uploaded = [];
    for (var index = 0; index < files.length; index += 1) {
      var file = files[index];
      var extension = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "png";
      var path = current.user.id + "/chat/" + api.uuid() + "." + extension;
      var result = await storage.upload(path, file, {
        contentType: file.type || "image/png",
        upsert: false,
      });
      if (result.error) throw result.error;
      uploaded.push({
        index: (startIndex || 0) + index,
        label: "reference " + ((startIndex || 0) + index + 1),
        name: file.name,
        url: storage.getPublicUrl(path).data.publicUrl,
      });
    }
    return uploaded;
  }

  async function submitMessage(message, clarificationAnswer, availableReferences) {
    var prompt = String(message || "").trim();
    if (!prompt) throw new Error("Describe what you want ForgeGUI to create.");
    if (prompt.length > 4000) throw new Error("Messages must be 4,000 characters or fewer.");
    var references = normalizeReferences(availableReferences);
    if (!document.querySelector("[data-chat-messages]")) {
      var pending = queuePendingTurn(prompt, references);
      if (!pending) throw new Error("Unable to open a temporary conversation.");
      var temporaryUrl = conversationUrl(null);
      temporaryUrl.searchParams.set("temporary", pending.id);
      location.assign(temporaryUrl.href);
      return;
    }
    if (!clarificationAnswer && pendingClarification) {
      clarificationAnswer = {
        contract_version: "context-router.v1",
        pending_request_id: pendingClarification.pending_request_id,
        clarification_id: pendingClarification.clarification_id,
        answer_id: api.uuid(),
        answer: { type: "other", text: prompt },
      };
    }
    clearWorkspaceError();
    setChatBusy(true);
    try {
      var requestBody = {
        conversation_id: activeConversationId,
        message: prompt,
        available_references: references,
        plan_mode: false,
        routing_mode: "contextual",
        prompt_selector: {
          source: "interactive_frontend",
          category: "auto",
          action: "generate",
        },
        lime_session_active: false,
      };
      if (clarificationAnswer) requestBody.clarification_answer = clarificationAnswer;
      var turn = await api.function("chat-router", {
        body: requestBody,
      });
      activeConversationId = turn.conversation_id;
      history.replaceState({}, "", conversationUrl(activeConversationId).href);
      await hydrateActiveConversation();
      var tasks = (turn.tasks || []).filter(function (task) {
        return task.id && !task.needs_clarification;
      });
      await Promise.allSettled(tasks.map(function (task) {
        return dispatchTask(task, false, references);
      }));
      await refreshConversationLists();
      await hydrateActiveConversation();
    } finally {
      setChatBusy(false);
    }
  }

  function wireChatForms() {
    document.querySelectorAll("[data-chat-form]").forEach(function (form) {
      var input = form.querySelector("[data-chat-input]");
      var submit = form.querySelector("[data-chat-submit]");
      var attachmentButton = form.querySelector("[data-chat-attachment]");
      var attachmentInput = form.querySelector("[data-chat-attachment-input]");
      var attachmentPreview = form.querySelector("[data-chat-attachment-preview]");
      if (!input || !submit) return;
      function renderSelectedAttachments() {
        var references = normalizeReferences(selectedAttachments.get(form));
        if (references.length) selectedAttachments.set(form, references);
        else selectedAttachments.delete(form);
        if (attachmentPreview) {
          attachmentPreview.querySelectorAll("[data-chat-attachment-item]").forEach(function (item) {
            item.remove();
          });
          references.forEach(function (reference, index) {
            var item = document.createElement("fg-chatattachment");
            item.dataset.chatAttachmentItem = "";
            var image = document.createElement("img");
            image.className = "chatboxAttachmentThumbnail";
            image.src = reference.url;
            image.alt = reference.name;
            var remove = document.createElement("button");
            remove.className = "chatboxAttachmentRemove";
            remove.type = "button";
            remove.dataset.chatAttachmentRemove = String(index);
            remove.setAttribute("aria-label", "Remove " + reference.name);
            var removeIcon = document.createElement("img");
            removeIcon.src = new URL("icons/x.svg", api.root()).href;
            removeIcon.alt = "";
            remove.appendChild(removeIcon);
            remove.addEventListener("click", function () {
              var next = references.filter(function (_, referenceIndex) {
                return referenceIndex !== index;
              });
              selectedAttachments.set(form, next);
              renderSelectedAttachments();
              attachmentButton.focus();
            });
            item.append(image, remove);
            attachmentPreview.appendChild(item);
          });
        }
        if (attachmentButton) {
          attachmentButton.classList.toggle("hasAttachments", references.length > 0);
          if (references.length) {
            attachmentButton.dataset.attachmentCount = String(references.length);
            attachmentButton.title = references.map(function (reference) { return reference.name; }).join(", ");
          } else {
            attachmentButton.removeAttribute("data-attachment-count");
            attachmentButton.title = "";
          }
        }
      }
      function clearSelectedAttachments() {
        selectedAttachments.delete(form);
        if (attachmentInput) attachmentInput.value = "";
        renderSelectedAttachments();
      }
      async function send() {
        if (attachmentButton && attachmentButton.disabled) {
          throw new Error("Wait for reference images to finish uploading.");
        }
        var value = input.value;
        var references = selectedAttachments.get(form) || [];
        input.value = "";
        try {
          await submitMessage(value, null, references);
          clearSelectedAttachments();
        } catch (error) {
          input.value = value;
          throw error;
        }
      }
      submit.addEventListener("click", function () { send().catch(showWorkspaceError); });
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          send().catch(showWorkspaceError);
        }
      });
      if (attachmentButton && attachmentInput) {
        attachmentButton.addEventListener("click", function () { attachmentInput.click(); });
        attachmentInput.addEventListener("change", function () {
          var currentReferences = selectedAttachments.get(form) || [];
          var availableSlots = MAX_ATTACHMENTS - currentReferences.length;
          var files = Array.from(attachmentInput.files || []);
          attachmentInput.value = "";
          if (!files.length) return;
          if (availableSlots <= 0 || files.length > availableSlots) {
            showWorkspaceError(new Error("You can attach up to " + MAX_ATTACHMENTS + " reference images."));
            return;
          }
          clearWorkspaceError();
          attachmentButton.disabled = true;
          submit.disabled = true;
          uploadAttachments(files, currentReferences.length).then(function (uploaded) {
            selectedAttachments.set(form, currentReferences.concat(uploaded));
            renderSelectedAttachments();
          }).catch(showWorkspaceError).finally(function () {
            attachmentButton.disabled = false;
            submit.disabled = false;
          });
        });
      }
    });
    document.querySelectorAll("[data-prompt-suggestion]").forEach(function (button) {
      if (!button.matches("button, a")) {
        button.tabIndex = 0;
        button.setAttribute("role", "button");
      }
      function choosePrompt() {
        var input = document.querySelector("[data-chat-input]");
        if (!input) return;
        input.value = button.dataset.promptSuggestion;
        input.scrollIntoView({ behavior: "smooth", block: "center" });
        input.focus();
      }
      button.addEventListener("click", function () {
        choosePrompt();
      });
      button.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          choosePrompt();
        }
      });
    });
  }

  async function initialize() {
    session = await api.auth.session();
    if (!session) return;
    client = api.client();
    var route = document.querySelector('meta[name="forge-route"]')?.content || "";
    var routeParams = new URLSearchParams(location.search);
    if (route === "oldChat.html") {
      var candidate = routeParams.get("conversation");
      activeConversationId = validUuid(candidate) ? candidate : null;
    }
    wireChatForms();
    var cachedConversations = conversationCache("conversations:list", CONVERSATION_LIST_MAX_AGE);
    if (Array.isArray(cachedConversations)) {
      renderConversationLists(cachedConversations);
      var cachedActive = cachedConversations.find(function (conversation) {
        return conversation.id === activeConversationId;
      });
      if (cachedActive) {
        document.querySelectorAll("[data-chat-title]").forEach(function (title) {
          title.textContent = cachedActive.title || "Untitled chat";
        });
      }
    }
    var conversationRefresh = refreshConversationLists();
    if (route === "home.html") {
      var prompt = new URLSearchParams(location.search).get("prompt");
      if (prompt) {
        var input = document.querySelector("[data-chat-input]");
        if (input) input.value = prompt.slice(0, 4000);
      }
      return;
    }
    if (route !== "oldChat.html") return;
    var pendingTurn = consumePendingTurn(routeParams.get("temporary"));
    if (pendingTurn) {
      document.body.classList.add("conversationEntering");
      document.querySelector("[data-chat-title]").textContent = "New conversation";
      renderConversation({
        messages: [{
          id: "temporary-user-message",
          role: "user",
          content: pendingTurn.message,
          created_at: new Date(pendingTurn.createdAt).toISOString(),
          reference_image_urls: pendingTurn.references.map(function (reference) { return reference.url; }),
        }],
        tasks: [],
      });
      renderAssets([]);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          submitMessage(pendingTurn.message, null, pendingTurn.references).catch(function (error) {
            var input = document.querySelector("[data-chat-input]");
            if (input) input.value = pendingTurn.message;
            showWorkspaceError(error);
          });
        });
      });
      return;
    }
    if (!activeConversationId) {
      var conversations = await conversationRefresh;
      if (conversations.length) {
        location.replace(conversationUrl(conversations[0].id).href);
        return;
      }
      document.querySelector("[data-chat-title]").textContent = "New chat";
      renderConversation({ messages: [], tasks: [] });
      renderAssets([]);
      return;
    }
    var historyRefresh = hydrateActiveConversation(true);
    var titleResult = await client
      .from("conversations")
      .select("title")
      .eq("id", activeConversationId)
      .maybeSingle();
    if (titleResult.error || !titleResult.data) {
      throw new Error("This conversation was not found.");
    }
    document.querySelectorAll("[data-chat-title]").forEach(function (title) {
      title.textContent = titleResult.data.title || "Untitled chat";
    });
    await historyRefresh;
  }

  initialize().catch(showWorkspaceError);
})();
