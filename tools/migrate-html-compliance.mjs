import fs from "node:fs";
import path from "node:path";
import postcss from "/tmp/opencode/html-migrate/node_modules/postcss/lib/postcss.js";
import selectorParser from "/tmp/opencode/html-migrate/node_modules/postcss-selector-parser/dist/index.js";

const root = process.cwd();
const customNames = `actions asset assetbar assetgrid badge banner bignumber billingpicker bio bottom bottombox buttons cardinfo carouselpage carouselsteps chatbox chatcontainer chatwindow chrome commentfield commentsbox communityasset communityassets communityassetsgrid communitytag communitytags completionbar completionbarbg content contextmenu coursegrid courseheader courseplayer coursethumbnail dateoption devrow devtuner doxx engagement featuredinfo featuregroup fielderror fieldgroup followitem followlist fomo gallery gallerycard gallerycarousel galleryfeatured galleryline gallerytop game gamebackpack gamehotbar gamehud games gamesgrid gametoast group hint horizbuttons info leaderboard leaderboardheader leaderboardposition left leftside likescount line listbox mainview mainviewtop meat mediacarousel mediaplaceholder mediaslots message msgtop onboardingheader onboardingoptionsgrid ownprompt physicalbox planbadge plancard planfeatures planprice plans plantitle playscount pluginbox pluginchip plugingrid pluginheader pluginvideo popup popupcontainer post posttag posttitle premiumbadge preview previewgrid pricebenefits priceline projectgrid projects right rightside searchwrapper selectwrapper settingsview sidebar sidebaruserbutton specialtabs sticky stockprompts suggestion suggestionbar tag tags timebadge timeline timestamp top topbar topbox toplabel trophytype userctx username userpfp verifiedcta vertical winner winners`;
const names = new Set(customNames.split(/\s+/));

function target(name) {
  return `fg-${name.toLowerCase()}`;
}

function transformSelector(selector) {
  return selectorParser((selectors) => {
    selectors.walkTags((tag) => {
      const lower = tag.value.toLowerCase();
      if (names.has(lower)) tag.value = target(lower);
    });
  }).processSync(selector);
}

function transformCss(source, from) {
  const ast = postcss.parse(source, { from });
  ast.walkRules((rule) => {
    rule.selector = transformSelector(rule.selector);
  });
  return ast.toString();
}

function transformDirectives(source) {
  const stack = [];
  return source.replace(/<\/?slot\b[^>]*>/gi, (token) => {
    if (/^<\/slot/i.test(token)) return `</${stack.pop() || "fg-slot"}>`;
    const include = /\stemplate\s*=/i.test(token);
    const tag = include ? "fg-include" : "fg-slot";
    let output = token.replace(/^<slot/i, `<${tag}`);
    output = output.replace(/\stemplate\s*=/i, " data-template=");
    output = output.replace(/\sname\s*=/i, " data-name=");
    if (!/\/\s*>$/.test(token)) stack.push(tag);
    return output;
  });
}

function transformHtml(source, file) {
  let output = transformDirectives(source).replace(
    /\sslot\s*=\s*("[^"]*"|'[^']*')/gi,
    " data-slot=$1",
  );
  output = output.replace(/<(\/?)(([A-Za-z][\w-]*))(?=[\s/>])/g, (all, close, name) => {
    const lower = name.toLowerCase();
    return names.has(lower) ? `<${close}${target(lower)}` : all;
  });
  output = output.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (all, attrs, css) => {
    return `<style${attrs}>${transformCss(css, file)}</style>`;
  });
  return output;
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if ([".git", "dist", "node_modules"].includes(entry.name)) return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

for (const file of walk(root)) {
  const extension = path.extname(file);
  if (extension !== ".html" && extension !== ".css") continue;
  const source = fs.readFileSync(file, "utf8");
  const output = extension === ".css" ? transformCss(source, file) : transformHtml(source, file);
  if (output !== source) fs.writeFileSync(file, output);
}
