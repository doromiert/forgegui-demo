# ForgeGUI HTML framework

`tools/site.mjs` supports server-rendered templates, client-rendered templates,
Markdown documentation, and separate desktop/mobile page implementations.

## Commands

Inside the Nix development shell:

```sh
serve
build
```

Without Nix:

```sh
node tools/site.mjs serve
node tools/site.mjs build
```

The development server defaults to `http://localhost:8080`. Use `--port` to change it:

```sh
node tools/site.mjs serve --port 3000
```

The development server recursively watches HTML, templates, CSS under `styles/`, JavaScript under `scripts/`, and media under `assets/`. Changes send a server-sent event to open pages, which perform a real `location.reload()`. The reload client is injected only into development responses and is never written to `dist/`.

Changes to `tools/site.mjs` itself require restarting the development server.

## Desktop and mobile pages

Each public URL is a logical route. For example, `home.html` stays in the
address bar while the browser loads either `desktop/home.html` or
`mobile/home.html`. The active implementation switches at `700px` without
changing the public URL.

Desktop pages contain the current implementations. Mobile pages can be full
HTML documents or aliases while both versions share the same implementation:

```html
<!-- mobile/home.html -->
<fg-page data-source="desktop/home.html"></fg-page>
```

Replace an alias with a complete HTML document when that route needs a truly
different mobile interface. Every desktop route must have a matching mobile
file. Links always target logical routes such as `home.html`, never
`desktop/home.html` or `mobile/home.html`.

## Root-relative source paths

Paths in source HTML, CSS, Markdown, and templates are relative to the project
root. The server, production compiler, and client template runtime correct
them for the rendered location:

```html
<link rel="stylesheet" href="styles/base.css">
<script src="scripts/site.js" defer></script>
<img src="icons/search.svg" alt="">
<fg-client-include data-template="templates/profile-card.html"></fg-client-include>
```

Do not use `../` traversal in source files.

## Client-rendered templates

Use `fg-client-include` when a fragment must render in the browser. Templates
use the same named-slot format as server includes and are copied to
`dist/templates/` for runtime fetching:

```html
<fg-client-include data-template="templates/public-hero.html" class="compact">
  <span data-slot="title">Help</span>
  <span data-slot="description">Learn how to use ForgeGUI.</span>
</fg-client-include>
```

Nested client includes are supported. Rendering emits a
`forge:template-rendered` event and is also available programmatically:

```js
await ForgeUI.render(container);
```

Paths inside fetched templates retain project-root semantics. For paths built
inside JavaScript, use `ForgeUI.asset("icons/ai.svg")`.

## Hydration hooks

Mark a rendered element with `data-hydrate` and register its initializer.
Initializers run once per element, including elements added by later client
template renders:

```html
<article data-hydrate="support-card">...</article>
```

```js
ForgeUI.register("support-card", function (element, ui) {
  element.querySelector("button").addEventListener("click", function () {
    // Hydrated behavior.
  });
});
```

## Markdown documentation

Markdown files under `docs/` are rendered into both responsive page trees. Each file
uses frontmatter to control its navigation position:

```md
---
title: Part 1
description: Page summary used by the AI Summary disclosure.
section: Section Name
sectionId: getting-started
sectionOrder: 1
order: 1
---
# Page heading
```

The renderer supports headings, inline formatting, links, images, lists,
tables, block quotes, fenced code blocks, callouts such as `[!TIP]`, and
`:::details` disclosure blocks. Development routes and production builds use
the logical `.html` path, such as `docs/index.html`.

## Server-rendered templates

```html
<fg-include data-template="templates/sidebar.html"></fg-include>
```

## Use a layout

The layout defines named insertion points:

```html
<!-- templates/app-shell.html -->
<fg-include data-template="templates/sidebar.html"></fg-include>
<fg-slot data-name="content"></fg-slot>
```

The page supplies content for those points:

```html
<body class="chat">
  <fg-include data-template="templates/app-shell.html">
    <mainView data-slot="content">Page content goes here.</mainView>
  </fg-include>
</body>
```

Unnamed child content projects into an unnamed `<fg-slot></fg-slot>`. A projection slot's own children are fallback content when the page supplies nothing.

Templates can include other templates. Includes are restricted to `templates/`, and include cycles fail the request or build with a readable error.

## Shared chatbox

Use the standard prompt composer with:

```html
<fg-include data-template="templates/chatbox.html"></fg-include>
```

The asset bar, input, and final action can be replaced per page:

```html
<fg-include data-template="templates/chatbox.html">
  <textarea data-slot="input" placeholder="Ask something else..."></textarea>
  <button data-slot="actions" class="chatboxButton send">Send</button>
</fg-include>
```

Keep interactive behavior in regular `.js` files. Templates only control HTML composition.

## Shared popups

Use one `<popup>` element per dialog and identify it with an `id`. Triggers and
close controls are declarative so `site.js` can provide consistent focus,
keyboard, backdrop, and scroll-lock behavior:

```html
<button data-popup-open="new-project">New Project</button>
<popupContainer class="hidden">
  <popup id="new-project" class="hidden">
  <fg-include data-template="templates/popup-frame.html">
    <span data-slot="title">New Project</span>
    <span data-slot="description">Create a new project.</span>
    <form data-slot="content">...</form>
  </fg-include>
  </popup>
</popupContainer>
```

Do not create page-specific popup tags or popup controllers. Use
`data-popup-open`, `data-popup-close`, and the shared `openPopup`/`closePopup`
API when script-driven control is required.

## Class-based component variants

Keep the modifier class on a wrapper that remains after rendering, then include the shared component structure inside it:

```html
<planCard class="plan-card plan-card--pro">
  <fg-include data-template="templates/plan-card.html">
    <span data-slot="title">Pro</span>
    <span data-slot="badge">Most Popular</span>
    <span data-slot="price">$19.99</span>
    <ul data-slot="included-features">
      <li>Faster Generations</li>
    </ul>
  </fg-include>
</planCard>
```

The template owns shared markup, named slots own content, and classes such as `.plan-card--starter`, `.plan-card--pro`, and `.plan-card--max` own visual differences.
