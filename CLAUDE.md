# ForgeGUI Interactive Mockup

## Asset & Path Resolution

**All file paths in HTML are always relative to the project root.** The compiler resolves paths at build time regardless of where the HTML file lives in the directory tree.

- `src="icons/arrow.svg"` — correct, even from `course/randomCourse/part1.html`
- `src="../../icons/arrow.svg"` — WRONG, never use relative `../` traversal
- `href="base.css"` — correct from any depth
- `template="templates/course-sidebar.html"` — correct from any depth

This applies to: `src`, `href`, `template`, `url()` in inline styles, and any other path attribute in HTML files. CSS files (`base.css`) are served from the root so their `url()` calls are already root-relative.
