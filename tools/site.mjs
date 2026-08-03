import { createServer } from "node:http";
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
const DEFAULT_PORT = 8080;

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
  const pattern = /<\/?slot\b[^>]*>/gi;
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

    throw new Error("Unclosed <slot> element");
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
    /<([A-Za-z][\w:-]*)\b[^>]*\sslot\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>/gi;
  let match;

  while ((match = pattern.exec(html))) {
    if (match[1].toLowerCase() === "slot") continue;

    const end = findElementEnd(html, match[1], pattern.lastIndex);
    const name = match[2] ?? match[3];
    const opening = match[0].replace(/\s+slot\s*=\s*(?:"[^"]*"|'[^']*')/i, "");
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

  while ((slot = findSlotBlock(output, (attributes) => !attributes.template))) {
    const name = slot.attributes.name || "";
    const supplied = projected.get(name)?.join("\n");
    const replacement = supplied || slot.inner;
    output = output.slice(0, slot.start) + replacement + output.slice(slot.end);
  }

  return output;
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

  while ((slot = findSlotBlock(output, (attributes) => attributes.template))) {
    const templateFile = resolveTemplatePath(slot.attributes.template);

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
    const replacement = await expandTemplates(
      projectContent(expandedTemplate, projected),
      chain.concat(templateFile),
    );

    output = output.slice(0, slot.start) + replacement + output.slice(slot.end);
  }

  return output;
}

function markActiveRoute(html, pageName) {
  let marked = false;

  return html.replace(
    /<a\b[^>]*\bdata-route\s*=\s*(?:"[^"]*"|'[^']*')[^>]*>/gi,
    function (tag) {
      const attributes = parseAttributes(tag);
      const routes = (attributes["data-route"] || "").split(",");
      const active = !marked && routes.includes(pageName);
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

async function renderPage(file) {
  const source = await readFile(file, "utf8");
  const rendered = await expandTemplates(source);
  return markActiveRoute(rendered, file.split(sep).pop());
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

async function build(destinationArgument = "dist") {
  const destination = resolve(process.cwd(), destinationArgument);

  if (destination === ROOT) {
    throw new Error("Build destination cannot be the project root");
  }

  await rm(destination, { force: true, recursive: true });
  await mkdir(destination, { recursive: true });

  const entries = await readdir(ROOT, { withFileTypes: true });

  for (const entry of entries) {
    const source = join(ROOT, entry.name);
    const target = join(destination, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "icons") await copyDirectory(source, target);
      continue;
    }

    if (entry.name === "opencode.json") {
      continue;
    }

    if (entry.name.endsWith(".html")) {
      await writeFile(target, await renderPage(source));
      continue;
    }

    if (BUILD_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      await copyFile(source, target);
    }
  }

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

  const server = createServer(async function (request, response) {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const requestPath = decodeURIComponent(
        url.pathname === "/" ? "/index.html" : url.pathname,
      );
      const file = resolve(ROOT, `.${requestPath}`);

      if (file !== ROOT && !file.startsWith(`${ROOT}${sep}`)) {
        response.writeHead(403).end("Forbidden");
        return;
      }

      const fileStats = await stat(file);
      const target = fileStats.isDirectory() ? join(file, "index.html") : file;
      const extension = extname(target).toLowerCase();
      const content =
        extension === ".html"
          ? await renderPage(target)
          : await readFile(target);

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
