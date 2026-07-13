// Browser-side WCAG contrast audit.
// Loaded as a raw string and injected via page.addScriptTag to avoid
// esbuild mangling (page.evaluate serializes functions; __name helpers break).
//
// Two-phase API — see packages/cli/src/commands/validate.ts's
// runContrastAudit() for the calling contract:
//
//   1. window.__contrastAuditPrepare() walks the DOM for text-bearing
//      elements, computes each one's foreground paint (CSS `color`, or SVG
//      `fill` for SVG text — fill and color are independent CSS properties
//      in SVG), and HIDES that element's own text paint (color/fill set to
//      transparent). Hiding is layout-neutral — it doesn't reflow anything —
//      so the caller can screenshot the frame right after with the glyphs
//      invisible but everything else unchanged. Returns the candidate list
//      (selector, text, fg, bbox, font metrics).
//   2. Caller takes ONE screenshot (page.screenshot()) — same number of
//      screenshots as before, just moved to after prepare() instead of
//      before it.
//   3. window.__contrastAuditFinish(imgBase64, time, candidates) restores
//      the original paint FIRST (so a slow/failed decode can't leave the
//      page's text stuck invisible), then decodes the screenshot and, for
//      each candidate, samples the real composited pixels directly INSIDE
//      its own bounding box for the true background.
//
// Why sample inside the box instead of the 4px ring just outside it (the
// previous approach): the ring is a proximity heuristic that's wrong
// whenever what's immediately outside the text differs from what's actually
// behind it — a neighboring panel/component just past the text's edge, a
// rounded pill/button whose corner falls inside the ring, a
// backdrop-filter-blurred glass panel sized only a couple pixels larger
// than the text, or a translucent decoration that only partially overlaps
// the ring (or sits entirely inside the bbox, never touching the ring at
// all). Hiding the glyphs and sampling their own box side-steps all of
// that: it reads the exact pixels that were behind them.
//
// window.__contrastAuditRestoreIfPending() is a safety net: if the caller's
// screenshot or finish() call throws between prepare() and finish(), calling
// this restores any still-hidden paint so the next sample in the loop
// doesn't audit a page with stale invisible text. It's a no-op after a
// normal finish() call.
//
// NOTE: this logic (DOM-walk, foreground/paint-hide, background sampling)
// plus the pure WCAG math (relLum, wcagRatio, median) is duplicated in
// skills/hyperframes-creative/scripts/contrast-report.mjs — keep in sync.
// The pure "which rect to sample" decision is also mirrored in
// contrast-sample.ts (unit-tested there since this file can't import).

