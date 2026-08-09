/* ===========================================================================
   ForgeGUI — runtime engine
   ---------------------------------------------------------------------------
   Genre-agnostic. The engine owns rendering, collision, input, camera and HUD;
   it does NOT own gameplay. Games are plain JS modules that call into `Forge`.

   Nothing here assumes a platformer. `Forge.controller.*` are optional helpers
   built on top of the same public API a game module could use directly.
   =========================================================================== */

(function (global) {
    "use strict";

    const THREE = global.THREE;

    /* ═══════════════════════════════════════════════════════════════════
       ART — Roblox blockiness × Fortnite saturation
       ═══════════════════════════════════════════════════════════════════ */

    // 4-step ramp gives chunky cel banding instead of smooth lambert falloff.
    const toonRamp = (function () {
        const steps = new Uint8Array([90, 150, 205, 255]);
        const tex = new THREE.DataTexture(
            steps,
            steps.length,
            1,
            THREE.LuminanceFormat,
        );
        tex.minFilter = THREE.NearestFilter;
        tex.magFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.needsUpdate = true;
        return tex;
    })();

    /* ── occlusion cutout ──────────────────────────────────────────────────
       Punches a screen-space circle around the player through anything BETWEEN
       the camera and the player. Geometry past the player is untouched:

           cam  |  |   player  |  |
                ^^^^            ^^^^
                cut             kept

       Done in the fragment shader (discard) rather than by fading whole
       objects, so a single wall is only holed where it covers the player.     */

    const cutUniforms = {
        uForgeCutEnabled: { value: 0 },
        uForgeCutCenter: { value: new THREE.Vector2() },
        uForgeCutRadius: { value: 90 },
        uForgeCutDepth: { value: 0 },
    };

    // Every engine material shares these uniform OBJECTS, so updating .value
    // once per frame updates all of them.
    function installCutout(material) {
        material.onBeforeCompile = function (shader) {
            Object.assign(shader.uniforms, cutUniforms);
            shader.vertexShader = shader.vertexShader
                .replace(
                    "#include <common>",
                    "#include <common>\nvarying vec3 vForgeViewPos;",
                )
                .replace(
                    "#include <project_vertex>",
                    "#include <project_vertex>\nvForgeViewPos = mvPosition.xyz;",
                );
            shader.fragmentShader = shader.fragmentShader
                .replace(
                    "#include <common>",
                    "#include <common>\n" +
                        "varying vec3 vForgeViewPos;\n" +
                        "uniform float uForgeCutEnabled;\n" +
                        "uniform vec2 uForgeCutCenter;\n" +
                        "uniform float uForgeCutRadius;\n" +
                        "uniform float uForgeCutDepth;",
                )
                .replace(
                    "#include <clipping_planes_fragment>",
                    "#include <clipping_planes_fragment>\n" +
                        "if (uForgeCutEnabled > 0.5 && -vForgeViewPos.z < uForgeCutDepth" +
                        " && distance(gl_FragCoord.xy, uForgeCutCenter) < uForgeCutRadius)" +
                        " discard;",
                );
        };
        // keep three.js from sharing a program with an uninjected material
        material.customProgramCacheKey = function () {
            return "forgeCut";
        };
        return material;
    }

    const matCache = new Map();

    // Accepts 0xrrggbb, "#rrggbb" or "rrggbb" — the model emits all three.
    function col(c, fallback) {
        if (c == null) return fallback == null ? 0xffffff : fallback;
        if (typeof c === "number") return c;
        if (typeof c === "string") {
            const n = parseInt(c.replace(/^[#]|^0x/i, ""), 16);
            return isNaN(n) ? (fallback == null ? 0xffffff : fallback) : n;
        }
        return fallback == null ? 0xffffff : fallback;
    }

    function toon(color, opts) {
        opts = opts || {};
        const c = col(color);
        const key =
            c + "|" + (opts.emissive || 0) + "|" + (opts.intensity || 0) +
            "|" + (opts.opacity != null ? opts.opacity : 1);
        if (matCache.has(key)) return matCache.get(key);
        const m = new THREE.MeshToonMaterial({
            color: c,
            gradientMap: toonRamp,
        });
        if (opts.emissive) {
            m.emissive = new THREE.Color(col(opts.emissive));
            m.emissiveIntensity = opts.intensity || 1;
        }
        if (opts.opacity != null && opts.opacity < 1) {
            m.transparent = true;
            m.opacity = opts.opacity;
        }
        installCutout(m);
        matCache.set(key, m);
        return m;
    }

    const outlineMat = installCutout(
        new THREE.MeshBasicMaterial({
            color: 0x0b0b12,
            side: THREE.BackSide,
        }),
    );

    // Inverted-hull outline — cheap, and it's what sells the stylised look.
    function outline(mesh, thickness) {
        const p = mesh.geometry.parameters || {};
        const t = thickness == null ? 0.055 : thickness;
        const o = new THREE.Mesh(mesh.geometry, outlineMat);
        o.scale.set(
            1 + (t * 2) / Math.max(p.width || 1, 0.001),
            1 + (t * 2) / Math.max(p.height || 1, 0.001),
            1 + (t * 2) / Math.max(p.depth || 1, 0.001),
        );
        o.userData.isOutline = true;
        mesh.add(o);
        return mesh;
    }

    function makeBox(w, h, d, color, opts) {
        const m = new THREE.Mesh(
            new THREE.BoxGeometry(w, h, d),
            toon(color, opts),
        );
        m.castShadow = true;
        m.receiveShadow = true;
        if (!opts || opts.outline !== false) outline(m, opts && opts.outlineWidth);
        return m;
    }

    /* ── Character rig ───────────────────────────────────────────────────
       Roblox proportions (boxy torso, detached limbs, oversized head) crossed
       with a VRChat robot (visor face, glowing core, ball joints, antenna).
       4.6 units tall, feet at y = 0.                                       */

    function makeCharacter(opts) {
        opts = opts || {};
        const primary = col(opts.primary, 0x3fa9f5);
        const accent = col(opts.accent, 0xff7a3d);
        const shell = col(opts.shell, 0xe8ecf2);
        const glow = col(opts.glow, 0x67f5d2);

        const root = new THREE.Group();
        const rig = {};

        const torso = makeBox(1.35, 1.6, 0.78, primary);
        torso.position.y = 2.5;
        root.add(torso);

        const chestPlate = makeBox(0.95, 0.85, 0.1, shell, { outline: false });
        chestPlate.position.set(0, 0.2, 0.42);
        torso.add(chestPlate);

        const core = makeBox(0.3, 0.3, 0.14, glow, {
            emissive: glow,
            intensity: 1.4,
            outline: false,
        });
        core.position.set(0, 0.2, 0.48);
        torso.add(core);
        rig.core = core;

        const belt = makeBox(1.42, 0.22, 0.85, accent, { outline: false });
        belt.position.y = -0.68;
        torso.add(belt);

        const headPivot = new THREE.Group();
        headPivot.position.y = 3.5;
        root.add(headPivot);
        rig.head = headPivot;

        const head = makeBox(1.15, 1.05, 1.05, shell);
        headPivot.add(head);

        const visor = makeBox(1.0, 0.42, 0.12, 0x14161f, { outline: false });
        visor.position.set(0, 0.05, 0.52);
        head.add(visor);

        const eyeL = makeBox(0.2, 0.2, 0.06, glow, {
            emissive: glow,
            intensity: 2,
            outline: false,
        });
        eyeL.position.set(-0.24, 0.05, 0.58);
        head.add(eyeL);
        const eyeR = eyeL.clone();
        eyeR.position.x = 0.24;
        head.add(eyeR);

        const jaw = makeBox(0.6, 0.16, 0.9, primary, { outline: false });
        jaw.position.set(0, -0.5, 0);
        head.add(jaw);

        const antenna = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.05, 0.55, 6),
            toon(0x2b2f3a),
        );
        antenna.position.set(0.34, 0.75, 0);
        head.add(antenna);
        const bulb = new THREE.Mesh(
            new THREE.SphereGeometry(0.11, 10, 8),
            toon(accent, { emissive: accent, intensity: 1.6 }),
        );
        bulb.position.y = 0.3;
        antenna.add(bulb);

        // limb pivots sit at the joint so rotation.x swings correctly
        function limb(x, y, w, h, d, c) {
            const pivot = new THREE.Group();
            pivot.position.set(x, y, 0);
            root.add(pivot);

            const ball = new THREE.Mesh(
                new THREE.SphereGeometry(w * 0.55, 10, 8),
                toon(0x2b2f3a),
            );
            pivot.add(ball);

            const seg = makeBox(w, h, d, c, { outlineWidth: 0.045 });
            seg.position.y = -h / 2 - 0.08;
            pivot.add(seg);

            const cuff = makeBox(w * 1.12, 0.2, d * 1.12, accent, {
                outline: false,
            });
            cuff.position.y = -h * 0.42;
            seg.add(cuff);

            // Grip point at the end of the limb — held items mount here, so
            // they inherit the limb's swing for free.
            const hand = new THREE.Group();
            hand.position.set(0, -h / 2, 0);
            seg.add(hand);
            pivot.userData.hand = hand;

            return pivot;
        }

        rig.armL = limb(-0.92, 3.05, 0.44, 1.5, 0.44, shell);
        rig.armR = limb(0.92, 3.05, 0.44, 1.5, 0.44, shell);
        rig.legL = limb(-0.36, 1.62, 0.5, 1.55, 0.5, primary);
        rig.legR = limb(0.36, 1.62, 0.5, 1.55, 0.5, primary);
        rig.handL = rig.armL.userData.hand;
        rig.handR = rig.armR.userData.hand;

        root.traverse(function (o) {
            if (o.isMesh && !o.userData.isOutline) {
                o.castShadow = true;
                o.receiveShadow = true;
            }
        });

        root.userData.rig = rig;
        root.userData.height = 4.6;
        root.userData.width = 1.24;
        return root;
    }

    /* ═══════════════════════════════════════════════════════════════════
       ENGINE STATE
       ═══════════════════════════════════════════════════════════════════ */

    let renderer = null;
    let canvasEl = null;
    let hostEl = null;
    let hudEl = null;
    let toastEl = null;

    const DEFAULT_CLICK_DISTANCE = 24;

    const rt = {
        scene: null,
        colliders: [],
        triggers: [],
        bodies: [],
        updates: [],
        starts: [],
        clickables: [],
        started: false,
        time: 0,
        bounds: null,
    };

    // Playable volume. Bodies are clamped inside it and anything that falls
    // below minY is treated as out of the world.
    function defaultBounds() {
        return {
            minX: -400,
            maxX: 400,
            minZ: -400,
            maxZ: 400,
            minY: -80,
            maxY: 600,
            onExit: null,
        };
    }

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 6000);

    const camState = {
        mode: "thirdPerson",
        target: null,
        offsetY: 3.45,
        dist: 16.84,
        yaw: 0.6,
        pitch: 0.35,
        minPitch: -0.25,
        maxPitch: 1.15,
        minDist: 1,
        maxDist: 400,
        lookAt: new THREE.Vector3(),
        position: new THREE.Vector3(),
        smooth: 9,
        allowDrag: true,
        allowZoom: true,
        collide: true, // glide the boom in rather than clip through geometry
        collisionPad: 1.2,
        collideIn: 9, // how fast the boom shortens (units/s of lerp rate)
        collideOut: 2.5, // …and how fast it eases back out
        // How far the boom may auto-shorten from the requested distance. Zoomed
        // in, this is more than the whole range, so the camera solves occlusion
        // by moving. Zoomed out, a wall would demand a huge pull-in, which reads
        // as the camera lurching — so it refuses past this delta and lets the
        // cutout carve the occluder instead.
        maxPullIn: 28,
        boom: 18, // current smoothed boom length
        cutout: true, // see-through hole around the player
        cutoutRadius: null, // null = auto-fit to the character's screen size
        cutoutScale: 1.25, // multiplier on the auto-fitted radius
        cutoutBias: 1.6, // never cut the player's own body
        cutoutFade: 8, // how fast the hole opens/closes
        _cutT: 0, // 0..1, driven by whether line of sight is actually broken
    };

    /* ── input ─────────────────────────────────────────────────────────── */

    /* Middle-drag orbits the camera. It is deliberately handled outside the
       public `input` object so games — and therefore the AI — cannot read or
       bind the middle button; the camera owns it unconditionally. */
    const camDrag = { active: false, dx: 0, dy: 0 };

    const input = {
        keys: Object.create(null),
        _pressed: Object.create(null),
        _consumed: Object.create(null),
        // x/y start negative to mean "pointer hasn't entered the viewport yet"
        // `down`/`dx`/`dy` describe the LEFT button only.
        pointer: { down: false, dx: 0, dy: 0, x: -1, y: -1 },
        wheel: 0,
        click: false, // left press+release inside the viewport

        down: function (code) {
            return !!this.keys[code];
        },
        // true on the frame the viewport was clicked (not dragged)
        clicked: function () {
            return this.click;
        },
        // true only on the frame the key went down
        pressed: function (code) {
            return !!this._pressed[code];
        },
        // WASD / arrows as a normalised 2-vector: x = strafe, y = forward
        axis2: function () {
            let x = 0,
                y = 0;
            if (this.keys.KeyW || this.keys.ArrowUp) y -= 1;
            if (this.keys.KeyS || this.keys.ArrowDown) y += 1;
            if (this.keys.KeyA || this.keys.ArrowLeft) x -= 1;
            if (this.keys.KeyD || this.keys.ArrowRight) x += 1;
            const l = Math.hypot(x, y);
            if (l > 0.0001) {
                x /= l;
                y /= l;
            }
            return { x: x, y: y, active: l > 0.0001 };
        },
    };

    function bindInput(canvas) {
        global.addEventListener("keydown", function (e) {
            if (e.target && e.target.matches && e.target.matches("input, textarea"))
                return;
            if (!input.keys[e.code]) input._pressed[e.code] = true;
            input.keys[e.code] = true;
            if (e.code === "Space") e.preventDefault();
        });
        global.addEventListener("keyup", function (e) {
            input.keys[e.code] = false;
        });
        global.addEventListener("blur", function () {
            input.keys = Object.create(null);
        });

        // Middle button (1) → camera orbit. Left button (0) → gameplay.
        let camLx = 0,
            camLy = 0,
            leftLx = 0,
            leftLy = 0;

        function releaseIfIdle(e) {
            if (camDrag.active || input.pointer.down) return;
            if (e && e.pointerId != null) {
                try {
                    canvas.releasePointerCapture(e.pointerId);
                } catch (err) {}
            }
        }

        canvas.addEventListener("pointerdown", function (e) {
            if (e.button === 1) {
                camDrag.active = true;
                camLx = e.clientX;
                camLy = e.clientY;
                canvas.classList.add("dragging");
                canvas.setPointerCapture(e.pointerId);
            } else if (e.button === 0) {
                input.pointer.down = true;
                leftLx = e.clientX;
                leftLy = e.clientY;
                canvas.setPointerCapture(e.pointerId);
            }
        });

        canvas.addEventListener("pointermove", function (e) {
            input.pointer.x = e.clientX;
            input.pointer.y = e.clientY;
            if (camDrag.active) {
                camDrag.dx += e.clientX - camLx;
                camDrag.dy += e.clientY - camLy;
                camLx = e.clientX;
                camLy = e.clientY;
            }
            if (input.pointer.down) {
                input.pointer.dx += e.clientX - leftLx;
                input.pointer.dy += e.clientY - leftLy;
                leftLx = e.clientX;
                leftLy = e.clientY;
            }
        });

        canvas.addEventListener("pointerup", function (e) {
            if (e.button === 1) {
                camDrag.active = false;
                canvas.classList.remove("dragging");
            } else if (e.button === 0 && input.pointer.down) {
                input.pointer.down = false;
                // Left no longer orbits, so any press+release is a real click —
                // no drag threshold needed.
                input.click = true;
            }
            releaseIfIdle(e);
        });

        canvas.addEventListener("pointercancel", function (e) {
            camDrag.active = false;
            input.pointer.down = false;
            canvas.classList.remove("dragging");
            releaseIfIdle(e);
        });

        canvas.addEventListener("pointerleave", function () {
            // drop hover state so the cursor doesn't stick when leaving the view
            input.pointer.x = -1;
            input.pointer.y = -1;
        });

        // Stop the browser's middle-click autoscroll from hijacking the orbit.
        canvas.addEventListener("mousedown", function (e) {
            if (e.button === 1) e.preventDefault();
        });
        canvas.addEventListener("auxclick", function (e) {
            if (e.button === 1) e.preventDefault();
        });
        canvas.addEventListener(
            "wheel",
            function (e) {
                e.preventDefault();
                input.wheel += e.deltaY;
            },
            { passive: false },
        );
    }

    function endInputFrame() {
        input._pressed = Object.create(null);
        input.pointer.dx = 0;
        input.pointer.dy = 0;
        input.wheel = 0;
        input.click = false;
        camDrag.dx = 0;
        camDrag.dy = 0;
    }

    /* ── collision ─────────────────────────────────────────────────────── */

    function colliderFor(obj, opts) {
        opts = opts || {};
        let w = opts.w,
            h = opts.h,
            d = opts.d;
        if (w == null || h == null || d == null) {
            const p = (obj.geometry && obj.geometry.parameters) || {};
            const s = obj.scale;
            w = w != null ? w : (p.width || 1) * s.x;
            h = h != null ? h : (p.height || 1) * s.y;
            d = d != null ? d : (p.depth || 1) * s.z;
        }
        const c = {
            obj: obj,
            w: w,
            h: h,
            d: d,
            tag: opts.tag || null,
            min: new THREE.Vector3(),
            max: new THREE.Vector3(),
        };
        syncCollider(c);
        return c;
    }

    const _wp = new THREE.Vector3();
    function syncCollider(c) {
        // Must refresh matrices ourselves: solid() is usually called before the
        // first render, so matrixWorld would otherwise still be identity and
        // every collider would land at the origin.
        let p;
        if (c.obj.parent) {
            c.obj.updateWorldMatrix(true, false);
            p = c.obj.getWorldPosition(_wp);
        } else {
            p = c.obj.position;
        }
        c.min.set(p.x - c.w / 2, p.y - c.h / 2, p.z - c.d / 2);
        c.max.set(p.x + c.w / 2, p.y + c.h / 2, p.z + c.d / 2);
    }

    function overlap(aMin, aMax, bMin, bMax) {
        return (
            aMin.x < bMax.x &&
            aMax.x > bMin.x &&
            aMin.y < bMax.y &&
            aMax.y > bMin.y &&
            aMin.z < bMax.z &&
            aMax.z > bMin.z
        );
    }

    /* ── clickable objects ─────────────────────────────────────────────────
       Roblox ClickDetector semantics: an object is only clickable while the
       player is within a max activation distance of the point they clicked.
       Occlusion counts — a wall between you and the target blocks the click. */

    const raycaster = new THREE.Raycaster();
    const ndc = { x: 0, y: 0 };
    let hovered = null; // {rec, inRange}

    function clickableFor(obj) {
        let o = obj;
        while (o) {
            if (o.userData && o.userData.__clickable) return o.userData.__clickable;
            o = o.parent;
        }
        return null;
    }

    // The reference point distance is measured from: the player's mid-height if
    // there's a body, otherwise the camera.
    function clickOrigin(out) {
        const b = rt.bodies[0];
        if (b) return out.set(b.pos.x, b.pos.y + b.height * 0.5, b.pos.z);
        return out.copy(camera.position);
    }

    const _origin = new THREE.Vector3();

    function pickClickable() {
        if (!rt.clickables.length || !canvasEl) return null;
        if (input.pointer.x < 0) return null; // pointer hasn't entered yet

        const rect = canvasEl.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        ndc.x = ((input.pointer.x - rect.left) / rect.width) * 2 - 1;
        ndc.y = -((input.pointer.y - rect.top) / rect.height) * 2 + 1;
        if (ndc.x < -1 || ndc.x > 1 || ndc.y < -1 || ndc.y > 1) return null;

        raycaster.setFromCamera(ndc, camera);
        const hits = raycaster.intersectObjects(rt.scene.children, true);

        for (let i = 0; i < hits.length; i++) {
            const h = hits[i];
            const o = h.object;
            // Ink outlines and the sky dome are visual only — they must not
            // swallow a click or falsely occlude what's behind them.
            if (o.userData && (o.userData.isOutline || o.userData.isSky)) continue;
            if (o.visible === false) continue;

            const rec = clickableFor(o);
            if (!rec || !rec.enabled) return null; // something solid is in the way

            const limit =
                rec.distance != null ? rec.distance : Forge.clickDistance;
            clickOrigin(_origin);
            const d = _origin.distanceTo(h.point);
            return { rec: rec, hit: h, dist: d, inRange: d <= limit };
        }
        return null;
    }

    function stepClickables() {
        const pick = pickClickable();

        // hover feedback: pointer when reachable, not-allowed when too far
        const prev = hovered && hovered.rec;
        const next = pick && pick.rec;
        if (canvasEl) {
            canvasEl.classList.toggle("hover-click", !!(pick && pick.inRange));
            canvasEl.classList.toggle("hover-far", !!(pick && !pick.inRange));
        }
        if (prev !== next || (hovered && pick && hovered.inRange !== pick.inRange)) {
            if (prev && prev.onHover) {
                try {
                    prev.onHover(false, prev.obj);
                } catch (err) {
                    console.error("[Forge] onHover threw:", err);
                }
            }
            if (next && next.onHover) {
                try {
                    next.onHover(true, next.obj, pick.inRange);
                } catch (err) {
                    console.error("[Forge] onHover threw:", err);
                }
            }
        }
        hovered = pick;

        if (!input.click || !pick) return false;

        if (!pick.inRange) {
            if (pick.rec.onTooFar) {
                try {
                    pick.rec.onTooFar(pick.rec.obj, pick.dist);
                } catch (err) {
                    console.error("[Forge] onTooFar threw:", err);
                }
            } else {
                toast("Too far away");
            }
            return true; // still consumes the click
        }

        try {
            if (pick.rec.onClick) pick.rec.onClick(pick.rec.obj, pick.hit);
        } catch (err) {
            console.error("[Forge] onClick threw:", err);
        }
        return true;
    }

    /* ── physics body ──────────────────────────────────────────────────── */

    function makeBody(obj, opts) {
        opts = opts || {};
        const b = {
            obj: obj,
            pos: new THREE.Vector3(),
            vel: new THREE.Vector3(),
            width: opts.width != null ? opts.width : (obj.userData.width || 1.2),
            height: opts.height != null ? opts.height : (obj.userData.height || 4.6),
            gravity: opts.gravity != null ? opts.gravity : -55,
            grounded: false,
            enabled: true,
            spawn: new THREE.Vector3(),
            // null = fall through to the world bounds' minY
            fallLimit: opts.fallLimit != null ? opts.fallLimit : null,
            bounded: opts.bounded !== false,
            onFall: opts.onFall || null,
            _min: new THREE.Vector3(),
            _max: new THREE.Vector3(),
        };
        const s = opts.spawn || [0, 3, 0];
        b.spawn.set(s[0] || 0, s[1] != null ? s[1] : 3, s[2] || 0);
        b.pos.copy(b.spawn);

        b.refreshBox = function () {
            const hw = b.width / 2;
            b._min.set(b.pos.x - hw, b.pos.y, b.pos.z - hw);
            b._max.set(b.pos.x + hw, b.pos.y + b.height, b.pos.z + hw);
        };

        // Per-axis sweep: move one axis, push out of whatever we hit, repeat.
        // Cheap and stable for an all-AABB world.
        b.moveAxis = function (axis, amount) {
            if (!amount) return;
            b.pos[axis] += amount;
            b.refreshBox();
            for (let i = 0; i < rt.colliders.length; i++) {
                const c = rt.colliders[i];
                if (!overlap(b._min, b._max, c.min, c.max)) continue;
                if (amount > 0) b.pos[axis] -= b._max[axis] - c.min[axis];
                else b.pos[axis] += c.max[axis] - b._min[axis];
                if (axis === "y") {
                    if (amount < 0) b.grounded = true;
                    b.vel.y = 0;
                }
                b.refreshBox();
            }
        };

        b.respawn = function () {
            b.pos.copy(b.spawn);
            b.vel.set(0, 0, 0);
            b.grounded = false;
            if (b.obj) b.obj.position.copy(b.pos);
        };

        b.step = function (dt) {
            if (!b.enabled) return;
            b.vel.y += b.gravity * dt;
            b.grounded = false;
            b.moveAxis("x", b.vel.x * dt);
            b.moveAxis("z", b.vel.z * dt);
            b.moveAxis("y", b.vel.y * dt);

            // keep the body inside the playable volume
            const bd = rt.bounds;
            if (bd && b.bounded !== false) {
                const hw = b.width / 2;
                if (b.pos.x - hw < bd.minX) {
                    b.pos.x = bd.minX + hw;
                    b.vel.x = 0;
                } else if (b.pos.x + hw > bd.maxX) {
                    b.pos.x = bd.maxX - hw;
                    b.vel.x = 0;
                }
                if (b.pos.z - hw < bd.minZ) {
                    b.pos.z = bd.minZ + hw;
                    b.vel.z = 0;
                } else if (b.pos.z + hw > bd.maxZ) {
                    b.pos.z = bd.maxZ - hw;
                    b.vel.z = 0;
                }
                if (b.pos.y + b.height > bd.maxY) {
                    b.pos.y = bd.maxY - b.height;
                    if (b.vel.y > 0) b.vel.y = 0;
                }
            }

            const floor = b.fallLimit != null ? b.fallLimit : bd ? bd.minY : -80;
            if (b.pos.y < floor) {
                if (bd && bd.onExit) {
                    try {
                        bd.onExit(b);
                    } catch (err) {
                        console.error("[Forge] bounds.onExit threw:", err);
                    }
                } else if (b.onFall) b.onFall(b);
                else b.respawn();
            }
            if (b.obj) b.obj.position.copy(b.pos);
        };

        b.setSpawn = function (x, y, z) {
            b.spawn.set(x, y, z);
        };

        rt.bodies.push(b);
        return b;
    }

    /* ── controller handles ────────────────────────────────────────────────
       Every controller returns a handle rather than a bare body, so a later
       module can freeze it, swap its movement logic, or detach it entirely
       without the module that created it knowing. This is what makes the
       default player controller overridable instead of baked in.            */

    function makeHandle(obj, body, defaultStep) {
        const h = {
            obj: obj,
            body: body,
            enabled: true,
            animate: true,
            _step: defaultStep,
            _default: defaultStep,
        };

        h._tick = function (dt, t) {
            if (!h.enabled) return;
            h._step(dt, t, h);
        };

        // Replace the movement logic, keeping the body, camera and rig.
        h.override = function (fn) {
            h._step = fn || function () {};
            return h;
        };
        // Go back to the controller's built-in behaviour.
        h.restore = function () {
            h._step = h._default;
            return h;
        };
        // Remove the controller entirely (body included).
        h.detach = function () {
            Forge.offUpdate(h._tick);
            rt.bodies = rt.bodies.filter(function (b) {
                return b !== body;
            });
            return h;
        };

        rt.updates.push(h._tick);
        return h;
    }

    /* Drives the character rig's walk cycle. Exposed so a custom controller
       still gets the animation without reimplementing it. */
    function animateRig(obj, o) {
        const rig = obj && obj.userData && obj.userData.rig;
        if (!rig) return;
        o = o || {};
        const t = o.t != null ? o.t : rt.time;
        const rate = o.rate != null ? o.rate : 11;
        const swing = o.moving && o.grounded !== false
            ? Math.sin(t * rate) * (o.amount != null ? o.amount : 0.85)
            : 0;

        rig.legL.rotation.x = swing;
        rig.legR.rotation.x = -swing;
        rig.armL.rotation.x = -swing * 0.8;
        rig.armR.rotation.x = swing * 0.8;
        rig.head.rotation.y = Math.sin(t * 1.3) * 0.08;
        if (rig.core)
            rig.core.material.emissiveIntensity = 1.1 + Math.sin(t * 4) * 0.35;
        if (o.grounded === false) {
            rig.armL.rotation.x = -1.1;
            rig.armR.rotation.x = -1.1;
        }
    }

    /* ── camera ────────────────────────────────────────────────────────── */

    /* Slab test: distance along `dir` from `origin` to an AABB, or Infinity.
       Used to pull the camera in so it never ends up inside geometry. */
    function rayAABB(origin, dir, min, max) {
        let tmin = 0;
        let tmax = Infinity;
        const o = [origin.x, origin.y, origin.z];
        const d = [dir.x, dir.y, dir.z];
        const lo = [min.x, min.y, min.z];
        const hi = [max.x, max.y, max.z];
        for (let i = 0; i < 3; i++) {
            if (Math.abs(d[i]) < 1e-8) {
                if (o[i] < lo[i] || o[i] > hi[i]) return Infinity;
            } else {
                const inv = 1 / d[i];
                let t1 = (lo[i] - o[i]) * inv;
                let t2 = (hi[i] - o[i]) * inv;
                if (t1 > t2) {
                    const t = t1;
                    t1 = t2;
                    t2 = t;
                }
                if (t1 > tmin) tmin = t1;
                if (t2 < tmax) tmax = t2;
                if (tmin > tmax) return Infinity;
            }
        }
        return tmin;
    }

    const _camDir = new THREE.Vector3();
    const _camPad = new THREE.Vector3();

    // Shorten the boom until nothing solid sits between the look target and
    // the camera. `pad` keeps the near plane off the surface.
    function clampBoom(target, desired, wanted) {
        _camDir.subVectors(desired, target);
        const len = _camDir.length();
        if (len < 1e-6) return wanted;
        _camDir.multiplyScalar(1 / len);

        let best = wanted;
        const pad = camState.collisionPad;
        for (let i = 0; i < rt.colliders.length; i++) {
            const c = rt.colliders[i];
            // inflate the box by the pad so the camera stops short of it
            _camPad.set(pad, pad, pad);
            const t = rayAABB(
                target,
                _camDir,
                { x: c.min.x - pad, y: c.min.y - pad, z: c.min.z - pad },
                { x: c.max.x + pad, y: c.max.y + pad, z: c.max.z + pad },
            );
            if (t < best) best = t;
        }
        return Math.max(camState.minDist, best);
    }

    const _cutView = new THREE.Vector3();
    const _cutProj = new THREE.Vector3();
    const _losDir = new THREE.Vector3();
    const _bufSize = new THREE.Vector2();

    /* Is the character's line of sight to the camera actually broken?
       Samples knees / chest / head so partial occlusion counts. Only solid
       colliders block — decorative geometry is never treated as an occluder. */
    const LOS_SAMPLES = [0.35, 0.62, 0.9];

    function isOccluded(target) {
        const h = (target.userData && target.userData.height) || 4.6;
        for (let s = 0; s < LOS_SAMPLES.length; s++) {
            _losDir.set(
                target.position.x,
                target.position.y + h * LOS_SAMPLES[s],
                target.position.z,
            );
            _losDir.sub(camera.position);
            const dist = _losDir.length();
            if (dist < 1e-4) continue;
            _losDir.multiplyScalar(1 / dist);
            for (let i = 0; i < rt.colliders.length; i++) {
                const c = rt.colliders[i];
                const t = rayAABB(camera.position, _losDir, c.min, c.max);
                // -0.4 so the surface the player is standing on doesn't count
                if (t < dist - 0.4) return true;
            }
        }
        return false;
    }

    function updateCutout(dt) {
        const t = camState.target;
        if (!camState.cutout || !t || !renderer) {
            camState._cutT = 0;
            cutUniforms.uForgeCutEnabled.value = 0;
            return;
        }

        // Only open the hole when something genuinely breaks line of sight —
        // geometry that is merely in front of the player, without covering it,
        // must not be cut. Eased so it doesn't pop on and off.
        const want = isOccluded(t) ? 1 : 0;
        const k = Math.min(1, dt * camState.cutoutFade);
        camState._cutT += (want - camState._cutT) * k;
        if (camState._cutT < 0.02) {
            cutUniforms.uForgeCutEnabled.value = 0;
            return;
        }

        const h = (t.userData && t.userData.height) || 4.6;
        _cutView.set(t.position.x, t.position.y + h * 0.5, t.position.z);

        // depth of the player along the view axis; anything nearer gets cut
        _cutProj.copy(_cutView).applyMatrix4(camera.matrixWorldInverse);
        const depth = -_cutProj.z - camState.cutoutBias;
        if (depth <= 0) {
            cutUniforms.uForgeCutEnabled.value = 0;
            return;
        }

        // gl_FragCoord is in drawing-buffer pixels, so project into those
        const size = renderer.getDrawingBufferSize(_bufSize);
        _cutProj.copy(_cutView).project(camera);
        cutUniforms.uForgeCutCenter.value.set(
            (_cutProj.x * 0.5 + 0.5) * size.x,
            (_cutProj.y * 0.5 + 0.5) * size.y,
        );

        let radius;
        if (camState.cutoutRadius != null) {
            radius = camState.cutoutRadius * size.y;
        } else {
            // Fit the circle to the character's on-screen size so it hugs the
            // silhouette instead of holing a fixed lump out of the scene.
            const halfFov = (camera.fov * Math.PI) / 360;
            const worldRadius = h * 0.55;
            radius =
                (worldRadius / (depth * Math.tan(halfFov))) *
                (size.y / 2) *
                camState.cutoutScale;
        }

        cutUniforms.uForgeCutRadius.value = radius * camState._cutT;
        cutUniforms.uForgeCutDepth.value = depth;
        cutUniforms.uForgeCutEnabled.value = 1;
    }

    function stepCamera(dt) {
        if (camState.allowDrag && camDrag.active) {
            camState.yaw -= camDrag.dx * 0.005;
            camState.pitch = Math.max(
                camState.minPitch,
                Math.min(camState.maxPitch, camState.pitch + camDrag.dy * 0.004),
            );
        }
        if (camState.allowZoom && input.wheel) {
            const before = camState.dist;
            camState.dist = Math.max(
                camState.minDist,
                Math.min(camState.maxDist, camState.dist + input.wheel * 0.02),
            );
            // Carry the zoom straight into the live boom so scrolling stays 1:1;
            // only wall avoidance is allowed to ease it.
            camState.boom = Math.max(
                camState.minDist,
                camState.boom + (camState.dist - before),
            );
        }

        const t = camState.target;
        const tp = t
            ? t.position
            : camState.lookAt;

        switch (camState.mode) {
            case "fixed":
                camera.position.copy(camState.position);
                camera.lookAt(camState.lookAt);
                return;

            case "firstPerson": {
                if (!t) return;
                camera.position.set(
                    tp.x,
                    tp.y + camState.offsetY,
                    tp.z,
                );
                const cp = Math.cos(camState.pitch);
                camera.lookAt(
                    tp.x - Math.sin(camState.yaw) * cp * 10,
                    tp.y + camState.offsetY - Math.sin(camState.pitch) * 10,
                    tp.z - Math.cos(camState.yaw) * cp * 10,
                );
                return;
            }

            case "topDown": {
                if (!t) return;
                const desired = new THREE.Vector3(
                    tp.x,
                    tp.y + camState.dist,
                    tp.z + camState.dist * 0.45,
                );
                camera.position.lerp(desired, Math.min(1, dt * camState.smooth));
                camera.lookAt(tp.x, tp.y, tp.z);
                return;
            }

            case "thirdPerson":
            default: {
                if (!t) return;
                camState.lookAt.set(tp.x, tp.y + camState.offsetY, tp.z);
                const cp = Math.cos(camState.pitch);
                const desired = _camDesired.set(
                    camState.lookAt.x + Math.sin(camState.yaw) * camState.dist * cp,
                    camState.lookAt.y + Math.sin(camState.pitch) * camState.dist + 2,
                    camState.lookAt.z + Math.cos(camState.yaw) * camState.dist * cp,
                );

                const wanted = desired.distanceTo(camState.lookAt);
                if (camState.collide) {
                    // Glide the boom toward whatever length is currently clear
                    // instead of snapping — pulls in briskly, eases back out.
                    let allowed = clampBoom(camState.lookAt, desired, wanted);

                    // Cap how far it will auto-shorten. Past that we'd rather
                    // keep the framing and let the cutout handle the occluder.
                    const floor = Math.max(
                        camState.minDist,
                        wanted - camState.maxPullIn,
                    );
                    if (allowed < floor) allowed = floor;

                    const rate =
                        allowed < camState.boom
                            ? camState.collideIn
                            : camState.collideOut;
                    camState.boom +=
                        (allowed - camState.boom) * Math.min(1, dt * rate);
                    desired
                        .sub(camState.lookAt)
                        .setLength(camState.boom)
                        .add(camState.lookAt);
                } else {
                    camState.boom = wanted;
                }

                camera.position.lerp(desired, Math.min(1, dt * camState.smooth));
                camera.lookAt(camState.lookAt);
                return;
            }
        }
    }

    const _camDesired = new THREE.Vector3();

    /* ── HUD ───────────────────────────────────────────────────────────── */

    const hud = {
        _title: "Untitled",
        _objective: "",
        _stats: [],
        _hint: "",

        title: function (t, objective) {
            if (t != null) hud._title = t;
            if (objective != null) hud._objective = objective;
            hud.render();
        },
        stat: function (label, value) {
            const found = hud._stats.find(function (s) {
                return s.label === label;
            });
            if (found) found.value = value;
            else hud._stats.push({ label: label, value: value });
            hud.render();
        },
        removeStat: function (label) {
            hud._stats = hud._stats.filter(function (s) {
                return s.label !== label;
            });
            hud.render();
        },
        hint: function (text) {
            hud._hint = text || "";
            hud.render();
        },
        clear: function () {
            hud._stats = [];
            hud._hint = "";
            hud.render();
        },
        render: function () {
            if (!hudEl) return;
            let html = "<fg-hudtitle>" + esc(hud._title) + "</fg-hudtitle>";
            if (hud._objective)
                html += "<fg-hudrow>" + esc(hud._objective) + "</fg-hudrow>";
            for (let i = 0; i < hud._stats.length; i++) {
                const s = hud._stats[i];
                html +=
                    "<fg-hudrow>" +
                    esc(s.label) +
                    " <b>" +
                    esc(String(s.value)) +
                    "</b></fg-hudrow>";
            }
            html +=
                "<fg-hudkeys>" +
                (hud._hint
                    ? esc(hud._hint)
                    : "WASD move · Space jump · Middle-drag orbit · Scroll zoom") +
                "</fg-hudkeys>";
            hudEl.innerHTML = html;
        },
    };

    function esc(s) {
        return String(s).replace(/[&<>]/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
        });
    }

    /* ═══════════════════════════════════════════════════════════════════
       INVENTORY — Roblox-style hotbar + backpack with an equipped slot
       ═══════════════════════════════════════════════════════════════════ */

    const HOTBAR_SLOTS = 9;

    const inv = {
        defs: Object.create(null),
        slots: new Array(HOTBAR_SLOTS).fill(null), // [{id, count}|null]
        bag: [], // overflow beyond the hotbar
        equipped: null, // {id, index, mesh, def}
        holder: null, // character the item mounts on
        listeners: [],
        backpackOpen: false,
    };

    function itemDef(id) {
        return inv.defs[id] || null;
    }

    function invChanged() {
        renderHotbar();
        for (let i = 0; i < inv.listeners.length; i++) {
            try {
                inv.listeners[i](inventory);
            } catch (err) {
                console.error("[Forge] inventory listener threw:", err);
            }
        }
    }

    function findStack(id) {
        for (let i = 0; i < inv.slots.length; i++)
            if (inv.slots[i] && inv.slots[i].id === id)
                return { list: inv.slots, index: i };
        for (let i = 0; i < inv.bag.length; i++)
            if (inv.bag[i].id === id) return { list: inv.bag, index: i };
        return null;
    }

    function holderObj() {
        if (inv.holder) return inv.holder;
        const b = rt.bodies[0];
        return b ? b.obj : null;
    }

    // Build the held mesh and mount it to the character's hand.
    function mountEquipped() {
        const eq = inv.equipped;
        if (!eq) return;
        const def = eq.def;
        let mesh = null;
        try {
            mesh = def.model
                ? def.model()
                : makeBox(0.35, 1.1, 0.35, def.color != null ? def.color : 0xffd23f);
        } catch (err) {
            console.error("[Forge] item model threw:", err);
            return;
        }
        if (!mesh) return;

        const hold = def.hold || {};
        if (hold.pos) mesh.position.set(hold.pos[0], hold.pos[1], hold.pos[2]);
        else mesh.position.set(0, -0.4, 0.1);
        if (hold.rot) mesh.rotation.set(hold.rot[0], hold.rot[1], hold.rot[2]);
        if (hold.scale) mesh.scale.setScalar(hold.scale);

        const obj = holderObj();
        const rig = obj && obj.userData && obj.userData.rig;
        const anchor = rig ? rig[def.handedness === "left" ? "handL" : "handR"] : obj;
        if (anchor) anchor.add(mesh);
        else if (rt.scene) rt.scene.add(mesh);
        eq.mesh = mesh;
    }

    function unmountEquipped() {
        const eq = inv.equipped;
        if (eq && eq.mesh && eq.mesh.parent) eq.mesh.parent.remove(eq.mesh);
        if (eq) eq.mesh = null;
    }

    function callItem(hook, eq, a, b) {
        if (!eq || !eq.def || !eq.def[hook]) return;
        try {
            eq.def[hook](
                {
                    id: eq.id,
                    def: eq.def,
                    mesh: eq.mesh,
                    character: holderObj(),
                    body: rt.bodies[0] || null,
                    inventory: inventory,
                },
                a,
                b,
            );
        } catch (err) {
            console.error("[Forge] item." + hook + " threw:", err);
        }
    }

    const inventory = {
        get slots() {
            return inv.slots;
        },
        get bag() {
            return inv.bag;
        },
        get equipped() {
            return inv.equipped ? inv.equipped.id : null;
        },

        // Which character holds items. Defaults to the first body's object.
        holder: function (obj) {
            inv.holder = obj;
            if (inv.equipped) {
                unmountEquipped();
                mountEquipped();
            }
        },

        give: function (id, count) {
            const def = itemDef(id);
            if (!def) {
                console.warn("[Forge] give('" + id + "'): item not defined");
                return false;
            }
            count = count == null ? 1 : count;

            if (def.stackable) {
                const found = findStack(id);
                if (found) {
                    found.list[found.index].count += count;
                    invChanged();
                    return true;
                }
            }
            for (let i = 0; i < inv.slots.length; i++) {
                if (!inv.slots[i]) {
                    inv.slots[i] = { id: id, count: count };
                    invChanged();
                    return true;
                }
            }
            inv.bag.push({ id: id, count: count });
            invChanged();
            return true;
        },

        take: function (id, count) {
            count = count == null ? 1 : count;
            const found = findStack(id);
            if (!found) return false;
            const stack = found.list[found.index];
            stack.count -= count;
            if (stack.count <= 0) {
                if (inv.equipped && inv.equipped.id === id) inventory.unequip();
                if (found.list === inv.slots) inv.slots[found.index] = null;
                else inv.bag.splice(found.index, 1);
            }
            invChanged();
            return true;
        },

        has: function (id, count) {
            return inventory.count(id) >= (count == null ? 1 : count);
        },
        count: function (id) {
            const f = findStack(id);
            return f ? f.list[f.index].count : 0;
        },

        // Equip by item id or by zero-based hotbar index.
        equip: function (which) {
            let index = -1;
            let id = null;
            if (typeof which === "number") {
                index = which;
                id = inv.slots[index] ? inv.slots[index].id : null;
            } else {
                id = which;
                for (let i = 0; i < inv.slots.length; i++)
                    if (inv.slots[i] && inv.slots[i].id === id) index = i;
            }
            if (!id) return false;
            const def = itemDef(id);
            if (!def) return false;
            if (inv.equipped && inv.equipped.id === id) return true;

            inventory.unequip();
            inv.equipped = { id: id, index: index, def: def, mesh: null };
            mountEquipped();
            callItem("onEquip", inv.equipped);
            invChanged();
            return true;
        },

        unequip: function () {
            if (!inv.equipped) return false;
            callItem("onUnequip", inv.equipped);
            unmountEquipped();
            inv.equipped = null;
            invChanged();
            return true;
        },

        // Fire the equipped item's onActivate (what a click does).
        activate: function () {
            if (!inv.equipped) return false;
            callItem("onActivate", inv.equipped);
            return true;
        },

        clear: function () {
            inventory.unequip();
            inv.slots = new Array(HOTBAR_SLOTS).fill(null);
            inv.bag = [];
            invChanged();
        },

        onChange: function (fn) {
            inv.listeners.push(fn);
            return fn;
        },

        openBackpack: function (open) {
            inv.backpackOpen = open == null ? !inv.backpackOpen : !!open;
            renderHotbar();
        },
    };

    const item = {
        define: function (id, def) {
            inv.defs[id] = Object.assign({ name: id }, def || {});
            return inv.defs[id];
        },
        get: itemDef,
        defined: function (id) {
            return !!inv.defs[id];
        },
    };

    /* ── hotbar / backpack DOM ─────────────────────────────────────────── */

    let hotbarEl = null;
    let backpackEl = null;

    function slotHtml(stack, i, equipped) {
        if (!stack)
            return (
                '<fg-itemslot' +
                ' class="empty"><fg-itemkey>' +
                (i + 1) +
                "</fg-itemkey></fg-itemslot>"
            );
        const def = itemDef(stack.id) || { name: stack.id };
        const face = def.icon
            ? '<fg-itemface class="emoji">' + esc(def.icon) + "</fg-itemface>"
            : '<fg-itemface style="background:' +
              hexCss(def.color != null ? def.color : 0xffd23f) +
              '"></fg-itemface>';
        return (
            '<fg-itemslot data-slot="' +
            i +
            '" class="' +
            (equipped ? "equipped" : "") +
            '" title="' +
            esc(def.name) +
            '">' +
            "<fg-itemkey>" +
            (i + 1) +
            "</fg-itemkey>" +
            face +
            "<fg-itemlabel>" +
            esc(def.name) +
            "</fg-itemlabel>" +
            (stack.count > 1 ? "<fg-itemcount>" + stack.count + "</fg-itemcount>" : "") +
            "</fg-itemslot>"
        );
    }

    function hexCss(n) {
        return "#" + ("000000" + (n >>> 0).toString(16)).slice(-6);
    }

    function renderHotbar() {
        if (!hotbarEl) return;

        // hide the bar entirely until the game actually gives the player something
        const any =
            inv.slots.some(function (s) {
                return !!s;
            }) || inv.bag.length > 0;
        hotbarEl.classList.toggle("hidden", !any);

        let html = "";
        for (let i = 0; i < inv.slots.length; i++) {
            const s = inv.slots[i];
            html += slotHtml(
                s,
                i,
                !!(inv.equipped && s && inv.equipped.index === i),
            );
        }
        if (inv.bag.length) {
            html +=
                '<fg-bagbutton title="Backpack (B)">🎒<fg-itemcount>' +
                inv.bag.length +
                "</fg-itemcount></fg-bagbutton>";
        }
        hotbarEl.innerHTML = html;

        if (backpackEl) {
            backpackEl.classList.toggle(
                "hidden",
                !inv.backpackOpen || !inv.bag.length,
            );
            if (inv.backpackOpen) {
                let bh = "<fg-bagtitle>Backpack</fg-bagtitle><fg-baggrid>";
                for (let i = 0; i < inv.bag.length; i++) {
                    const st = inv.bag[i];
                    const def = itemDef(st.id) || { name: st.id };
                    bh +=
                        '<fg-itemslot data-bag="' +
                        i +
                        '">' +
                        (def.icon
                            ? '<fg-itemface class="emoji">' + esc(def.icon) + "</fg-itemface>"
                            : '<fg-itemface style="background:' +
                              hexCss(def.color != null ? def.color : 0xffd23f) +
                              '"></fg-itemface>') +
                        "<fg-itemlabel>" +
                        esc(def.name) +
                        "</fg-itemlabel>" +
                        (st.count > 1 ? "<fg-itemcount>" + st.count + "</fg-itemcount>" : "") +
                        "</fg-itemslot>";
                }
                backpackEl.innerHTML = bh + "</fg-baggrid>";
            }
        }
    }

    function bindInventoryUI() {
        if (hotbarEl) {
            hotbarEl.addEventListener("click", function (e) {
                const bag = e.target.closest && e.target.closest("fg-bagbutton");
                if (bag) {
                    inventory.openBackpack();
                    return;
                }
                const s = e.target.closest && e.target.closest("fg-itemslot[data-slot]");
                if (!s) return;
                const i = parseInt(s.getAttribute("data-slot"), 10);
                if (inv.equipped && inv.equipped.index === i) inventory.unequip();
                else inventory.equip(i);
            });
        }
        if (backpackEl) {
            backpackEl.addEventListener("click", function (e) {
                const s = e.target.closest && e.target.closest("fg-itemslot[data-bag]");
                if (!s) return;
                const i = parseInt(s.getAttribute("data-bag"), 10);
                const st = inv.bag[i];
                if (!st) return;
                // swap into the first free hotbar slot, then equip it
                for (let k = 0; k < inv.slots.length; k++) {
                    if (!inv.slots[k]) {
                        inv.slots[k] = st;
                        inv.bag.splice(i, 1);
                        inventory.equip(k);
                        invChanged();
                        return;
                    }
                }
                Forge.toast("Hotbar is full", true);
            });
        }
    }

    // Number keys equip, B toggles the backpack, click activates.
    function stepInventory(dt, t) {
        for (let i = 0; i < HOTBAR_SLOTS; i++) {
            if (input.pressed("Digit" + (i + 1))) {
                if (inv.equipped && inv.equipped.index === i) inventory.unequip();
                else inventory.equip(i);
            }
        }
        if (input.pressed("KeyB")) inventory.openBackpack();
        if (input.click && inv.equipped) inventory.activate();
        if (inv.equipped) callItem("onUpdate", inv.equipped, dt, t);
    }

    function resetInventory() {
        unmountEquipped();
        inv.defs = Object.create(null);
        inv.slots = new Array(HOTBAR_SLOTS).fill(null);
        inv.bag = [];
        inv.equipped = null;
        inv.holder = null;
        inv.listeners = [];
        inv.backpackOpen = false;
        renderHotbar();
    }

    let toastTimer = null;
    function toast(text, isError) {
        if (!toastEl) return;
        toastEl.textContent = text;
        toastEl.classList.toggle("error", !!isError);
        toastEl.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(
            function () {
                toastEl.classList.remove("show");
            },
            isError ? 7000 : 2600,
        );
    }

    /* ═══════════════════════════════════════════════════════════════════
       PUBLIC API
       ═══════════════════════════════════════════════════════════════════ */

    const Forge = {
        THREE: THREE,
        camera: camera,
        input: input,
        hud: hud,
        toast: toast,
        state: {},
        item: item,
        inventory: inventory,

        get scene() {
            return rt.scene;
        },
        get time() {
            return rt.time;
        },

        /* -- scene graph -- */
        add: function (obj) {
            rt.scene.add(obj);
            return obj;
        },
        remove: function (obj) {
            if (obj && obj.parent) obj.parent.remove(obj);
            Forge.unsolid(obj);
            return obj;
        },

        /* -- art -- */
        art: {
            toon: toon,
            outline: outline,
            box: makeBox,
            character: makeCharacter,
            color: col,
        },

        /* -- environment -- */
        sky: function (o) {
            o = o || {};
            const top = new THREE.Color(col(o.top, 0x5fc9ff));
            const bottom = new THREE.Color(col(o.bottom, 0xffe3b8));
            const mat = new THREE.ShaderMaterial({
                side: THREE.BackSide,
                depthWrite: false,
                uniforms: { top: { value: top }, bottom: { value: bottom } },
                vertexShader:
                    "varying float vH;void main(){vH=normalize(position).y;" +
                    "gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
                fragmentShader:
                    "uniform vec3 top;uniform vec3 bottom;varying float vH;" +
                    "void main(){gl_FragColor=vec4(mix(bottom,top,smoothstep(-0.15,0.65,vH)),1.0);}",
            });
            const dome = new THREE.Mesh(new THREE.SphereGeometry(2400, 24, 16), mat);
            dome.userData.isSky = true; // never blocks or absorbs a click
            rt.scene.add(dome);
            if (o.fog !== false) {
                rt.scene.fog = new THREE.Fog(
                    col(o.fog, bottom.getHex()),
                    o.fogNear != null ? o.fogNear : 160,
                    o.fogFar != null ? o.fogFar : 1100,
                );
            }
            return dome;
        },

        sun: function (o) {
            o = o || {};
            rt.scene.add(
                new THREE.HemisphereLight(
                    col(o.sky, 0xbfe6ff),
                    col(o.ground, 0x53406a),
                    o.ambient != null ? o.ambient : 0.9,
                ),
            );
            const dir = new THREE.DirectionalLight(
                col(o.color, 0xfff2d5),
                o.intensity != null ? o.intensity : 1.25,
            );
            dir.position.set(60, 110, 45);
            dir.castShadow = true;
            dir.shadow.mapSize.set(2048, 2048);
            const s = o.shadowRange || 150;
            dir.shadow.camera.left = -s;
            dir.shadow.camera.right = s;
            dir.shadow.camera.top = s;
            dir.shadow.camera.bottom = -s;
            dir.shadow.camera.far = 500;
            dir.shadow.bias = -0.0009;
            rt.scene.add(dir);
            rt.scene.add(dir.target);
            return dir;
        },

        /* -- collision -- */
        solid: function (obj, opts) {
            const c = colliderFor(obj, opts);
            rt.colliders.push(c);
            obj.userData.collider = c;
            return c;
        },
        unsolid: function (obj) {
            if (!obj) return;
            rt.colliders = rt.colliders.filter(function (c) {
                return c.obj !== obj;
            });
        },
        // Re-derive an AABB after moving/scaling an object.
        syncSolid: function (obj) {
            if (obj && obj.userData.collider) syncCollider(obj.userData.collider);
        },
        /* Max distance (world units) a click can reach by default. Games can
           raise/lower it globally, or per object via {distance}. */
        clickDistance: DEFAULT_CLICK_DISTANCE,

        /* The playable volume. Bodies are clamped inside it; falling below
           minY counts as leaving the world. Call with no args to read it.
             Forge.bounds({ size: 250 })                  // square, centred
             Forge.bounds({ minX:-100, maxX:100, ... })   // explicit
             Forge.bounds({ size: 250, minY: -40, onExit: fn }) */
        bounds: function (o) {
            if (o === undefined) return rt.bounds;
            if (o === null) {
                rt.bounds = null;
                return null;
            }
            const b = rt.bounds || defaultBounds();
            if (o.size != null) {
                const half = o.size / 2;
                const cx = o.x || 0;
                const cz = o.z || 0;
                b.minX = cx - half;
                b.maxX = cx + half;
                b.minZ = cz - half;
                b.maxZ = cz + half;
            }
            ["minX", "maxX", "minZ", "maxZ", "minY", "maxY"].forEach(function (k) {
                if (o[k] != null) b[k] = o[k];
            });
            if (o.onExit !== undefined) b.onExit = o.onExit;
            rt.bounds = b;
            return b;
        },

        /* Make an object clickable. Returns a handle; the click only fires if
           the player is within range AND nothing opaque is in the way. */
        clickable: function (obj, opts) {
            opts = opts || {};
            const rec = {
                obj: obj,
                onClick: opts.onClick || null,
                onHover: opts.onHover || null,
                onTooFar: opts.onTooFar || null,
                distance: opts.distance != null ? opts.distance : null,
                enabled: opts.enabled !== false,
            };
            rec.remove = function () {
                Forge.unclickable(obj);
            };
            obj.userData.__clickable = rec;
            rt.clickables.push(rec);
            return rec;
        },
        unclickable: function (obj) {
            if (!obj) return;
            if (obj.userData) delete obj.userData.__clickable;
            rt.clickables = rt.clickables.filter(function (r) {
                return r.obj !== obj;
            });
            if (hovered && hovered.rec && hovered.rec.obj === obj) hovered = null;
        },

        trigger: function (obj, opts) {
            opts = opts || {};
            const t = {
                obj: obj,
                radius: opts.radius != null ? opts.radius : 3,
                once: opts.once !== false,
                fired: false,
                onEnter: opts.onEnter || null,
                watch: opts.watch || null, // body to test against; default first
            };
            rt.triggers.push(t);
            return t;
        },
        raycast: function (origin, direction, maxDist) {
            const rc = new THREE.Raycaster(origin, direction.clone().normalize(), 0,
                maxDist || 1000);
            return rc.intersectObjects(rt.scene.children, true);
        },

        /* -- physics -- */
        body: makeBody,

        /* -- camera control -- */
        cam: {
            thirdPerson: function (target, o) {
                o = o || {};
                camState.mode = "thirdPerson";
                camState.target = target;
                if (o.offsetY != null) camState.offsetY = o.offsetY;
                else if (target && target.userData.height)
                    camState.offsetY = target.userData.height * 0.75;
                if (o.dist != null) camState.dist = o.dist;
                camState.boom = camState.dist;
                camState.allowDrag = o.allowDrag !== false;
                camState.allowZoom = o.allowZoom !== false;
            },
            topDown: function (target, o) {
                o = o || {};
                camState.mode = "topDown";
                camState.target = target;
                camState.dist = o.height != null ? o.height : 40;
                camState.allowZoom = o.allowZoom !== false;
                camState.allowDrag = false;
            },
            firstPerson: function (target, o) {
                o = o || {};
                camState.mode = "firstPerson";
                camState.target = target;
                camState.offsetY = o.eyeHeight != null ? o.eyeHeight : 3.9;
                camState.allowDrag = true;
                camState.allowZoom = false;
            },
            fixed: function (pos, lookAt) {
                camState.mode = "fixed";
                camState.position.set(pos[0], pos[1], pos[2]);
                camState.lookAt.set(lookAt[0], lookAt[1], lookAt[2]);
                camState.allowDrag = false;
                camState.allowZoom = false;
            },
            set: function (o) {
                Object.assign(camState, o || {});
            },
            /* Camera-vs-geometry avoidance. The boom glides shorter when the
               view is blocked and eases back out when it clears.
               {enabled, pad, minDist, inSpeed, outSpeed} */
            collision: function (o) {
                o = o || {};
                if (o.enabled != null) camState.collide = !!o.enabled;
                if (o.pad != null) camState.collisionPad = o.pad;
                if (o.minDist != null) camState.minDist = o.minDist;
                if (o.inSpeed != null) camState.collideIn = o.inSpeed;
                if (o.outSpeed != null) camState.collideOut = o.outSpeed;
                if (o.maxPullIn != null) camState.maxPullIn = o.maxPullIn;
            },
            /* The see-through hole around the player. It only opens when
               something actually breaks line of sight.
               {enabled, scale, radius, bias, fade}
                 scale  — multiplier on the auto-fitted silhouette radius
                 radius — fixed fraction of viewport height; overrides auto-fit */
            cutout: function (o) {
                o = o || {};
                if (o.enabled != null) camState.cutout = !!o.enabled;
                if (o.radius !== undefined) camState.cutoutRadius = o.radius;
                if (o.scale != null) camState.cutoutScale = o.scale;
                if (o.bias != null) camState.cutoutBias = o.bias;
                if (o.fade != null) camState.cutoutFade = o.fade;
            },
            get yaw() {
                return camState.yaw;
            },
            set yaw(v) {
                camState.yaw = v;
            },
            get pitch() {
                return camState.pitch;
            },
            set pitch(v) {
                camState.pitch = v;
            },
            get dist() {
                return camState.dist;
            },
            set dist(v) {
                camState.dist = v;
            },
            // Camera-relative basis. Forward points AWAY from the camera.
            forward: function () {
                return { x: -Math.sin(camState.yaw), z: -Math.cos(camState.yaw) };
            },
            right: function () {
                return { x: Math.cos(camState.yaw), z: -Math.sin(camState.yaw) };
            },
        },

        /* -- optional controllers (helpers, not requirements) --
           Each returns a HANDLE: { obj, body, enabled, animate,
                                    override(fn), restore(), detach() }
           `handle.body` is the physics body if you only want that.          */
        controller: {
            /* Third-person platformer: camera-relative WASD, jump, rig animation. */
            platformer: function (obj, o) {
                o = o || {};
                const body = makeBody(obj, o);
                const speed = o.speed != null ? o.speed : 17;
                const sprintMul = o.sprint != null ? o.sprint : 1.75;
                const jump = o.jump != null ? o.jump : 20;
                let yaw = 0;

                return makeHandle(obj, body, function (dt, t, h) {
                    const ax = input.axis2();
                    const sprinting =
                        input.down("ShiftLeft") || input.down("ShiftRight");
                    const spd = speed * (sprinting ? sprintMul : 1);

                    // Movement is relative to where the camera looks.
                    const f = Forge.cam.forward();
                    const r = Forge.cam.right();
                    const dx = r.x * ax.x + f.x * -ax.y;
                    const dz = r.z * ax.x + f.z * -ax.y;

                    body.vel.x = dx * spd;
                    body.vel.z = dz * spd;

                    if (body.grounded && input.down("Space")) body.vel.y = jump;

                    if (ax.active) {
                        const target = Math.atan2(dx, dz);
                        let diff = target - yaw;
                        while (diff > Math.PI) diff -= Math.PI * 2;
                        while (diff < -Math.PI) diff += Math.PI * 2;
                        yaw += diff * Math.min(1, dt * 14);
                        obj.rotation.y = yaw;
                    }

                    if (h.animate) {
                        animateRig(obj, {
                            t: t,
                            moving: ax.active,
                            grounded: body.grounded,
                            rate: 11 * (sprinting ? sprintMul : 1),
                        });
                    }
                });
            },

            /* Top-down / twin-stick: no gravity, world-axis movement. */
            topDown: function (obj, o) {
                o = o || {};
                const body = makeBody(obj, Object.assign({ gravity: 0 }, o));
                const speed = o.speed != null ? o.speed : 22;
                return makeHandle(obj, body, function (dt, t, h) {
                    const ax = input.axis2();
                    body.vel.x = ax.x * speed;
                    body.vel.z = ax.y * speed;
                    if (ax.active) obj.rotation.y = Math.atan2(ax.x, ax.y);
                    if (h.animate)
                        animateRig(obj, { t: t, moving: ax.active, grounded: true });
                });
            },

            /* Free-fly / spectator / flight games. */
            flyer: function (obj, o) {
                o = o || {};
                const body = makeBody(obj, Object.assign({ gravity: 0 }, o));
                const speed = o.speed != null ? o.speed : 30;
                return makeHandle(obj, body, function () {
                    const ax = input.axis2();
                    const f = Forge.cam.forward();
                    const r = Forge.cam.right();
                    body.vel.x = (r.x * ax.x + f.x * -ax.y) * speed;
                    body.vel.z = (r.z * ax.x + f.z * -ax.y) * speed;
                    body.vel.y =
                        (input.down("Space") ? 1 : 0) * speed -
                        (input.down("ShiftLeft") ? 1 : 0) * speed;
                });
            },

            /* Nothing built in — you write the whole movement step.
               opts.update(dt, t, handle) runs every frame. */
            custom: function (obj, o) {
                o = o || {};
                const body = makeBody(obj, o);
                return makeHandle(obj, body, o.update || function () {});
            },
        },

        /* Drive the character walk cycle from a custom controller. */
        animateRig: animateRig,

        /* -- lifecycle hooks -- */
        onUpdate: function (fn) {
            rt.updates.push(fn);
            return fn;
        },
        offUpdate: function (fn) {
            rt.updates = rt.updates.filter(function (f) {
                return f !== fn;
            });
        },
        onStart: function (fn) {
            rt.starts.push(fn);
            return fn;
        },

        /* -- utils -- */
        rand: function (a, b) {
            return a + Math.random() * (b - a);
        },
        randInt: function (a, b) {
            return Math.floor(a + Math.random() * (b - a + 1));
        },
        pick: function (arr) {
            return arr[Math.floor(Math.random() * arr.length)];
        },
        clamp: function (v, a, b) {
            return Math.max(a, Math.min(b, v));
        },
        lerp: function (a, b, t) {
            return a + (b - a) * t;
        },
        dist2d: function (a, b) {
            return Math.hypot(a.x - b.x, a.z - b.z);
        },
    };

    /* ═══════════════════════════════════════════════════════════════════
       TUNING — schema for the dev panel. Declared here so the UI can be
       generated from it rather than duplicating the list of knobs.
       ═══════════════════════════════════════════════════════════════════ */

    function camKnob(group, key, label, min, max, step, type) {
        return {
            group: group,
            key: key,
            label: label,
            min: min,
            max: max,
            step: step,
            type: type || "number",
            get: function () {
                return camState[key];
            },
            set: function (v) {
                camState[key] = v;
                // dist and the live boom must not drift apart or the next
                // frame snaps the camera back to the old length
                if (key === "dist") camState.boom = v;
            },
        };
    }

    const TUNABLES = [
        camKnob("Camera", "dist", "Distance", 1, 140, 0.02),
        camKnob("Camera", "minDist", "Min distance", 0.5, 40, 0.5),
        camKnob("Camera", "maxDist", "Max distance", 10, 800, 5),
        camKnob("Camera", "offsetY", "Look height", 0, 14, 0.1),
        camKnob("Camera", "smooth", "Follow smoothing", 1, 30, 0.5),

        camKnob("Collision", "collide", "Enabled", 0, 1, 1, "bool"),
        camKnob("Collision", "maxPullIn", "Max auto pull-in", 0, 140, 1),
        camKnob("Collision", "collisionPad", "Wall padding", 0, 6, 0.1),
        camKnob("Collision", "collideIn", "Pull-in speed", 0.5, 30, 0.5),
        camKnob("Collision", "collideOut", "Ease-out speed", 0.2, 30, 0.1),

        camKnob("Cutout", "cutout", "Enabled", 0, 1, 1, "bool"),
        camKnob("Cutout", "cutoutScale", "Size scale", 0.2, 4, 0.05),
        camKnob("Cutout", "cutoutRadius", "Fixed radius", 0.02, 1, 0.01, "auto"),
        camKnob("Cutout", "cutoutBias", "Depth bias", 0, 8, 0.1),
        camKnob("Cutout", "cutoutFade", "Fade speed", 0.5, 40, 0.5),

        {
            group: "World",
            key: "clickDistance",
            label: "Click reach",
            min: 2,
            max: 200,
            step: 1,
            type: "number",
            get: function () {
                return Forge.clickDistance;
            },
            set: function (v) {
                Forge.clickDistance = v;
            },
        },
    ];

    const tuning = {
        list: TUNABLES,
        find: function (key) {
            for (let i = 0; i < TUNABLES.length; i++)
                if (TUNABLES[i].key === key) return TUNABLES[i];
            return null;
        },
        get: function (key) {
            const t = tuning.find(key);
            return t ? t.get() : undefined;
        },
        set: function (key, value) {
            const t = tuning.find(key);
            if (t) t.set(value);
        },
        // current values of everything, for display or export
        snapshot: function () {
            const out = {};
            for (let i = 0; i < TUNABLES.length; i++)
                out[TUNABLES[i].key] = TUNABLES[i].get();
            return out;
        },
        // re-apply a saved set (used after a game reload wipes camState)
        apply: function (obj) {
            if (!obj) return;
            Object.keys(obj).forEach(function (k) {
                if (obj[k] !== undefined) tuning.set(k, obj[k]);
            });
        },
    };

    /* ═══════════════════════════════════════════════════════════════════
       HOST — mount, reset, run modules, frame loop
       ═══════════════════════════════════════════════════════════════════ */

    const clock = new THREE.Clock();

    function mount(opts) {
        hostEl = opts.host;
        hudEl = opts.hud;
        toastEl = opts.toast;
        hotbarEl = opts.hotbar || null;
        backpackEl = opts.backpack || null;
        bindInventoryUI();

        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
        renderer.outputEncoding = THREE.sRGBEncoding;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        canvasEl = renderer.domElement;
        hostEl.insertBefore(canvasEl, hostEl.firstChild);

        bindInput(canvasEl);

        // Size off the host box, never off window.innerWidth — this keeps the
        // canvas locked to mainView through sidebar collapses and layout shifts.
        function resize() {
            const w = hostEl.clientWidth;
            const h = hostEl.clientHeight;
            if (!w || !h) return;
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        }
        new ResizeObserver(resize).observe(hostEl);
        global.addEventListener("resize", resize);
        resize();

        reset();
        requestAnimationFrame(frame);
    }

    function reset() {
        if (rt.scene) {
            rt.scene.traverse(function (o) {
                if (o.isMesh && o.geometry && !o.userData.isOutline) {
                    o.geometry.dispose();
                }
            });
        }
        rt.scene = new THREE.Scene();
        rt.colliders = [];
        rt.triggers = [];
        rt.bodies = [];
        rt.updates = [];
        rt.starts = [];
        rt.clickables = [];
        rt.started = false;
        rt.time = 0;
        hovered = null;
        if (canvasEl) canvasEl.classList.remove("hover-click", "hover-far");

        rt.bounds = defaultBounds();

        Forge.state = {};
        Forge.clickDistance = DEFAULT_CLICK_DISTANCE;
        resetInventory();
        camState.mode = "thirdPerson";
        camState.target = null;
        camState.dist = 16.84;
        camState.minDist = 1;
        camState.maxDist = 400;
        camState.offsetY = 3.45;
        camState.smooth = 9;
        camState.yaw = 0.6;
        camState.pitch = 0.35;
        camState.allowDrag = true;
        camState.allowZoom = true;
        camState.collide = true;
        camState.collisionPad = 1.2;
        camState.collideIn = 9;
        camState.collideOut = 2.5;
        camState.maxPullIn = 28;
        camState.boom = camState.dist;
        camState.cutout = true;
        camState.cutoutRadius = null;
        camState.cutoutScale = 1.25;
        camState.cutoutBias = 1.6;
        camState.cutoutFade = 8;
        camState._cutT = 0;
        cutUniforms.uForgeCutEnabled.value = 0;

        hud._title = "Untitled";
        hud._objective = "";
        hud._stats = [];
        hud._hint = "";
        hud.render();
    }

    /* Runs a whole game document: reset, then execute each module in order.
       Returns {ok, errors:[{module, message}]}. A failing module does not stop
       the others — a broken enemy script shouldn't blank the world. */
    function run(doc) {
        reset();
        const errors = [];
        const order = doc.order && doc.order.length
            ? doc.order
            : Object.keys(doc.modules || {});

        for (let i = 0; i < order.length; i++) {
            const name = order[i];
            const src = doc.modules ? doc.modules[name] : null;
            if (src == null) continue;
            try {
                new Function("Forge", "THREE", '"use strict";\n' + src)(Forge, THREE);
            } catch (err) {
                console.error("[Forge] module '" + name + "' failed:", err);
                errors.push({ module: name, message: String(err && err.message || err) });
            }
        }

        for (let i = 0; i < rt.starts.length; i++) {
            try {
                rt.starts[i]();
            } catch (err) {
                console.error("[Forge] onStart threw:", err);
                errors.push({ module: "onStart", message: String(err.message || err) });
            }
        }
        rt.started = true;
        return { ok: errors.length === 0, errors: errors };
    }

    function frame() {
        requestAnimationFrame(frame);
        const dt = Math.min(clock.getDelta(), 0.05);
        rt.time += dt;
        if (!rt.scene) return;

        // Snapshot: a hook may detach itself or another controller mid-frame,
        // which reassigns rt.updates and would otherwise shift live indices.
        const ups = rt.updates.slice();
        for (let i = 0; i < ups.length; i++) {
            try {
                ups[i](dt, rt.time);
            } catch (err) {
                console.error("[Forge] onUpdate threw:", err);
            }
        }

        for (let i = 0; i < rt.bodies.length; i++) rt.bodies[i].step(dt);

        // triggers test against the first body by default (usually the player)
        const watcher = rt.bodies[0];
        if (watcher) {
            for (let i = 0; i < rt.triggers.length; i++) {
                const tg = rt.triggers[i];
                if (tg.fired && tg.once) continue;
                if (!tg.obj || !tg.obj.visible) continue;
                const b = tg.watch || watcher;
                const p = tg.obj.position;
                const d = Math.hypot(
                    p.x - b.pos.x,
                    p.y - (b.pos.y + b.height * 0.5),
                    p.z - b.pos.z,
                );
                if (d < tg.radius) {
                    tg.fired = true;
                    try {
                        if (tg.onEnter) tg.onEnter(tg.obj, b);
                    } catch (err) {
                        console.error("[Forge] trigger threw:", err);
                    }
                }
            }
        }

        // Clicking a world object consumes the click, so it doesn't also
        // activate whatever item the player happens to be holding.
        if (stepClickables()) input.click = false;

        stepInventory(dt, rt.time);
        stepCamera(dt);

        // The cutout is computed from the camera's final pose, so it must run
        // after stepCamera and before the draw.
        camera.updateMatrixWorld();
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
        updateCutout(dt);

        endInputFrame();
        renderer.render(rt.scene, camera);
    }

    Forge.mount = mount;
    Forge.run = run;
    Forge.reset = reset;
    Forge.tuning = tuning;
    Forge._rt = rt;

    global.Forge = Forge;
})(window);
