# ForgeGUI Interactive Mockup

## Asset & Path Resolution

**All file paths in source HTML and CSS are always relative to the project root.** The compiler and client template runtime resolve paths regardless of where a page, stylesheet, or template lives.

- `src="icons/arrow.svg"` — correct, even from `desktop/course/randomCourse/part1.html`
- `src="assets/generic.png"` — correct for shared media
- `href="styles/base.css"` — correct for shared styles
- `src="scripts/site.js"` — correct for shared scripts
- `src="../../icons/arrow.svg"` — WRONG, never use relative `../` traversal
- `template="templates/course-sidebar.html"` — correct from any depth

This applies to `src`, `srcset`, `href`, `action`, `poster`, `data-template`, and `url()` in styles. CSS `url()` values also use project-root paths, such as `url("assets/generic.png")` or `url("icons/checkmark.svg")`.

## Page Structure

- `desktop/` contains desktop page implementations.
- `mobile/` contains mobile implementations or `<fg-page>` aliases to desktop pages.
- `templates/` contains shared server- and client-rendered fragments.
- `icons/` contains interface icons.
- `assets/` contains shared images, video, and landing media.
- `styles/` contains shared CSS.
- `scripts/` contains shared JavaScript.
- Public links always target the logical route, such as `href="settings/overview.html"`. Never link directly to `desktop/` or `mobile/`.