/* eslint-disable */
window.__contrastAuditPrepare = function () {
  // SVG text (<text>, <tspan>, <textPath>) is painted via the `fill`
  // property, not `color` — the two are independent CSS properties in SVG.
  // A page can set `fill` (inline style, `fill` attribute, or a CSS rule)
  // without ever touching `color`, in which case getComputedStyle(el).color
  // resolves to the inherited/initial value (often black) and does not
  // reflect what's actually rendered on screen.
  function isSvgTextElement(el) {
    return !!el.ownerSVGElement;
  }

  function parseColor(c) {
    var m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0, 1];
    var p = m[1].split(",").map(function (s) {
      return parseFloat(s.trim());
    });
    return [p[0], p[1], p[2], p[3] != null ? p[3] : 1];
  }

  // Like parseColor, but returns null instead of defaulting to black when the
  // value isn't a solid rgb()/rgba() color — e.g. SVG paint keywords such as
  // "none"/"context-fill", or a gradient/pattern reference like
  // 'url("#grad")'. Callers should fall back to another source of truth
  // rather than trust a fabricated black.
  function tryParseSolidColor(c) {
    var m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    var p = m[1].split(",").map(function (s) {
      return parseFloat(s.trim());
    });
    if (
      p.some(function (v) {
        return isNaN(v);
      })
    )
      return null;
    return [p[0], p[1], p[2], p[3] != null ? p[3] : 1];
  }

  function selectorOf(el) {
    if (el.id) return "#" + el.id;
    var cls = Array.from(el.classList).slice(0, 2).join(".");
    return cls ? el.tagName.toLowerCase() + "." + cls : el.tagName.toLowerCase();
  }

  function hasClipPath(el) {
    for (var ce = el; ce; ce = ce.parentElement) {
      var cp = getComputedStyle(ce).clipPath;
      if (cp && cp !== "none") return true;
    }
    return false;
  }

  var CLIP_PROBE_COLS = [0.05, 0.25, 0.5, 0.75, 0.95];
  var CLIP_PROBE_ROWS = [0.25, 0.5, 0.75];

  function paintsAnyProbePoint(el, rect) {
    // Keep probe resolution aligned with layout-audit.browser.js. Edge strips
    // narrower than the nearest probe point are treated as clipped away to
    // avoid noisy typewriter pre-reveal contrast reports.
    for (var ci = 0; ci < CLIP_PROBE_COLS.length; ci++) {
      for (var ri = 0; ri < CLIP_PROBE_ROWS.length; ri++) {
        var x = rect.left + rect.width * CLIP_PROBE_COLS[ci];
        var y = rect.top + rect.height * CLIP_PROBE_ROWS[ri];
        var hit = document.elementFromPoint(x, y);
        if (hit === el || el.contains(hit)) return true;
      }
    }
    return false;
  }

  // A clip-path can shrink an element's painted region to nothing (a typewriter
  // span pre-reveal at `inset(0 100% 0 0)`, or `circle(0px)`) while its box and
  // colours read normally; it then paints zero pixels and measures a meaningless
  // background-on-background ratio. clip-path drives hit-testing, so a fully
  // clipped element is unreachable by elementFromPoint across its box. Probe only
  // when a clip-path is in effect (self or ancestor) so genuinely-occluded but
  // unclipped text is not skipped.
  function isClippedAway(el, rect) {
    if (typeof document.elementFromPoint !== "function") return false;
    if (!hasClipPath(el)) return false;
    return !paintsAnyProbePoint(el, rect);
  }

  function isIntentionallyOccluded(el, rect) {
    if (typeof document.elementFromPoint !== "function") return false;
    if (!el.closest || !el.closest("[data-layout-allow-occlusion]")) return false;
    return !paintsAnyProbePoint(el, rect);
  }

  var out = [];
  var restores = [];
  // Registered BEFORE the walk starts (not after it finishes) and pushed to
  // incrementally as each element is hidden: if getComputedStyle/
  // getBoundingClientRect/etc. throws partway through the walk (e.g. on a
  // detached or otherwise pathological element), everything hidden before
  // the throw is still reachable for restore instead of leaking hidden
  // indefinitely.
  window.__contrastAuditRestores = restores;
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  var node;
  while ((node = walker.nextNode())) {
    var el = node;

    // Must have a direct text node child
    var hasText = false;
    for (var i = 0; i < el.childNodes.length; i++) {
      if (
        el.childNodes[i].nodeType === 3 &&
        (el.childNodes[i].textContent || "").trim().length > 0
      ) {
        hasText = true;
        break;
      }
    }
    if (!hasText) continue;

    // Same decorative opt-out the layout audit honors: text marked (or inside)
    // data-layout-ignore is set dressing, not copy a viewer must read —
    // deliberately dim rail labels, ghost typography, texture text.
    if (el.closest && el.closest("[data-layout-ignore]")) continue;

    // Text that has (nearly) left the canvas — a cursor exiting the frame, an
    // element parked off-screen — is not readable content, and sampling its
    // clamped edge reads whatever pixels happen to sit at the border (the
    // classic false "white-on-white"). Require a minimally-visible on-canvas
    // intersection before judging contrast; the layout audit separately owns
    // off-canvas detection as its own finding class.
    var vis = el.getBoundingClientRect();
    var onX = Math.min(vis.right, window.innerWidth) - Math.max(vis.left, 0);
    var onY = Math.min(vis.bottom, window.innerHeight) - Math.max(vis.top, 0);
    if (onX < 8 || onY < 8) continue;

    var cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    if (parseFloat(cs.opacity) <= 0.01) continue;
    // Also skip when an ANCESTOR is effectively invisible (opacity≈0 / hidden / display:none).
    // Karaoke captions keep every word at opacity 1 but toggle the GROUP's opacity per beat,
    // so an inactive word's OWN opacity is 1 — only an ancestor reveals it's hidden. Without
    // this, the hidden caption words flood the audit with false ~1:1 contrast warnings.
    var anc = el.parentElement,
      ancHidden = false;
    while (anc && anc !== document.body) {
      var acs = getComputedStyle(anc);
      if (
        acs.visibility === "hidden" ||
        acs.display === "none" ||
        parseFloat(acs.opacity) <= 0.01
      ) {
        ancHidden = true;
        break;
      }
      anc = anc.parentElement;
    }
    if (ancHidden) continue;
    var rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) continue;
    if (rect.right <= 0 || rect.bottom <= 0) continue;
    if (isClippedAway(el, rect)) continue;
    // The layout audit's explicit occlusion opt-out means this text is allowed
    // to sit behind another scene. Skip contrast only while every probe point
    // is actually covered; the same copy is audited normally when visible.
    if (isIntentionallyOccluded(el, rect)) continue;

    // For SVG text, `fill` is the paint that's actually rendered; `color` is
    // frequently just the inherited/initial value and unrelated to what's on
    // screen. Only trust `fill` when it resolves to a solid color — "none",
    // "context-fill", and gradient/pattern refs (url(#...)) fall back to
    // `color` rather than crashing parseColor or reporting a fabricated
    // black.
    var isSvgText = isSvgTextElement(el);
    var fg = isSvgText ? tryParseSolidColor(cs.fill) || parseColor(cs.color) : parseColor(cs.color);
    if (fg[3] <= 0.01) continue;

    var fontSize = parseFloat(cs.fontSize);
    var fontWeight = Number(cs.fontWeight) || 400;
    var large = fontSize >= 24 || (fontSize >= 19 && fontWeight >= 700);

    // Hide this element's OWN text paint so the caller's next screenshot
    // reveals the true pixels behind the glyphs. Layout-neutral: color/fill
    // never affect box geometry. `!important` beats any non-!important rule
    // that might otherwise win on specificity; we restore the exact prior
    // inline value (or remove the property entirely) afterward.
    //
    // A `transition` on color/fill would otherwise animate this hide instead
    // of applying it instantly — the caller's screenshot lands in the same
    // task-queue gap as the transition's own frames, so it can catch a
    // partially-transparent (still partly the original color) glyph instead
    // of a fully hidden one, contaminating the background sample. Force
    // `transition: none` alongside color/fill so the hide is atomic, and
    // restore it alongside them.
    var origTransition = el.style.getPropertyValue("transition");
    var origTransitionPriority = el.style.getPropertyPriority("transition");
    el.style.setProperty("transition", "none", "important");
    var origColor = el.style.getPropertyValue("color");
    var origColorPriority = el.style.getPropertyPriority("color");
    el.style.setProperty("color", "transparent", "important");
    var origFill = null,
      origFillPriority = null;
    if (isSvgText) {
      origFill = el.style.getPropertyValue("fill");
      origFillPriority = el.style.getPropertyPriority("fill");
      el.style.setProperty("fill", "transparent", "important");
    }
    restores.push({
      el: el,
      origTransition: origTransition,
      origTransitionPriority: origTransitionPriority,
      origColor: origColor,
      origColorPriority: origColorPriority,
      origFill: origFill,
      origFillPriority: origFillPriority,
      isSvgText: isSvgText,
    });

    out.push({
      selector: selectorOf(el),
      text: (el.textContent || "").trim().slice(0, 50),
      fg: fg,
      fontSize: fontSize,
      fontWeight: fontWeight,
      large: large,
      bbox: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    });
  }

  return out;
};

