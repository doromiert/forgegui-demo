# Server-rendered HTML templates

`tools/site.mjs` expands templates on the server in development and writes fully rendered HTML during production builds. The browser never downloads the templates or renderer.

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

The development server recursively watches HTML, templates, stylesheets, scripts, and browser assets. Changes send a server-sent event to open pages, which perform a real `location.reload()`. The reload client is injected only into development responses and is never written to `dist/`.

Changes to `tools/site.mjs` itself require restarting the development server.

## Include a partial

```html
<slot template="templates/sidebar.html"></slot>
```

## Use a layout

The layout defines named insertion points:

```html
<!-- templates/app-shell.html -->
<slot template="templates/sidebar.html"></slot>
<slot name="content"></slot>
```

The page supplies content for those points:

```html
<body class="chat">
  <slot template="templates/app-shell.html">
    <mainView slot="content">Page content goes here.</mainView>
  </slot>
</body>
```

Unnamed child content projects into an unnamed `<slot></slot>`. A projection slot's own children are fallback content when the page supplies nothing.

Templates can include other templates. Includes are restricted to `templates/`, and include cycles fail the request or build with a readable error.

## Shared chatbox

Use the standard prompt composer with:

```html
<slot template="templates/chatbox.html"></slot>
```

The asset bar, input, and final action can be replaced per page:

```html
<slot template="templates/chatbox.html">
  <textarea slot="input" placeholder="Ask something else..."></textarea>
  <button slot="actions" class="chatboxButton send">Send</button>
</slot>
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
    <slot template="templates/popup-frame.html">
      <span slot="title">New Project</span>
      <span slot="description">Create a new project.</span>
      <form slot="content">...</form>
    </slot>
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
  <slot template="templates/plan-card.html">
    <span slot="title">Pro</span>
    <span slot="badge">Most Popular</span>
    <span slot="price">$19.99</span>
    <ul slot="included-features">
      <li>Faster Generations</li>
    </ul>
  </slot>
</planCard>
```

The template owns shared markup, named slots own content, and classes such as `.plan-card--starter`, `.plan-card--pro`, and `.plan-card--max` own visual differences.
