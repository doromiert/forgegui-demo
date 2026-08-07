/* ===========================================================================
   ForgeGUI — conversational game editor
   ---------------------------------------------------------------------------
   Owns the game DOCUMENT (an exportable .forge.json), the diff protocol used to
   edit it, and the OpenRouter chat loop.

   A game is a map of named JS modules run in order against the `Forge` engine.
   The model edits by emitting OPS against modules — it never rebuilds the whole
   game unless it explicitly asks to. Editing enemy behaviour costs one module,
   or one find/replace inside one module.
   =========================================================================== */

(function (global) {
    "use strict";

    const Forge = global.Forge;

    /* ═══════════════════════════════════════════════════════════════════
       DOCUMENT
       ═══════════════════════════════════════════════════════════════════ */

    const FORMAT = "forge.game/2";

    function blankDoc() {
        return {
            format: FORMAT,
            meta: {
                title: "Untitled World",
                objective: "A blank canvas — describe a game to begin.",
                created: new Date().toISOString(),
            },
            order: ["world", "player"],
            modules: {
                world: [
                    "// The stage: lighting, sky, and the ground plane.",
                    'Forge.hud.title("Untitled World", "A blank canvas — describe a game to begin.");',
                    "",
                    "Forge.sky({ top: 0x5fc9ff, bottom: 0xffe3b8 });",
                    "Forge.sun({});",
                    "",
                    "var ground = Forge.art.box(240, 4, 240, 0x63c86a);",
                    "ground.position.y = -2;",
                    "Forge.add(ground);",
                    "Forge.solid(ground);",
                    "",
                    "// Playable volume — bodies are clamped inside it.",
                    "Forge.bounds({ size: 240, minY: -40 });",
                ].join("\n"),

                player: [
                    "// The player: character model, controller and camera.",
                    "// Forge.state.player is the controller HANDLE — a later module can",
                    "// call .override(fn) / .detach() to replace this movement entirely.",
                    "var hero = Forge.art.character({});",
                    "Forge.add(hero);",
                    "",
                    "Forge.state.hero = hero;",
                    "Forge.state.player = Forge.controller.platformer(hero, {",
                    "  spawn: [0, 3, 0],",
                    "});",
                    "Forge.state.body = Forge.state.player.body;",
                    "",
                    "// no { dist } — inherits the engine's tuned default",
                    "Forge.cam.thirdPerson(hero);",
                ].join("\n"),
            },
        };
    }

    let doc = blankDoc();
    let lastRunErrors = [];

    function normalizeDoc(d) {
        if (!d || typeof d !== "object") throw new Error("not an object");
        if (!d.modules || typeof d.modules !== "object")
            throw new Error("missing `modules`");
        d.format = FORMAT;
        d.meta = d.meta || {};
        d.meta.title = d.meta.title || "Untitled World";
        d.meta.objective = d.meta.objective || "";
        const keys = Object.keys(d.modules);
        if (!Array.isArray(d.order)) d.order = keys.slice();
        // keep order authoritative but never lose a module that isn't listed
        d.order = d.order.filter(function (n) {
            return d.modules[n] != null;
        });
        keys.forEach(function (k) {
            if (d.order.indexOf(k) === -1) d.order.push(k);
        });
        return d;
    }

    /* ═══════════════════════════════════════════════════════════════════
       OPS — the diff protocol
       ═══════════════════════════════════════════════════════════════════ */

    function applyOps(ops) {
        const applied = [];
        const failed = [];

        if (!Array.isArray(ops)) throw new Error("ops must be a JSON array");

        for (let i = 0; i < ops.length; i++) {
            const op = ops[i] || {};
            try {
                switch (op.op) {
                    case "write": {
                        if (!op.module) throw new Error("`module` required");
                        if (typeof op.source !== "string")
                            throw new Error("`source` must be a string");
                        const isNew = doc.modules[op.module] == null;
                        doc.modules[op.module] = op.source;
                        if (isNew) doc.order.push(op.module);
                        applied.push(
                            (isNew ? "created " : "rewrote ") + op.module,
                        );
                        break;
                    }

                    case "patch": {
                        if (!op.module) throw new Error("`module` required");
                        const src = doc.modules[op.module];
                        if (src == null)
                            throw new Error("no module named '" + op.module + "'");
                        if (typeof op.find !== "string" || !op.find)
                            throw new Error("`find` must be a non-empty string");
                        if (typeof op.replace !== "string")
                            throw new Error("`replace` must be a string");

                        const first = src.indexOf(op.find);
                        if (first === -1)
                            throw new Error(
                                "`find` text not present in " + op.module,
                            );
                        if (src.indexOf(op.find, first + 1) !== -1)
                            throw new Error(
                                "`find` text is ambiguous in " +
                                    op.module +
                                    " (matches more than once) — include more context",
                            );
                        doc.modules[op.module] =
                            src.slice(0, first) +
                            op.replace +
                            src.slice(first + op.find.length);
                        applied.push("patched " + op.module);
                        break;
                    }

                    case "delete": {
                        if (doc.modules[op.module] == null)
                            throw new Error("no module named '" + op.module + "'");
                        delete doc.modules[op.module];
                        doc.order = doc.order.filter(function (n) {
                            return n !== op.module;
                        });
                        applied.push("deleted " + op.module);
                        break;
                    }

                    case "rename": {
                        const src = doc.modules[op.module];
                        if (src == null)
                            throw new Error("no module named '" + op.module + "'");
                        if (!op.to) throw new Error("`to` required");
                        delete doc.modules[op.module];
                        doc.modules[op.to] = src;
                        doc.order = doc.order.map(function (n) {
                            return n === op.module ? op.to : n;
                        });
                        applied.push("renamed " + op.module + " → " + op.to);
                        break;
                    }

                    case "order": {
                        if (!Array.isArray(op.value))
                            throw new Error("`value` must be an array");
                        doc.order = op.value.slice();
                        applied.push("reordered modules");
                        break;
                    }

                    case "meta": {
                        Object.assign(doc.meta, op.props || {});
                        applied.push("updated metadata");
                        break;
                    }

                    default:
                        throw new Error("unknown op '" + op.op + "'");
                }
            } catch (err) {
                failed.push({
                    index: i,
                    op: op.op,
                    module: op.module,
                    message: String((err && err.message) || err),
                });
            }
        }

        normalizeDoc(doc);
        return { applied: applied, failed: failed };
    }

    /* ═══════════════════════════════════════════════════════════════════
       RUN + PERSIST
       ═══════════════════════════════════════════════════════════════════ */

    const STORAGE_KEY = "forge.doc";

    function save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
        } catch (err) {
            /* quota / private mode — non-fatal */
        }
    }

    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return false;
            doc = normalizeDoc(JSON.parse(raw));
            return true;
        } catch (err) {
            return false;
        }
    }

    function runDoc() {
        const res = Forge.run(doc);
        applyOverrides();
        lastRunErrors = res.errors;
        if (res.errors.length) {
            Forge.toast(
                res.errors[0].module + ": " + res.errors[0].message,
                true,
            );
        }
        save();
        return res;
    }

    /* ── export / import ──────────────────────────────────────────────── */

    function slug(s) {
        return (
            String(s || "game")
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "") || "game"
        );
    }

    function exportDoc() {
        const json = JSON.stringify(doc, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = slug(doc.meta.title) + ".forge.json";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () {
            URL.revokeObjectURL(url);
        }, 1000);
        Forge.toast("Exported " + a.download);
    }

    function importDoc(text) {
        try {
            doc = normalizeDoc(JSON.parse(text));
            history.length = 0;
            if (convoEl) convoEl.innerHTML = "";
            runDoc();
            addMessage(
                "ai",
                "Imported “" + doc.meta.title + "” (" +
                    doc.order.length + " modules). Ready to edit.",
            );
            Forge.toast("Imported " + doc.meta.title);
        } catch (err) {
            Forge.toast("Import failed: " + err.message, true);
        }
    }

    /* ═══════════════════════════════════════════════════════════════════
       PROMPT
       ═══════════════════════════════════════════════════════════════════ */

    const SYSTEM_PROMPT = [
"You are Smithmaster, the in-editor game engineer for ForgeGUI. The user talks to you in",
"a chat panel next to a live 3D viewport. You edit their game by emitting ops.",
"",
"════════ RESPONSE FORMAT — STRICT ════════",
"Reply with exactly these two tags and nothing outside them:",
"",
"<userAnswer>",
"One to three sentences, plain prose, addressed to the user. Say what you changed",
"and anything they should try. No code, no markdown headings, no bullet lists.",
"</userAnswer>",
"<code>",
"[ ...a JSON array of ops... ]",
"</code>",
"",
"If the user only asks a question and nothing needs to change, still emit <code>[]</code>.",
"Never put prose inside <code>. Never wrap the JSON in markdown fences.",
"",
"════════ OPS ════════",
'{"op":"write","module":"NAME","source":"...full JS for the module..."}',
"    Create a module, or replace one wholesale. Use for new systems or a rewrite.",
'{"op":"patch","module":"NAME","find":"exact text","replace":"new text"}',
"    Surgical edit inside a module. `find` must match EXACTLY ONCE — include",
"    enough surrounding context to be unique. THIS IS THE DEFAULT for small",
"    changes (a constant, a color, one function body). Prefer it over `write`.",
'{"op":"delete","module":"NAME"}',
'{"op":"rename","module":"NAME","to":"NEWNAME"}',
'{"op":"order","value":["world","player","enemies"]}   // execution order',
'{"op":"meta","props":{"title":"...","objective":"..."}}',
"",
"COST DISCIPLINE — this matters:",
"Never re-emit a module you are not changing. Never rebuild the game from scratch",
"to make a small change. Tweaking jump height is one `patch`, not a `write`.",
"Adding enemies is one `write` of a new `enemies` module, leaving `world` and",
"`player` untouched. Only rewrite everything if the user asks for a totally",
"different game.",
"",
"════════ THE ENGINE ════════",
"Modules are plain JS (ES5-safe, no imports/async/fetch/DOM/timers) executed in",
"`order` with two globals: `Forge` and `THREE` (three.js r145). Share data between",
"modules via `Forge.state`. The engine is genre-agnostic — platformer, top-down,",
"racing, shooter, puzzle, tower defense, whatever the user wants.",
"",
"— SCENE —",
"Forge.add(obj) / Forge.remove(obj)          add to or remove from the scene",
"Forge.scene, Forge.camera, Forge.THREE      raw three.js escape hatches",
"Forge.state                                 shared object, survives across modules",
"Forge.time                                  seconds since the game started",
"",
"— ART (always use these; they carry the house style) —",
"Forge.art.box(w, h, d, color, opts)         toon-shaded box with an ink outline",
"Forge.art.character({primary,accent,shell,glow})  the robot avatar, 4.6 units tall",
"Forge.art.toon(color, {emissive,intensity,opacity})  material for custom geometry",
"Forge.art.outline(mesh, thickness)          add an ink outline to your own mesh",
"Forge.sky({top,bottom,fog,fogNear,fogFar})",
"Forge.sun({color,sky,ground,intensity,shadowRange})",
"",
"— COLLISION —",
"Forge.solid(obj, {w,h,d,tag})               register obj as a solid AABB",
"Forge.unsolid(obj) / Forge.syncSolid(obj)   remove / refresh after moving it",
"Forge.trigger(obj, {radius, once, onEnter:function(obj, body){}})",
"Forge.raycast(origin, direction, maxDist)   -> three.js intersection array",
"",
"— CLICKING WORLD OBJECTS (Roblox ClickDetector semantics) —",
"Forge.clickable(obj, {",
"  onClick:  function (obj, hit) {},   // hit.point is the world-space click point",
"  distance: 24,                       // MAX ACTIVATION DISTANCE, world units",
"  onHover:  function (isHovering, obj, inRange) {},",
"  onTooFar: function (obj, dist) {},  // default: a 'Too far away' toast",
"  enabled:  true",
"});",
"Forge.unclickable(obj)",
"Forge.clickDistance = 24        // global default when {distance} is omitted",
"A click only fires if the player is within range AND has line of sight — an",
"opaque object in the way blocks it. Distance is measured from the player's",
"mid-height to the exact point clicked. The cursor turns into a pointer when a",
"target is reachable and 'not-allowed' when it is out of range, so range is",
"always visible to the player without you building any UI.",
"Clicking a clickable consumes the click, so it will NOT also activate a held",
"item. Use this for doors, levers, buttons, shops, NPC dialogue, chests.",
"",
"— PHYSICS —",
"var b = Forge.body(obj, {width,height,gravity,spawn:[x,y,z],fallLimit,onFall})",
"    b.pos, b.vel (THREE.Vector3), b.grounded, b.respawn(), b.setSpawn(x,y,z)",
"    Set b.vel each frame; the engine integrates, resolves AABBs and moves obj.",
"    gravity: 0 gives a floaty/top-down body.",
"",
"— INPUT —",
"Forge.input.down('KeyE')                    held this frame",
"Forge.input.pressed('KeyE')                 went down THIS frame (edge)",
"Forge.input.axis2()                         -> {x, y, active}, WASD/arrows normalised",
"Forge.input.pointer                         -> {down, dx, dy, x, y}",
"    LEFT MOUSE BUTTON ONLY. `down` is whether left is held; `dx`/`dy` are this",
"    frame's left-drag delta. Left-click is yours: it activates held items and",
"    fires Forge.clickable handlers.",
"Forge.input.clicked()                       left press+release this frame",
"",
"THE MIDDLE MOUSE BUTTON IS RESERVED BY THE ENGINE for camera orbit and is not",
"exposed to you at all — there is no way to read it and no event for it. Never",
"tell the player to middle-click for a game action, and never design a control",
"scheme around it. Scroll wheel is likewise the camera's zoom.",
"",
"— CAMERA —",
"Forge.cam.thirdPerson(target, {dist, offsetY, allowDrag, allowZoom})",
"Forge.cam.topDown(target, {height})",
"Forge.cam.firstPerson(target, {eyeHeight})",
"Forge.cam.fixed([x,y,z], [lx,ly,lz])",
"Forge.cam.yaw / .pitch / .dist              read+write",
"Forge.cam.collision({enabled, pad, minDist, inSpeed, outSpeed, maxPullIn})",
"    ON by default. When the view is blocked the boom smoothly GLIDES shorter",
"    and eases back out once it clears — it never snaps or clips through walls.",
"    maxPullIn (default 10) caps how far it will auto-shorten: zoomed in, the",
"    camera solves occlusion by moving; zoomed far out it keeps the framing and",
"    lets the cutout carve the occluder instead of lurching inward.",
"Forge.cam.cutout({enabled, scale, radius, bias, fade})",
"    ON by default. A see-through hole around the player, opened ONLY when",
"    something actually breaks line of sight to the character. Geometry that is",
"    merely in front of the player, off to the side, or behind it is never cut.",
"    The hole auto-fits the character's on-screen size and fades in and out.",
"Only objects registered with Forge.solid() count as occluders for either",
"feature — purely decorative geometry does not block the camera.",
"Both already work — do not reimplement them, and do not disable them unless",
"the user explicitly asks.",
"Forge.cam.forward() / Forge.cam.right()     -> {x, z}; forward points AWAY from camera",
"    Camera-relative movement: dx = right.x*ax.x + forward.x*-ax.y",
"",
"— CONTROLLERS (optional helpers; never a requirement) —",
"Every controller returns a HANDLE, not a body:",
"    { obj, body, enabled, animate, override(fn), restore(), detach() }",
"Forge.controller.platformer(obj, {speed,jump,sprint,spawn})  WASD+jump+rig animation",
"Forge.controller.topDown(obj, {speed})",
"Forge.controller.flyer(obj, {speed})",
"Forge.controller.custom(obj, {update:function(dt,t,h){}, spawn, gravity})",
"    No built-in movement — you write the whole step. Use for any genre the",
"    stock controllers don't fit (racing, tank, grapple, rhythm, point-and-click).",
"Forge.animateRig(obj, {t, moving, grounded, rate})  walk cycle for custom controllers",
"",
"OVERRIDING THE DEFAULT PLAYER CONTROLLER:",
"The starter `player` module stores its handle at Forge.state.player. To change",
"how the player moves, DO NOT rewrite the player module — override it from your",
"own module, which is far cheaper and leaves the model/camera setup intact:",
"    Forge.state.player.override(function (dt, t, h) {",
"      h.body.vel.x = ...; h.body.vel.y = ...; h.body.vel.z = ...;",
"      Forge.animateRig(h.obj, {t: t, moving: true, grounded: h.body.grounded});",
"    });",
"Other handle uses: `.enabled = false` freezes the player (cutscenes, game over);",
"`.restore()` puts the stock behaviour back; `.detach()` removes it and its body",
"entirely, e.g. before attaching a different controller to the same character.",
"",
"— INVENTORY / ITEMS (Roblox-style hotbar + backpack) —",
"Define an item type, then give it to the player. Items mount to the character's",
"hand and inherit the arm swing automatically.",
"Forge.item.define('sword', {",
"  name: 'Sword',            // shown under the slot",
"  icon: '🗡',                // emoji for the slot; omit to use a colour swatch",
"  color: 0xffd23f,          // slot swatch AND the default blocky held model",
"  model: function () { return Forge.art.box(0.3, 2, 0.3, 0xdfe6f0); },  // optional",
"  hold: {pos:[0,-0.4,0.1], rot:[0,0,0], scale:1},   // grip offset in the hand",
"  handedness: 'right',      // or 'left'",
"  stackable: false,         // true = same id merges into one counted slot",
"  onEquip:    function (ctx) {},",
"  onUnequip:  function (ctx) {},",
"  onActivate: function (ctx) {},   // fires on click while equipped",
"  onUpdate:   function (ctx, dt, t) {}   // every frame while equipped",
"});",
"ctx = {id, def, mesh, character, body, inventory} — `mesh` is the held object,",
"`character` the holder, `body` its physics body.",
"",
"Forge.inventory.give('sword', 1) / .take('sword', 1)",
"Forge.inventory.has('key') / .count('coin')",
"Forge.inventory.equip('sword') or .equip(0)   // id, or 0-based hotbar index",
"Forge.inventory.unequip() / .activate() / .clear()",
"Forge.inventory.equipped                       // equipped item id, or null",
"Forge.inventory.onChange(function (inv) {})    // react to any change",
"Forge.inventory.holder(obj)                    // whose hand items mount to",
"                                               // (defaults to the player)",
"The hotbar has 9 slots and hides itself until the player owns something.",
"Overflow goes to a backpack. The engine already handles the UI and the controls:",
"number keys 1-9 equip/unequip, B opens the backpack, clicking the viewport",
"activates the held item. Do not build your own hotbar.",
"Use items for weapons, tools, keys, potions, collectibles, building blocks —",
"anything the player carries. Combine with Forge.trigger to make pickups:",
"    Forge.trigger(chest, {radius: 4, onEnter: function () {",
"      Forge.inventory.give('key'); Forge.toast('Picked up a key');",
"    }});",
"",
"— HUD (generic — no built-in score or coin concept) —",
"Forge.hud.title(title, objective)",
"Forge.hud.stat('Coins', '3 / 8')            add or update a labelled row",
"Forge.hud.removeStat('Coins') / Forge.hud.clear()",
"Forge.hud.hint('E to interact')             replaces the controls footer line",
"Forge.toast('Level complete!')              transient centre-screen message",
"",
"— LIFECYCLE —",
"Forge.onUpdate(function(dt, t){})           every frame",
"Forge.onStart(function(){})                 after all modules have loaded",
"",
"— UTILS —",
"Forge.rand(a,b)  Forge.randInt(a,b)  Forge.pick(arr)",
"Forge.clamp(v,a,b)  Forge.lerp(a,b,t)  Forge.dist2d(a,b)",
"",
"════════ SCALE AND BOUNDS ════════",
"The character is 4.6 units tall, 1.2 wide. With the default platformer controller",
"jump apex is ~3.6 units and jump distance ~11 units. So: platforms 8-16 wide, gaps",
"under 11, steps under 3.5, doorways 6+ tall.",
"",
"Every game has a playable volume. Bodies are clamped inside it, and falling below",
"minY counts as leaving the world (respawn by default).",
"Forge.bounds({size: 250})                    square centred on the origin",
"Forge.bounds({size: 250, x: 0, z: 0, minY: -40, maxY: 300, onExit: function(body){}})",
"Forge.bounds({minX:-100, maxX:100, minZ:-60, maxZ:60})   explicit box",
"Forge.bounds()                               read the current bounds",
"Default is 800x800 with minY -80 — deliberately loose. SET IT in your world",
"module to match the level you actually built, roughly one platform-width beyond",
"the furthest geometry. Tight bounds stop the player walking off into empty space",
"forever and make falling off read as a death rather than an endless drop.",
"Keep the whole level inside the bounds; a level normally fits in 250x250.",
"",
"════════ ART DIRECTION (non-negotiable) ════════",
"Blend Roblox and Fortnite: chunky low-poly blocks, no fine detail, thick ink",
"outlines (automatic via Forge.art.box), loud saturated colour. Every surface is",
"one flat toon colour. Bright graded skies. Pick 4-6 hues per level and repeat",
"them; greys only as structural accents.",
"Palette: 0xf25f5c 0xffd23f 0x3fa9f5 0x8ce99a 0xb75cff 0xff9f45 0x4ecdc4 0xff7ad9",
"Characters are always Forge.art.character — never assemble one out of boxes.",
"",
"════════ CRAFT ════════",
"Populate the world: playable geometry first, then props, and NPCs where they fit.",
"Use loops and trigonometry for arrangements rather than long literal lists.",
"Keep modules focused and named for what they do (world, player, enemies, pickups,",
"ui, rules). Put gameplay rules in their own module so they can be tuned cheaply.",
"When the user asks you to do something that requires cursor interaction, keep the",
"cursor hitboxes to the minimum as the default way to rotate the camera is by",
"holding left mouse button with the mouse and panning around. Clickable elements",
"need to always be highlighted when they're hovered over to let the user know",
"they're about to interact with the world as opposed to panning."
    ].join("\n");

    function docListing() {
        const lines = [];
        lines.push("Current game: " + JSON.stringify(doc.meta.title));
        lines.push("Objective: " + JSON.stringify(doc.meta.objective || ""));
        lines.push("Module order: " + JSON.stringify(doc.order));
        lines.push("");
        for (let i = 0; i < doc.order.length; i++) {
            const name = doc.order[i];
            const src = doc.modules[name];
            if (src == null) continue;
            lines.push("--- module: " + name + " ---");
            lines.push(src);
            lines.push("");
        }
        if (lastRunErrors.length) {
            lines.push("RUNTIME ERRORS from the last build — fix these:");
            for (let i = 0; i < lastRunErrors.length; i++) {
                lines.push(
                    "  [" + lastRunErrors[i].module + "] " + lastRunErrors[i].message,
                );
            }
            lines.push("");
        }
        return lines.join("\n");
    }

    /* ═══════════════════════════════════════════════════════════════════
       CHAT UI
       ═══════════════════════════════════════════════════════════════════ */

    const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
    const MODEL = "anthropic/claude-opus-5";

    const history = []; // prose only — the doc listing carries the real state
    let convoEl = null;
    let tokenInput = null;
    let busy = false;
    let inflight = null; // AbortController for the live request
    let sendBtn = null;
    let sendLabel = null;
    let sendIdleText = "Create";

    // The send button doubles as the cancel button while a request is running.
    function setBusy(on) {
        busy = on;
        if (!sendBtn) return;
        sendBtn.classList.toggle("busy", on);
        if (sendLabel) sendLabel.textContent = on ? "Cancel" : sendIdleText;
        sendBtn.setAttribute(
            "aria-label",
            on ? "Cancel generation" : sendIdleText,
        );
    }

    function cancel() {
        if (inflight) {
            inflight.abort();
            inflight = null;
        }
    }

    function esc(s) {
        return String(s).replace(/[&<>]/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
        });
    }

    function addMessage(who, text) {
        const el = document.createElement("message");
        if (who === "you") {
            el.className = "you";
            el.textContent = text;
        } else {
            const top = document.createElement("msgTop");
            top.innerHTML = '<img src="icons/ai.svg" /><span>Smithmaster</span>';
            el.appendChild(top);
            const body = document.createElement("span");
            el.appendChild(body);
            el._body = body;
            renderAssistant(el, text || "", false);
        }
        // bottom.convo is column-reverse, so the newest message is child #1
        convoEl.insertBefore(el, convoEl.firstChild);
        return el;
    }

    // Streams the <userAnswer> prose; collapses the ops payload to a chip so
    // the chat doesn't become a wall of JSON. Until the first prose token
    // arrives there is nothing to show, so we show a thinking indicator.
    function renderAssistant(el, raw, working) {
        const body = el._body;
        if (!body) return;

        const m = raw.match(/<userAnswer>([\s\S]*?)(?:<\/userAnswer>|$)/i);
        const prose = m ? m[1].trim() : raw.indexOf("<") === -1 ? raw : "";

        let html = esc(prose).replace(/\n/g, "<br />");

        if (!prose && working) {
            // No prose yet: either still reasoning, or already writing ops
            // without having spoken (rare, but don't lie about it).
            html =
                '<thinking>' +
                (/<code>/i.test(raw) ? "Writing edits" : "Thinking") +
                '<dot>.</dot><dot>.</dot><dot>.</dot></thinking>';
        }

        if (prose && working) {
            html += ' <thinking><dot>.</dot><dot>.</dot><dot>.</dot></thinking>';
        }

        if (/<code>/i.test(raw)) {
            const cm = raw.match(/<code>([\s\S]*?)(?:<\/code>|$)/i);
            const opCount = cm ? (cm[1].match(/"op"\s*:/g) || []).length : 0;
            html +=
                '<br /><code class="buildChip">⚙ ' +
                (opCount ? opCount + (opCount === 1 ? " edit" : " edits") : "editing…") +
                "</code>";
        }
        body.innerHTML = html;
    }

    function setSummary(el, applied, failed) {
        const body = el._body;
        if (!body) return;
        const chip = body.querySelector("code.buildChip");
        if (!chip) return;
        if (failed.length) {
            chip.classList.add("bad");
            chip.textContent =
                "⚠ " + applied.length + " applied · " + failed.length + " failed";
        } else if (applied.length) {
            chip.textContent = "✓ " + applied.join(" · ");
        } else {
            chip.remove();
        }
    }

    function parseReply(raw) {
        const ua = raw.match(/<userAnswer>([\s\S]*?)<\/userAnswer>/i);
        const cd = raw.match(/<code>([\s\S]*?)<\/code>/i);
        let ops = null;
        let parseError = null;
        if (cd) {
            // tolerate the model wrapping the JSON in a markdown fence anyway
            let body = cd[1].trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
            body = body.trim();
            if (body) {
                try {
                    ops = JSON.parse(body);
                } catch (err) {
                    parseError = err.message;
                }
            } else {
                ops = [];
            }
        }
        return {
            prose: ua ? ua[1].trim() : "",
            ops: ops,
            parseError: parseError,
        };
    }

    async function send(prompt) {
        const key = (tokenInput.value || "").trim();
        if (!key) {
            Forge.toast("Add your OpenRouter API key first", true);
            tokenInput.focus();
            return;
        }
        if (busy) return;
        setBusy(true);

        const ac = new AbortController();
        inflight = ac;

        addMessage("you", prompt);
        const el = addMessage("ai", "");
        renderAssistant(el, "", true);

        // Static system prompt first (cacheable prefix), then trimmed prose
        // history, then the live doc — only the last message changes shape.
        const messages = [{ role: "system", content: SYSTEM_PROMPT }]
            .concat(history.slice(-8))
            .concat([
                {
                    role: "user",
                    content:
                        docListing() +
                        "\n════════\nUser request: " +
                        prompt,
                },
            ]);

        let full = "";
        try {
            const res = await fetch(OPENROUTER_URL, {
                method: "POST",
                headers: {
                    Authorization: "Bearer " + key,
                    "Content-Type": "application/json",
                    "HTTP-Referer": location.origin,
                    "X-Title": "ForgeGUI",
                },
                body: JSON.stringify({
                    model: MODEL,
                    stream: true,
                    max_tokens: 16000,
                    messages: messages,
                }),
                signal: ac.signal,
            });

            if (!res.ok) {
                throw new Error(
                    res.status + " " + (await res.text()).slice(0, 220),
                );
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buf = "";
            for (;;) {
                const chunk = await reader.read();
                if (chunk.done) break;
                buf += decoder.decode(chunk.value, { stream: true });
                const lines = buf.split("\n");
                buf = lines.pop();
                for (const line of lines) {
                    if (!line.startsWith("data:")) continue;
                    const payload = line.slice(5).trim();
                    if (!payload || payload === "[DONE]") continue;
                    try {
                        const j = JSON.parse(payload);
                        const d =
                            j.choices &&
                            j.choices[0] &&
                            j.choices[0].delta &&
                            j.choices[0].delta.content;
                        if (d) {
                            full += d;
                            renderAssistant(el, full, true);
                        }
                    } catch (err) {
                        /* keep-alive comment or split SSE frame */
                    }
                }
            }

            const reply = parseReply(full);
            renderAssistant(el, full, false);

            history.push({ role: "user", content: prompt });
            history.push({
                role: "assistant",
                content:
                    "<userAnswer>" + (reply.prose || "(no prose)") + "</userAnswer>",
            });

            if (reply.parseError) {
                Forge.toast("Model sent malformed ops JSON: " + reply.parseError, true);
                lastRunErrors = [
                    { module: "ops", message: "malformed JSON: " + reply.parseError },
                ];
                return;
            }
            if (!reply.ops || !reply.ops.length) return;

            const result = applyOps(reply.ops);
            const run = runDoc();
            setSummary(el, result.applied, result.failed.concat(run.errors));

            if (result.failed.length) {
                // surface to the user AND to the model on the next turn
                lastRunErrors = lastRunErrors.concat(
                    result.failed.map(function (f) {
                        return {
                            module: f.module || "ops",
                            message: "op '" + f.op + "' failed: " + f.message,
                        };
                    }),
                );
                Forge.toast(result.failed[0].message, true);
            } else if (run.ok) {
                Forge.toast(result.applied.join(" · ") || "No changes");
            }
        } catch (err) {
            renderAssistant(el, full, false);
            const b = el._body;

            if (err && err.name === "AbortError") {
                // Deliberate cancel: keep whatever prose arrived, apply nothing.
                // The turn is dropped from history so the next request isn't
                // anchored to a half-finished answer.
                if (b)
                    b.innerHTML +=
                        '<br /><code class="buildChip">cancelled</code>';
                Forge.toast("Cancelled");
            } else {
                console.error(err);
                if (b)
                    b.innerHTML +=
                        '<br /><code class="buildChip bad">request failed: ' +
                        esc(err.message) +
                        "</code>";
                Forge.toast("Request failed: " + err.message, true);
            }
        } finally {
            inflight = null;
            setBusy(false);
        }
    }

    /* ═══════════════════════════════════════════════════════════════════
       TUNER — live dev panel, generated from Forge.tuning.list
       ═══════════════════════════════════════════════════════════════════ */

    const TUNING_KEY = "forge.tuning";
    let tunerEl = null;
    let overrides = {}; // only the knobs the user actually moved

    function loadOverrides() {
        try {
            overrides = JSON.parse(localStorage.getItem(TUNING_KEY) || "{}");
        } catch (err) {
            overrides = {};
        }
    }
    function saveOverrides() {
        try {
            localStorage.setItem(TUNING_KEY, JSON.stringify(overrides));
        } catch (err) {}
    }

    // Forge.run() resets camState to engine defaults, and the game's own
    // Forge.cam.* calls run on top of that — so overrides must be re-applied
    // after every build or a tweak silently vanishes on the next edit.
    function applyOverrides() {
        Forge.tuning.apply(overrides);
        refreshTuner();
    }

    function fmt(v) {
        if (v === null) return "auto";
        if (typeof v === "boolean") return v ? "on" : "off";
        return Math.abs(v) >= 100 || v === Math.round(v)
            ? String(Math.round(v * 100) / 100)
            : v.toFixed(2);
    }

    function buildTuner() {
        tunerEl = document.getElementById("tuner");
        if (!tunerEl) return;

        const groups = [];
        Forge.tuning.list.forEach(function (t) {
            let g = groups.find(function (x) {
                return x.name === t.group;
            });
            if (!g) groups.push((g = { name: t.group, items: [] }));
            g.items.push(t);
        });

        let html =
            "<tuneHead><span>Tuning</span>" +
            '<tuneActions>' +
            '<button data-act="copy" title="Copy as a Forge.cam.set(...) call">copy</button>' +
            '<button data-act="reset">reset</button>' +
            '<button data-act="close">✕</button>' +
            "</tuneActions></tuneHead>";

        groups.forEach(function (g) {
            html += "<tuneGroup><h>" + esc(g.name) + "</h>";
            g.items.forEach(function (t) {
                const v = t.get();
                if (t.type === "bool") {
                    html +=
                        '<tuneRow><label>' + esc(t.label) + "</label>" +
                        '<input type="checkbox" data-key="' + t.key + '"' +
                        (v ? " checked" : "") + " />" +
                        '<val data-val="' + t.key + '">' + fmt(v) + "</val></tuneRow>";
                } else {
                    const isAuto = t.type === "auto" && (v === null || v === undefined);
                    html +=
                        '<tuneRow><label>' + esc(t.label) + "</label>" +
                        (t.type === "auto"
                            ? '<input type="checkbox" class="autoBox" data-auto="' +
                              t.key + '"' + (isAuto ? " checked" : "") +
                              ' title="auto-fit" />'
                            : "") +
                        '<input type="range" data-key="' + t.key +
                        '" min="' + t.min + '" max="' + t.max +
                        '" step="' + t.step + '" value="' +
                        (isAuto ? t.min : v) + '"' +
                        (isAuto ? " disabled" : "") + " />" +
                        '<val data-val="' + t.key + '">' + fmt(v) + "</val></tuneRow>";
                }
            });
            html += "</tuneGroup>";
        });

        tunerEl.innerHTML = html;

        tunerEl.addEventListener("input", function (e) {
            const key = e.target.getAttribute("data-key");
            const autoKey = e.target.getAttribute("data-auto");

            if (autoKey) {
                const range = tunerEl.querySelector('[data-key="' + autoKey + '"]');
                if (e.target.checked) {
                    overrides[autoKey] = null;
                    range.disabled = true;
                } else {
                    range.disabled = false;
                    overrides[autoKey] = parseFloat(range.value);
                }
                Forge.tuning.set(autoKey, overrides[autoKey]);
                setVal(autoKey);
                saveOverrides();
                return;
            }
            if (!key) return;

            const t = Forge.tuning.find(key);
            const v =
                t.type === "bool" ? e.target.checked : parseFloat(e.target.value);
            overrides[key] = v;
            Forge.tuning.set(key, v);
            setVal(key);
            saveOverrides();
        });

        tunerEl.addEventListener("click", function (e) {
            const act = e.target.getAttribute && e.target.getAttribute("data-act");
            if (act === "close") tunerEl.classList.add("hidden");
            if (act === "reset") {
                overrides = {};
                saveOverrides();
                runDoc(); // rebuild so engine + game defaults come back
            }
            if (act === "copy") copyTuning();
        });
    }

    function setVal(key) {
        if (!tunerEl) return;
        const el = tunerEl.querySelector('[data-val="' + key + '"]');
        if (el) el.textContent = fmt(Forge.tuning.get(key));
    }

    // Pull the live values back into the widgets (after a rebuild or reset).
    function refreshTuner() {
        if (!tunerEl) return;
        Forge.tuning.list.forEach(function (t) {
            const v = t.get();
            const input = tunerEl.querySelector('[data-key="' + t.key + '"]');
            const auto = tunerEl.querySelector('[data-auto="' + t.key + '"]');
            if (auto) {
                const isAuto = v === null || v === undefined;
                auto.checked = isAuto;
                if (input) input.disabled = isAuto;
            }
            if (input) {
                if (t.type === "bool") input.checked = !!v;
                else if (v !== null && v !== undefined) input.value = v;
            }
            setVal(t.key);
        });
    }

    function copyTuning() {
        const s = Forge.tuning.snapshot();
        const cam = {};
        Object.keys(s).forEach(function (k) {
            if (k === "clickDistance") return;
            // slider arithmetic leaves float noise (3.4499999999999997) —
            // don't paste that into source
            cam[k] =
                typeof s[k] === "number" ? Math.round(s[k] * 10000) / 10000 : s[k];
        });
        const text =
            "Forge.cam.set(" +
            JSON.stringify(cam, null, 2) +
            ");\nForge.clickDistance = " +
            s.clickDistance +
            ";";
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(
                function () {
                    Forge.toast("Copied Forge.cam.set(...)");
                },
                function () {
                    console.log(text);
                    Forge.toast("Clipboard blocked — logged to console", true);
                },
            );
        } else {
            console.log(text);
            Forge.toast("Logged to console");
        }
    }

    /* ═══════════════════════════════════════════════════════════════════
       WIRING
       ═══════════════════════════════════════════════════════════════════ */

    function wireChatbox() {
        const ta = document.querySelector("chatBox textarea");
        const btn = document.querySelector("chatBox .chatboxButton.send");
        if (!ta || !btn) return false;

        sendBtn = btn;
        sendLabel = btn.querySelector("span");
        if (sendLabel) sendIdleText = sendLabel.textContent.trim() || "Create";

        ta.placeholder = "Describe a change… (Ctrl+Enter to send)";

        function submit() {
            const v = ta.value.trim();
            if (!v) return;
            ta.value = "";
            send(v);
        }

        btn.addEventListener("click", function () {
            if (busy) cancel();
            else submit();
        });

        ta.addEventListener("keydown", function (e) {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if (busy) cancel();
                else submit();
            }
            if (e.key === "Escape" && busy) {
                e.preventDefault();
                cancel();
            }
        });

        setBusy(false);
        return true;
    }

    function wireDropImport(host) {
        host.addEventListener("dragover", function (e) {
            e.preventDefault();
            host.classList.add("dropping");
        });
        host.addEventListener("dragleave", function () {
            host.classList.remove("dropping");
        });
        host.addEventListener("drop", function (e) {
            e.preventDefault();
            host.classList.remove("dropping");
            const f = e.dataTransfer.files && e.dataTransfer.files[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = function () {
                importDoc(String(r.result));
            };
            r.readAsText(f);
        });
    }

    function boot() {
        const host = document.getElementById("gameGenerator");
        convoEl = document.getElementById("convo");
        tokenInput = document.getElementById("token");

        Forge.mount({
            host: host,
            hud: document.getElementById("hud"),
            toast: document.getElementById("toast"),
            hotbar: document.getElementById("hotbar"),
            backpack: document.getElementById("backpack"),
        });

        tokenInput.value = localStorage.getItem("forge.orkey") || "";
        tokenInput.addEventListener("change", function () {
            localStorage.setItem("forge.orkey", tokenInput.value.trim());
        });

        const exportBtn = document.getElementById("devExportButton");
        if (exportBtn) exportBtn.addEventListener("click", exportDoc);

        const importBtn = document.getElementById("devImportButton");
        const importFile = document.getElementById("devImportFile");
        if (importBtn && importFile) {
            importBtn.addEventListener("click", function () {
                importFile.click();
            });
            importFile.addEventListener("change", function () {
                const f = importFile.files && importFile.files[0];
                if (!f) return;
                const r = new FileReader();
                r.onload = function () {
                    importDoc(String(r.result));
                };
                r.readAsText(f);
                importFile.value = ""; // let the same file be picked again
            });
        }

        // Clear is destructive, so it arms on the first click and fires on the
        // second — no blocking confirm() dialog, and misclicks are harmless.
        const clearBtn = document.getElementById("devClearButton");
        if (clearBtn) {
            let armed = false;
            let armTimer = null;
            const idle = clearBtn.textContent;
            function disarm() {
                armed = false;
                clearTimeout(armTimer);
                clearBtn.classList.remove("armed");
                clearBtn.textContent = idle;
            }
            clearBtn.addEventListener("click", function () {
                if (!armed) {
                    armed = true;
                    clearBtn.classList.add("armed");
                    clearBtn.textContent = "Sure? click again";
                    armTimer = setTimeout(disarm, 4000);
                    return;
                }
                disarm();
                cancel();
                doc = blankDoc();
                history.length = 0;
                convoEl.innerHTML = "";
                runDoc();
                addMessage("ai", "Cleared. Empty world — describe a new game.");
                Forge.toast("Game cleared");
            });
        }

        const tuneBtn = document.getElementById("devTuneButton");
        if (tuneBtn) {
            tuneBtn.addEventListener("click", function () {
                if (!tunerEl) return;
                const opening = tunerEl.classList.contains("hidden");
                tunerEl.classList.toggle("hidden");
                if (opening) refreshTuner();
            });
        }

        wireDropImport(host);

        loadOverrides();
        buildTuner();

        const restored = load();
        runDoc();

        addMessage(
            "ai",
            restored
                ? "Restored “" + doc.meta.title + "”. Tell me what to change."
                : "Empty world: a ground plane, a camera and your character. " +
                      "Add your OpenRouter key, then describe the game you want — " +
                      "any genre. Ctrl+Enter to send.",
        );

        if (!wireChatbox()) {
            // the slot compiler may render templates after this script runs
            const poll = setInterval(function () {
                if (wireChatbox()) clearInterval(poll);
            }, 120);
            setTimeout(function () {
                clearInterval(poll);
            }, 8000);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }

    global.ForgeEditor = {
        get doc() {
            return doc;
        },
        applyOps: applyOps,
        run: runDoc,
        exportDoc: exportDoc,
        importDoc: importDoc,
        reset: function () {
            doc = blankDoc();
            history.length = 0;
            runDoc();
        },
    };
})(window);