function __contrastAuditRestoreAll() {
  var restores = window.__contrastAuditRestores;
  if (!restores) return;
  for (var i = 0; i < restores.length; i++) {
    var r = restores[i];
    if (r.origColor) r.el.style.setProperty("color", r.origColor, r.origColorPriority);
    else r.el.style.removeProperty("color");
    if (r.isSvgText) {
      if (r.origFill) r.el.style.setProperty("fill", r.origFill, r.origFillPriority);
      else r.el.style.removeProperty("fill");
    }
    if (r.origTransition)
      r.el.style.setProperty("transition", r.origTransition, r.origTransitionPriority);
    else r.el.style.removeProperty("transition");
  }
  window.__contrastAuditRestores = null;
}

// Safety net for the caller: if the screenshot or finish() call throws
// between prepare() and finish(), call this to restore any still-hidden
// paint so the next sample in the loop isn't auditing a page with stale
// invisible text. No-op if finish() already ran normally.
window.__contrastAuditRestoreIfPending = function () {
  __contrastAuditRestoreAll();
};

window.__contrastAuditFinish = async function (imgBase64, time, candidates) {
  function relLum(r, g, b) {
    function ch(v) {
      var s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  }

  function wcagRatio(r1, g1, b1, r2, g2, b2) {
    var l1 = relLum(r1, g1, b1),
      l2 = relLum(r2, g2, b2);
    var hi = l1 > l2 ? l1 : l2,
      lo = l1 > l2 ? l2 : l1;
    return (hi + 0.05) / (lo + 0.05);
  }

  function median(arr) {
    var s = arr.slice().sort(function (a, b) {
      return a - b;
    });
    return s[Math.floor(s.length / 2)];
  }

  // Restore original paint first — we already have the screenshot, and we
  // never want a decode failure below to leave the page's text invisible.
  __contrastAuditRestoreAll();

  var img = new Image();
  await new Promise(function (resolve) {
    img.onload = resolve;
    img.onerror = function () {
      resolve();
    };
    img.src = "data:image/png;base64," + imgBase64;
  });
  if (!img.naturalWidth) return [];
  var canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || 1920;
  canvas.height = img.naturalHeight || 1080;
  var ctx = canvas.getContext("2d");
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0);
  var px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  var w = canvas.width;
  var h = canvas.height;

  var out = [];
  for (var ci = 0; ci < candidates.length; ci++) {
    var c = candidates[ci];
    var bbox = c.bbox;

    // Sample the element's OWN box (glyphs are hidden in this screenshot),
    // inset 1px on each side to dodge anti-aliased edge pixels, clamped to
    // the canvas. Mirrors contrast-sample.ts's computeSampleRect.
    var x0 = Math.max(0, Math.round(bbox.x) + 1);
    var x1 = Math.min(w - 1, Math.round(bbox.x + bbox.w) - 1);
    var y0 = Math.max(0, Math.round(bbox.y) + 1);
    var y1 = Math.min(h - 1, Math.round(bbox.y + bbox.h) - 1);
    if (x1 <= x0 || y1 <= y0) continue;

    // Bounded grid, not a full scan — dense enough to catch a
    // partially-overlapping decoration without turning a wide caption bar
    // into thousands of samples. Mirrors contrast-sample.ts's
    // sampleGridPoints.
    var stepX = Math.max(1, Math.floor((x1 - x0) / 12));
    var stepY = Math.max(1, Math.floor((y1 - y0) / 6));
    var rr = [],
      gg = [],
      bb = [];
    for (var y = y0; y <= y1; y += stepY) {
      for (var x = x0; x <= x1; x += stepX) {
        var idx = (y * w + x) * 4;
        rr.push(px[idx]);
        gg.push(px[idx + 1]);
        bb.push(px[idx + 2]);
      }
    }
    if (rr.length === 0) continue;

    var bgR = median(rr),
      bgG = median(gg),
      bgB = median(bb);

    // Composite foreground alpha over the measured background
    var fg = c.fg;
    var compR = Math.round(fg[0] * fg[3] + bgR * (1 - fg[3]));
    var compG = Math.round(fg[1] * fg[3] + bgG * (1 - fg[3]));
    var compB = Math.round(fg[2] * fg[3] + bgB * (1 - fg[3]));

    var ratio = +wcagRatio(compR, compG, compB, bgR, bgG, bgB).toFixed(2);

    out.push({
      time: time,
      selector: c.selector,
      text: c.text,
      ratio: ratio,
      wcagAA: c.large ? ratio >= 3 : ratio >= 4.5,
      large: c.large,
      fg: "rgb(" + compR + "," + compG + "," + compB + ")",
      bg: "rgb(" + bgR + "," + bgG + "," + bgB + ")",
    });
  }
  return out;
};
