import { createServer } from "node:http";
import { watch } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_DIRECTORY = join(ROOT, "templates");
const DOCS_DIRECTORY = join(ROOT, "docs");
const DESKTOP_DIRECTORY = join(ROOT, "desktop");
const MOBILE_DIRECTORY = join(ROOT, "mobile");
const DEFAULT_PORT = 8080;
const MOBILE_QUERY = "(max-width: 700px)";
const VARIANTS = ["desktop", "mobile"];

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

const BUILD_EXTENSIONS = new Set(Object.keys(MIME_TYPES).concat(".txt"));
const WATCH_EXTENSIONS = new Set(Object.keys(MIME_TYPES).concat(".md"));
const DEV_RELOAD_SCRIPT = `<script data-dev-reload>
  (() => {
    const events = new EventSource("/__dev/reload");
    events.addEventListener("reload", () => location.reload());
  })();
</script>`;
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "section";
}

function parseFrontmatter(source, file) {
  const metadata = {};
  let body = source;
  if (source.startsWith("---\n")) {
    const end = source.indexOf("\n---\n", 4);
    if (end !== -1) {
      source.slice(4, end).split("\n").forEach(function (line) {
        const separator = line.indexOf(":");
        if (separator === -1) return;
        metadata[line.slice(0, separator).trim()] = line
          .slice(separator + 1)
          .trim()
          .replace(/^(["'])(.*)\1$/, "$2");
      });
      body = source.slice(end + 5);
    }
  }

  const fallbackTitle = relative(DOCS_DIRECTORY, file)
    .replace(/\.md$/i, "")
    .split(sep)
    .pop()
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  return {
    body,
    metadata: {
      description: metadata.description || "ForgeGUI documentation",
      order: Number(metadata.order || 999),
      section: metadata.section || "Documentation",
      sectionId: metadata.sectionId || metadata.section || "Documentation",
      sectionOrder: Number(metadata.sectionOrder || 999),
      title: metadata.title || fallbackTitle,
    },
  };
}

function renderInlineMarkdown(value) {
  const code = [];
  let output = escapeHtml(value).replace(/`([^`]+)`/g, function (_, content) {
    const index = code.push(`<code>${content}</code>`) - 1;
    return `\u0000CODE${index}\u0000`;
  });
  output = output
    .replace(
      /!\[([^\]]*)\]\(([^\s)]+)(?:\s+(?:&quot;|&#39;)(.*?)(?:&quot;|&#39;))?\)/g,
      function (_, alt, source, title) {
        return `<img src="${source}" alt="${alt}"${title ? ` title="${title}"` : ""}>`;
      },
    )
    .replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/___([^_]+)___/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|\W)\*([^*]+)\*(?=\W|$)/g, "$1<em>$2</em>")
    .replace(/(^|\W)_([^_]+)_(?=\W|$)/g, "$1<em>$2</em>")
    .replace(/\u0000CODE(\d+)\u0000/g, (_, index) => code[Number(index)]);
  return output;
}

function renderMarkdown(source) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const headings = [];
  const usedIds = new Map();
  const output = [];
  let index = 0;

  function uniqueId(title) {
    const base = slugify(title);
    const count = usedIds.get(base) || 0;
    usedIds.set(base, count + 1);
    return count ? `${base}-${count + 1}` : base;
  }

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```([\w+-]*)\s*(.*)$/);
    if (fence) {
      const language = fence[1] || "text";
      const label = fence[2] || `example.${language}`;
      const code = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      output.push(
        `<figure class="docsCode"><figcaption><img src="icons/Programming.svg" alt="">${escapeHtml(label)}</figcaption><pre><code class="language-${escapeHtml(language)}">${escapeHtml(code.join("\n"))}</code></pre></figure>`,
      );
      continue;
    }

    const details = line.match(/^:::details(?:\s+(open))?\s+(.+)$/i);
    if (details) {
      const body = [];
      index += 1;
      while (index < lines.length && lines[index].trim() !== ":::") {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      output.push(
        `<details class="docsDetails"${details[1] ? " open" : ""}><summary>${renderInlineMarkdown(details[2])}</summary><div>${renderMarkdown(body.join("\n")).html}</div></details>`,
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].replace(/[*_`]/g, "");
      const id = uniqueId(title);
      headings.push({ id, level, title });
      output.push(`<h${level} id="${id}">${renderInlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (line.startsWith(">")) {
      const quote = [];
      while (index < lines.length && lines[index].startsWith(">")) {
        quote.push(lines[index].replace(/^> ?/, ""));
        index += 1;
      }
      const callout = quote[0]?.match(/^\[!(TIP|NOTE|WARNING)\]\s*(.*)$/i);
      if (callout) {
        quote.shift();
        const type = callout[1].toLowerCase();
        const title = callout[2] || callout[1];
        output.push(
          `<aside class="docsCallout ${type}"><strong><img src="icons/Exclamation.svg" alt="">${escapeHtml(title)}</strong><div>${renderMarkdown(quote.join("\n")).html}</div></aside>`,
        );
      } else {
        output.push(`<blockquote>${renderMarkdown(quote.join("\n")).html}</blockquote>`);
      }
      continue;
    }

    if (
      line.includes("|") &&
      index + 1 < lines.length &&
      /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])
    ) {
      const rows = [];
      function cells(row) {
        return row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
      }
      rows.push(cells(line));
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(cells(lines[index]));
        index += 1;
      }
      const header = rows.shift();
      output.push(
        `<div class="docsTableWrap"><table><thead><tr>${header.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`,
      );
      continue;
    }

    const list = line.match(/^\s*([-*+] |\d+\. )(.*)$/);
    if (list) {
      const ordered = /\d+\./.test(list[1]);
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*([-*+] |\d+\. )(.*)$/);
        if (!item || /\d+\./.test(item[1]) !== ordered) break;
        items.push(`<li>${renderInlineMarkdown(item[2])}</li>`);
        index += 1;
      }
      output.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,6})\s|^```|^:::details|^>|^\s*([-*+] |\d+\. )/.test(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    output.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
  }

  return { headings, html: output.join("\n") };
}

async function collectFiles(directory, extension) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(file, extension));
    } else if (extname(entry.name).toLowerCase() === extension) {
      files.push(file);
    }
  }

  return files;
}

async function collectPageRoutes() {
  const files = await collectFiles(DESKTOP_DIRECTORY, ".html");
  return files.map((file) => relative(DESKTOP_DIRECTORY, file).replaceAll(sep, "/"));
}

function pageVariant(pagePath) {
  const match = pagePath.match(/^(desktop|mobile)\/(.+)$/);
  return match ? { name: match[1], route: match[2] } : null;
}

async function readPageSource(file, chain = []) {
  if (chain.includes(file)) {
    throw new Error(
      `Page alias cycle: ${chain.concat(file).map((entry) => relative(ROOT, entry)).join(" -> ")}`,
    );
  }

  const source = await readFile(file, "utf8");
  const alias = source.trim().match(
    /^<fg-page\s+data-source\s*=\s*(?:"([^"]+)"|'([^']+)')\s*><\/fg-page>$/i,
  );
  if (!alias) return source;

  const target = resolve(ROOT, alias[1] ?? alias[2]);
  const targetPath = relative(ROOT, target);
  if (
    isAbsolute(targetPath) ||
    targetPath === ".." ||
    targetPath.startsWith(`..${sep}`) ||
    !pageVariant(targetPath.replaceAll(sep, "/")) ||
    extname(target).toLowerCase() !== ".html"
  ) {
    throw new Error(`Page alias must target desktop/ or mobile/: ${alias[1] ?? alias[2]}`);
  }
  return readPageSource(target, chain.concat(file));
}

async function collectDocs() {
  const files = await collectFiles(DOCS_DIRECTORY, ".md");
  const docs = await Promise.all(files.map(async function (file) {
    const parsed = parseFrontmatter(await readFile(file, "utf8"), file);
    return {
      ...parsed.metadata,
      body: parsed.body,
      file,
      route: relative(ROOT, file)
        .replace(/\.md$/i, ".html")
        .replaceAll(sep, "/"),
    };
  }));

  return docs.sort(function (first, second) {
    return first.sectionOrder - second.sectionOrder ||
      first.order - second.order ||
      first.title.localeCompare(second.title);
  });
}

function renderDocsNavigation(docs, currentRoute) {
  const sections = new Map();
  docs.forEach(function (doc) {
    if (!sections.has(doc.sectionId)) {
      sections.set(doc.sectionId, { label: doc.section, pages: [] });
    }
    sections.get(doc.sectionId).pages.push(doc);
  });

  return Array.from(sections.values()).map(function (section) {
    return `<section class="docsNavSection">
      <h2><span>${escapeHtml(section.label)}</span></h2>
      ${section.pages.map(function (doc) {
        const current = doc.route === currentRoute;
        return `<a href="${escapeHtml(doc.route)}"${current ? ' class="current" aria-current="page"' : ""}>${escapeHtml(doc.title)}</a>`;
      }).join("\n")}
    </section>`;
  }).join("\n");
}

function renderDocsToc(headings) {
  if (!headings.length) {
    return '<p class="docsTocEmpty">No sections on this page.</p>';
  }

  return headings.map(function (heading, index) {
    const current = index === 0 ? " current" : "";
    return `<a href="#${escapeHtml(heading.id)}" class="docsTocLevel${heading.level}${current}">${escapeHtml(heading.title)}</a>`;
  }).join("\n");
}

async function renderDocPage(file, variant = "desktop") {
  const docs = await collectDocs();
  const currentRoute = relative(ROOT, file)
    .replace(/\.md$/i, ".html")
    .replaceAll(sep, "/");
  const current = docs.find((doc) => doc.route === currentRoute);
  if (!current) {
    throw Object.assign(new Error("Documentation page not found"), {
      code: "ENOENT",
    });
  }

  const article = renderMarkdown(current.body);
  const shell = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(current.title)} - ForgeGUI Documentation</title>
    <meta name="description" content="${escapeHtml(current.description)}">
    <meta name="theme-color" content="#0a0a0a">
    <meta name="color-scheme" content="dark">
    <link rel="stylesheet" href="styles/public.css">
    <link rel="stylesheet" href="styles/docs.css">
    <script src="scripts/site.js" defer></script>
    <script src="scripts/docs.js" defer></script>
  </head>
  <body class="docsPage">
    <fg-include data-template="templates/docs-header.html"></fg-include>
    <div class="docsLayout">
      <aside class="docsSidebar" id="docs-navigation" aria-label="Documentation navigation">
        <a class="docsHome" href="docs.html">
          <img src="icons/arrow.svg" alt="">
          <span>Documentation</span>
        </a>
        <nav>${renderDocsNavigation(docs, currentRoute)}</nav>
      </aside>
      <main class="docsMain">
        <header class="docsToolbar">
          <nav class="docsBreadcrumbs" aria-label="Breadcrumb">
            <span>${escapeHtml(current.section)}</span>
            <img src="icons/arrow.svg" alt="">
            <strong>${escapeHtml(current.title)}</strong>
          </nav>
          <button class="docsSummaryButton" type="button" aria-expanded="false" aria-controls="docs-summary">
            <img src="icons/ai.svg" alt="">
            AI Summary
          </button>
          <button class="docsRailButton" type="button" data-docs-rail="docs-navigation" aria-expanded="false">Browse</button>
        </header>
        <aside class="docsSummary" id="docs-summary" hidden>${escapeHtml(current.description)}</aside>
        <article class="docsArticle">${article.html}</article>
      </main>
      <aside class="docsToc" id="docs-on-this-page" aria-label="On this page">
        <label class="docsSearch">
          <img src="icons/search.svg" alt="">
          <span class="visually-hidden">Find in page</span>
          <input type="search" placeholder="Find in Page..." data-docs-search>
        </label>
        <nav>
          <h2><span>On This Page</span></h2>
          ${renderDocsToc(article.headings)}
        </nav>
      </aside>
    </div>
  </body>
</html>`;
  const forgePath = `${variant}/${currentRoute}`;
  const expanded = await expandTemplates(shell);
  const withMeta = injectForgeMetadata(expanded, forgePath, currentRoute, variant);
  const marked = markActiveRoute(withMeta, currentRoute);
  return rewritePaths(marked, forgePath.split("/").length - 1);
}

