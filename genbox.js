/* genbox — image generation placeholder
 * plain js, no deps, no build step. pair with genbox.css
 *
 *   const box = new GenBox(document.querySelector('#slot'));
 *   box.progress(0.44, 'denoising · step 12/30');
 *   box.finish('/out/render.png');   // url optional
 *   box.reset();
 *   box.destroy();                   // stops the rAF loop
 *
 * or declaratively — any <div class="genbox" data-genbox> on the page is
 * upgraded on DOMContentLoaded and exposed as element.genbox
 */
(function (global) {
  'use strict';

  var reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- upward progressive blur ---------- */
  function buildBlur(host, layers, max) {
    layers = layers || 7;
    max = max || 34;
    for (var i = 0; i < layers; i++) {
      var d = document.createElement('div');
      var blur = max * Math.pow(i / (layers - 1), 2.2) / (layers * 0.55) + 0.4;
      var a = (i / layers) * 100;
      var b = ((i + 1) / layers) * 100;
      d.style.backdropFilter = d.style.webkitBackdropFilter = 'blur(' + blur.toFixed(2) + 'px)';
      var m = 'linear-gradient(to top, rgba(0,0,0,0) ' + a + '%, #000 ' + b + '%, #000 100%)';
      d.style.maskImage = d.style.webkitMaskImage = m;
      host.appendChild(d);
    }
  }

  /* ---------- warping 3d dot mesh ---------- */
  function Mesh(canvas) {
    var ctx = canvas.getContext('2d');
    var W = 0, H = 0, raf = 0, frozen = false, settle = 1;
    var COLS = 46, ROWS = 26, CAM_Y = 1.05;

    function resize() {
      var dpr = Math.min(devicePixelRatio || 1, 2);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    var ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    function draw(ms) {
      var t = reduceMotion ? 0 : ms * 0.001;
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      var f = H * 0.85, horizon = H * 0.04;

      for (var j = ROWS - 1; j >= 0; j--) {
        var v = j / (ROWS - 1);
        var Z = 0.55 + Math.pow(v, 1.6) * 9.5;
        for (var i = 0; i < COLS; i++) {
          var u = (i / (COLS - 1) - 0.5) * 2;
          var X = u * 4.2;
          var Y = settle * (
              Math.sin(X * 0.75 + t * 0.55) * 0.22 +
              Math.sin(Z * 0.62 - t * 0.42) * 0.26 +
              Math.sin((X + Z) * 0.45 + t * 0.8) * 0.14 +
              Math.sin((X - Z) * 0.9 - t * 0.3) * 0.07);

          var inv = 1 / Z;
          var sx = W / 2 + X * inv * f * 0.55;
          var sy = horizon + (CAM_Y - Y) * inv * f * 0.55;
          if (sx < -14 || sx > W + 14 || sy < -14 || sy > H + 30) continue;

          var depth = Math.min(1, inv * 1.15);
          var lift = (Y + 0.7) / 1.4;
          var a = depth * 0.8 * (0.35 + lift * 0.75) * Math.min(1, (sy - horizon) / (H * 0.24));
          if (a <= 0.012) continue;

          var r = Math.max(0.35, 2.2 * depth * (0.7 + lift * 0.5));
          /* violet on the near edge -> blue -> cyan to the right */
          var hue = 272 - (u * 0.5 + 0.5) * 82 + lift * 10 + v * 8;
          ctx.fillStyle = 'hsla(' + hue + ',92%,' + (58 + lift * 12) + '%,' + a + ')';
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, 6.2832);
          ctx.fill();
        }
      }
      if (!frozen) raf = requestAnimationFrame(draw);
    }

    return {
      start: function () {
        frozen = false; settle = 1;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(draw);
      },
      /* ease the warp flat, then stop the loop */
      calm: function () {
        var t0 = performance.now();
        (function step(now) {
          var k = Math.min(1, (now - t0) / 1400);
          settle = 1 - k * k;
          if (k < 1) requestAnimationFrame(step);
          else { frozen = true; cancelAnimationFrame(raf); }
        })(performance.now());
      },
      destroy: function () {
        frozen = true;
        cancelAnimationFrame(raf);
        ro.disconnect();
      }
    };
  }

  /* ---------- component ---------- */
  function GenBox(target, opts) {
    opts = opts || {};
    var el = target;
    if (!el.classList.contains('genbox')) {
      el = document.createElement('div');
      el.className = 'genbox';
      target.appendChild(el);
    }
    el.innerHTML =
      '<div class="genbox-glow">' +
        '<div class="genbox-blob genbox-b1"></div>' +
        '<div class="genbox-blob genbox-b2"></div>' +
        '<div class="genbox-blob genbox-b3"></div>' +
        '<div class="genbox-blob genbox-b4"></div>' +
        '<div class="genbox-blob genbox-b5"></div>' +
      '</div>' +
      '<canvas class="genbox-mesh"></canvas>' +
      '<div class="genbox-pblur"></div>' +
      '<div class="genbox-rad"></div>' +
      '<div class="genbox-vign"></div>' +
      '<div class="genbox-ring"></div>' +
      '<img class="genbox-shot" alt="">' +
      '<div class="genbox-label">' +
        '<span class="genbox-txt">Generating your image...</span><span class="genbox-pct"></span>' +
      '</div>';

    buildBlur(el.querySelector('.genbox-pblur'), opts.blurLayers, opts.blurMax);
    var mesh = Mesh(el.querySelector('.genbox-mesh'));
    mesh.start();

    var bar = el.querySelector('.genbox-track i');
    var txt = el.querySelector('.genbox-txt');
    var pct = el.querySelector('.genbox-pct');
    var shot = el.querySelector('.genbox-shot');

    this.el = el;

    /* p: 0..1 (or 0..100), label: optional status string */
    this.progress = function (p, label) {
      if (p > 1) p = p / 100;
      p = Math.max(0, Math.min(1, p));
      bar.style.width = (p * 100) + '%';
      pct.textContent = Math.round(p * 100) + '%';
      if (label != null) txt.textContent = label;
      return this;
    };

    this.finish = function (src) {
      if (src) shot.src = src;
      mesh.calm();
      el.classList.add('is-done');
      return this;
    };

    this.reset = function () {
      el.classList.remove('is-done');
      shot.removeAttribute('src');
      bar.style.width = '0%';
      pct.textContent = '';
      txt.textContent = '';
      mesh.start();
      return this;
    };

    this.destroy = function () {
      mesh.destroy();
      el.innerHTML = '';
      delete el.genbox;
    };

    el.genbox = this;
  }

  global.GenBox = GenBox;

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.genbox[data-genbox]').forEach(function (node) {
      new GenBox(node);
    });
  });
})(window);