function parseAttributes(tag) {
  const attributes = {};
  const body = tag.replace(/^<\/?[\w:-]+\s*|\/?\s*>$/g, "");
  const pattern =
    /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;

  while ((match = pattern.exec(body))) {
    attributes[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
  }

  return attributes;
}

function findSlotBlock(html, predicate, start = 0) {
  const pattern = /<\/?fg-(?:include|slot)\b[^>]*>/gi;
  pattern.lastIndex = start;
  let opening;

  while ((opening = pattern.exec(html))) {
    if (opening[0].startsWith("</")) continue;

    const attributes = parseAttributes(opening[0]);
    if (!predicate(attributes)) continue;

    if (/\/\s*>$/.test(opening[0])) {
      return {
        attributes,
        end: pattern.lastIndex,
        inner: "",
        innerEnd: pattern.lastIndex,
        innerStart: pattern.lastIndex,
        start: opening.index,
      };
    }

    let depth = 1;
    let token;

    while ((token = pattern.exec(html))) {
      if (token[0].startsWith("</")) depth -= 1;
      else if (!/\/\s*>$/.test(token[0])) depth += 1;

      if (depth === 0) {
        return {
          attributes,
          end: pattern.lastIndex,
          inner: html.slice(opening.index + opening[0].length, token.index),
          innerEnd: token.index,
          innerStart: opening.index + opening[0].length,
          start: opening.index,
        };
      }
    }

    throw new Error("Unclosed template directive");
  }

  return null;
}

function findElementEnd(html, tagName, openingEnd) {
  if (VOID_ELEMENTS.has(tagName.toLowerCase())) return openingEnd;

  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<\\/?${escaped}\\b[^>]*>`, "gi");
  pattern.lastIndex = openingEnd;
  let depth = 1;
  let token;

  while ((token = pattern.exec(html))) {
    if (token[0].startsWith("</")) depth -= 1;
    else if (!/\/\s*>$/.test(token[0])) depth += 1;
    if (depth === 0) return pattern.lastIndex;
  }

  throw new Error(`Unclosed <${tagName}> element with a slot attribute`);
}

function collectProjectedContent(html) {
  const projected = new Map();
  const ranges = [];
  const pattern =
    /<([A-Za-z][\w:-]*)\b[^>]*\sdata-slot\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>/gi;
  let match;

  while ((match = pattern.exec(html))) {
    if (match[1].toLowerCase() === "fg-slot") continue;

    const end = findElementEnd(html, match[1], pattern.lastIndex);
    const name = match[2] ?? match[3];
    const opening = match[0].replace(
      /\s+data-slot\s*=\s*(?:"[^"]*"|'[^']*')/i,
      "",
    );
    const element = opening + html.slice(pattern.lastIndex, end);

    if (!projected.has(name)) projected.set(name, []);
    projected.get(name).push(element);
    ranges.push([match.index, end]);
    pattern.lastIndex = end;
  }

  let cursor = 0;
  let defaultContent = "";

  ranges.forEach(function ([start, end]) {
    defaultContent += html.slice(cursor, start);
    cursor = end;
  });
  defaultContent += html.slice(cursor);

  projected.set("", [defaultContent.trim()]);
  return projected;
}

function projectContent(template, projected) {
  let output = template;
  let slot;

  while ((slot = findSlotBlock(output, (attributes) => !attributes["data-template"]))) {
    const name = slot.attributes["data-name"] || "";
    const supplied = projected.get(name)?.join("\n");
    const replacement = supplied || slot.inner;
    output = output.slice(0, slot.start) + replacement + output.slice(slot.end);
  }

  return output;
}

function addClassesToRoot(html, extraClasses) {
  const extra = extraClasses.trim();
  if (!extra) return html;
  // Match first opening tag, handling quoted attribute values that may contain spaces
  return html.replace(
    /(<[A-Za-z][\w:-]*)(\s(?:[^"'>]|"[^"]*"|'[^']*')*)?>/,
    function (match, tagOpen, attrs) {
      attrs = attrs || "";
      if (/\bclass\s*=\s*(?:"[^"]*"|'[^']*')/i.test(attrs)) {
        return (
          tagOpen +
          attrs.replace(
            /(\bclass\s*=\s*)(["'])(.*?)\2/i,
            (_, pre, q, existing) =>
              `${pre}${q}${[existing, extra].filter(Boolean).join(" ")}${q}`,
          ) +
          ">"
        );
      }
      return `${tagOpen}${attrs} class="${extra}">`;
    },
  );
}

function resolveTemplatePath(templatePath) {
  const file = resolve(ROOT, templatePath);
  const relativePath = relative(TEMPLATE_DIRECTORY, file);

  if (
    isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    throw new Error(`Template must be inside templates/: ${templatePath}`);
  }

  return file;
}

async function expandTemplates(html, chain = []) {
  let output = html;
  let slot;

  while ((slot = findSlotBlock(output, (attributes) => attributes["data-template"]))) {
    const templateFile = resolveTemplatePath(slot.attributes["data-template"]);

    if (chain.includes(templateFile)) {
      throw new Error(
        `Template cycle: ${chain
          .concat(templateFile)
          .map((file) => relative(ROOT, file))
          .join(" -> ")}`,
      );
    }

    const suppliedHtml = await expandTemplates(slot.inner, chain);
    const projected = collectProjectedContent(suppliedHtml);
    const source = await readFile(templateFile, "utf8");
    const expandedTemplate = await expandTemplates(
      source,
      chain.concat(templateFile),
    );
    let replacement = await expandTemplates(
      projectContent(expandedTemplate, projected),
      chain.concat(templateFile),
    );

    if (slot.attributes.class) {
      replacement = addClassesToRoot(replacement, slot.attributes.class);
    }

    output = output.slice(0, slot.start) + replacement + output.slice(slot.end);
  }

  return output;
}

function injectForgeMetadata(html, forgePath, route, variant) {
  const metadata = [
    `<meta name="forge-path" content="${escapeHtml(forgePath)}">`,
    `<meta name="forge-route" content="${escapeHtml(route)}">`,
    `<meta name="forge-variant" content="${escapeHtml(variant)}">`,
    "<style>html:not(.forge-motion-ready),html:not(.forge-motion-ready) *,html:not(.forge-motion-ready) *::before,html:not(.forge-motion-ready) *::after{animation:none!important;transition:none!important}fg-client-include{display:none}</style>",
    '<script src="scripts/forge-loader.js"></script>',
    '<script src="scripts/forge-runtime.js" defer></script>',
  ].join("\n    ");
  return html.replace(/<head([^>]*)>/i, `<head$1>\n    ${metadata}`);
}

function renderRouteBootstrap(route) {
  const depth = route.split("/").length - 1;
  const prefix = "../".repeat(depth);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#0a0a0a">
    <meta name="forge-bootstrap" content="${escapeHtml(route)}">
    <title>ForgeGUI</title>
    <style>html,body{min-height:100%;margin:0;background:#0a0a0a;color:#fff}</style>
    <script src="${prefix}scripts/forge-loader.js"></script>
  </head>
  <body>
    <noscript><a href="${prefix}desktop/${escapeHtml(route)}">Open the desktop interface</a></noscript>
  </body>
</html>`;
}

function markActiveRoute(html, pagePath) {
  let marked = false;
  const pageName = pagePath.split("/").pop();

  return html.replace(
    /<a\b[^>]*\bdata-route\s*=\s*(?:"[^"]*"|'[^']*')[^>]*>/gi,
    function (tag) {
      const attributes = parseAttributes(tag);
      const routes = (attributes["data-route"] || "").split(",").map((r) => r.trim());
      const active =
        !marked &&
        routes.some((route) =>
          route.endsWith("/")
            ? pagePath.startsWith(route)
            : route === pagePath || (pagePath === pageName && route === pageName),
        );
      let output = tag.replace(/\s+data-route\s*=\s*(?:"[^"]*"|'[^']*')/i, "");

      if (active) {
        marked = true;
        if (/\sclass\s*=\s*(?:"[^"]*"|'[^']*')/i.test(output)) {
          output = output.replace(
            /\sclass\s*=\s*(["'])(.*?)\1/i,
            function (_, quote, classes) {
              const names = classes.split(/\s+/).filter(Boolean);
              if (!names.includes("selected")) names.push("selected");
              return ` class=${quote}${names.join(" ")}${quote}`;
            },
          );
        } else {
          output = output.replace(/>$/, ' class="selected">');
        }
      }

      return output;
    },
  );
}

function isExternalPath(value) {
  return !value || /^(?:[a-z][a-z0-9+\-.]*:|\/|#)/i.test(value);
}

function rewriteUrlFunctions(value, prefix) {
  return value.replace(
    /url\(\s*(["']?)([^"')]+)\1\s*\)/gi,
    function (match, quote, path) {
      if (isExternalPath(path)) return match;
      return `url(${quote}${prefix}${path}${quote})`;
    },
  );
}

function rewriteSrcset(value, prefix) {
  return value.split(",").map(function (candidate) {
    const parts = candidate.trim().split(/\s+/);
    if (!isExternalPath(parts[0])) parts[0] = prefix + parts[0];
    return parts.join(" ");
  }).join(", ");
}

function rewritePaths(html, depth) {
  const prefix = "../".repeat(depth);
  let output = html.replace(
    /(\s)(src|href|action|poster|data-template)\s*=\s*(["'])([^"']*)\3/gi,
    function (match, whitespace, attr, quote, value) {
      if (isExternalPath(value)) return match;
      return `${whitespace}${attr}=${quote}${prefix}${value}${quote}`;
    },
  );
  output = output.replace(
    /(\s)srcset\s*=\s*(["'])([^"']*)\2/gi,
    function (_, whitespace, quote, value) {
      return `${whitespace}srcset=${quote}${rewriteSrcset(value, prefix)}${quote}`;
    },
  );
  output = output.replace(
    /(\s)style\s*=\s*(["'])([^"']*)\2/gi,
    function (_, whitespace, quote, value) {
      return `${whitespace}style=${quote}${rewriteUrlFunctions(value, prefix)}${quote}`;
    },
  );
  return output.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_, opening, css, closing) => opening + rewriteUrlFunctions(css, prefix) + closing,
  );
}

function rewriteCssPaths(css, file) {
  const forgePath = relative(ROOT, file).replaceAll(sep, "/");
  return rewriteUrlFunctions(css, "../".repeat(forgePath.split("/").length - 1));
}

async function renderPage(file) {
  const source = await readPageSource(file);
  const rendered = await expandTemplates(source);
  const forgePath = relative(ROOT, file).replaceAll(sep, "/");
  const variant = pageVariant(forgePath);
  if (!variant) throw new Error(`Page must be inside desktop/ or mobile/: ${forgePath}`);
  const withMeta = injectForgeMetadata(
    rendered,
    forgePath,
    variant.route,
    variant.name,
  );
  const marked = markActiveRoute(withMeta, variant.route);
  const depth = forgePath.split("/").length - 1;
  return rewritePaths(marked, depth);
}

function injectDevReload(html) {
  if (html.includes("</body>")) {
    return html.replace("</body>", `${DEV_RELOAD_SCRIPT}\n</body>`);
  }

  return html + DEV_RELOAD_SCRIPT;
}

function watchDevelopmentFiles(clients) {
  let reloadTimer;

  const watcher = watch(ROOT, { recursive: true }, function (_, filename) {
    if (!filename) return;

    const changedPath = filename.toString().replaceAll("\\", "/");
    const topLevelDirectory = changedPath.split("/")[0];
    const ignoredDirectories = new Set([
      ".git",
      ".github",
      ".direnv",
      "dist",
      "tools",
    ]);

    if (ignoredDirectories.has(topLevelDirectory)) return;
    if (!WATCH_EXTENSIONS.has(extname(changedPath).toLowerCase())) return;

    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(function () {
      const event = `event: reload\ndata: ${JSON.stringify({ path: changedPath })}\n\n`;

      clients.forEach(function (client) {
        try {
          client.write(event);
        } catch {
          clients.delete(client);
        }
      });
    }, 75);
  });

  watcher.on("error", function (error) {
    console.error("File watcher error:", error);
  });

  return watcher;
}

async function copyDirectory(source, destination) {
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.isDirectory()) await copyDirectory(sourcePath, destinationPath);
    else await copyFile(sourcePath, destinationPath);
  }
}

async function buildDirectory(sourceDir, destinationDir, ignoredNames = new Set()) {
  await mkdir(destinationDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (ignoredNames.has(entry.name)) continue;

    const source = join(sourceDir, entry.name);
    const target = join(destinationDir, entry.name);

    if (entry.isDirectory()) {
      await buildDirectory(source, target);
      continue;
    }

    if (entry.name === "opencode.json") continue;

    if (entry.name.endsWith(".html")) {
      await writeFile(target, await renderPage(source));
      continue;
    }

    if (entry.name.endsWith(".css")) {
      await writeFile(target, rewriteCssPaths(await readFile(source, "utf8"), source));
      continue;
    }

    if (BUILD_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      await copyFile(source, target);
    }
  }
}

async function buildDocs(destination) {
  const docs = await collectDocs();
  for (const variant of VARIANTS) {
    for (const doc of docs) {
      const target = join(destination, variant, doc.route);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, await renderDocPage(doc.file, variant));
    }
  }
  return docs.map((doc) => doc.route);
}

async function copyClientTemplates(sourceDir, destinationDir) {
  await mkdir(destinationDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const source = join(sourceDir, entry.name);
    const target = join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      await copyClientTemplates(source, target);
    } else if (entry.name.endsWith(".html")) {
      await copyFile(source, target);
    }
  }
}

async function buildRouteBootstraps(destination, routes) {
  for (const route of routes) {
    const target = join(destination, route);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, renderRouteBootstrap(route));
  }
}

async function assertVariantParity(routes) {
  for (const route of routes) {
    await stat(join(MOBILE_DIRECTORY, route));
  }
}

async function build(destinationArgument = "dist") {
  const destination = resolve(process.cwd(), destinationArgument);

  if (destination === ROOT) {
    throw new Error("Build destination cannot be the project root");
  }

  await rm(destination, { force: true, recursive: true });

  const ignoredAtRoot = new Set([
    ".git", ".github", ".direnv", ".claude",
    "dist", "docs", "tools", "templates", "node_modules",
    "extension.js", "landing-assets", "todo.txt",
  ]);
  const pageRoutes = await collectPageRoutes();
  await assertVariantParity(pageRoutes);
  await buildDirectory(ROOT, destination, ignoredAtRoot);
  const docRoutes = await buildDocs(destination);
  await copyClientTemplates(TEMPLATE_DIRECTORY, join(destination, "templates"));
  await buildRouteBootstraps(destination, pageRoutes.concat(docRoutes));

  await writeFile(join(destination, ".nojekyll"), "");
  console.log(`Built ${relative(process.cwd(), destination) || "."}`);
}

function getPort(argumentsList) {
  const flagIndex = argumentsList.indexOf("--port");
  const value =
    flagIndex === -1 ? process.env.PORT : argumentsList[flagIndex + 1];
  return Number(value || DEFAULT_PORT);
}

async function serve(argumentsList) {
  const port = getPort(argumentsList);
  const reloadClients = new Set();
  const watcher = watchDevelopmentFiles(reloadClients);

  const keepAlive = setInterval(function () {
    reloadClients.forEach(function (client) {
      client.write(": keep-alive\n\n");
    });
  }, 15000);
  keepAlive.unref();

  const server = createServer(async function (request, response) {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);

      if (url.pathname === "/__dev/reload") {
        response.writeHead(200, {
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "Content-Type": "text/event-stream",
        });
        response.write("retry: 1000\nevent: ready\ndata: {}\n\n");
        reloadClients.add(response);
        request.on("close", function () {
          reloadClients.delete(response);
        });
        return;
      }

      let requestPath = decodeURIComponent(
        url.pathname === "/" ? "/index.html" : url.pathname,
      );
      if (requestPath.endsWith("/")) requestPath += "index.html";
      const route = requestPath.replace(/^\//, "");
      const pageRoutes = await collectPageRoutes();
      const docs = await collectDocs();
      const docRoutes = docs.map((doc) => doc.route);
      if (pageRoutes.includes(route) || docRoutes.includes(route)) {
        const content = injectDevReload(renderRouteBootstrap(route));
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Type": MIME_TYPES[".html"],
        });
        response.end(request.method === "HEAD" ? undefined : content);
        return;
      }

      const file = resolve(ROOT, `.${requestPath}`);

      if (file !== ROOT && !file.startsWith(`${ROOT}${sep}`)) {
        response.writeHead(403).end("Forbidden");
        return;
      }

      const docsMatch = route.match(/^(desktop|mobile)\/(docs\/.+\.html)$/);
      const docsRequest = Boolean(docsMatch);
      const target = docsRequest
        ? resolve(ROOT, docsMatch[2].replace(/\.html$/i, ".md"))
        : file;
      const fileStats = await stat(target);
      const resolvedTarget = fileStats.isDirectory() ? join(target, "index.html") : target;
      const extension = docsRequest ? ".html" : extname(resolvedTarget).toLowerCase();
      const content = docsRequest
        ? injectDevReload(await renderDocPage(resolvedTarget, docsMatch[1]))
        : route.startsWith("templates/") && extension === ".html"
          ? await readFile(resolvedTarget)
        : extension === ".html"
          ? injectDevReload(await renderPage(resolvedTarget))
          : extension === ".css"
            ? rewriteCssPaths(await readFile(resolvedTarget, "utf8"), resolvedTarget)
          : await readFile(resolvedTarget);

      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      const statusCode = error.code === "ENOENT" ? 404 : 500;
      response.writeHead(statusCode, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end(statusCode === 404 ? "Not found" : error.stack);
    }
  });

  server.listen(port, function () {
    console.log(`ForgeGUI dev server: http://localhost:${port}`);
    console.log("Watching files; changes trigger a full browser reload.");
  });

  server.on("close", function () {
    watcher.close();
    clearInterval(keepAlive);
    reloadClients.forEach(function (client) {
      client.end();
    });
  });
}

const [command = "serve", ...argumentsList] = process.argv.slice(2);

if (command === "build") await build(argumentsList[0]);
else if (command === "serve") await serve(argumentsList);
else {
  console.error(
    "Usage: node tools/site.mjs [serve [--port 8080] | build [dist]]",
  );
  process.exitCode = 1;
}
