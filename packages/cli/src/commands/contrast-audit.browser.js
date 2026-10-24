// Browser-side WCAG contrast audit, injected as a raw string so esbuild can't mangle it.
// __contrastAuditPrepare() hides each text element's own paint (layout-neutral) and returns candidates;
// the caller takes one screenshot, full frame or clipped to the candidates (collectContrast in checkBrowser.ts);
// __contrastAuditFinish(png, time, candidates, region) restores paint first, then samples inside each box.

// Sampling inside the box reads the exact pixels behind the glyphs; a ring outside the text misreads
// neighbouring panels, rounded pills, blurred glass and partial decorations.
// __contrastAuditRestoreIfPending() restores hidden paint if the screenshot or finish() throws.

// The "which rect to sample" decision is mirrored and unit-tested in contrast-sample.ts.

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

  // Raster-free contrast: a leaf text box whose backdrop is provably one opaque CSS colour needs no
  // screenshot. Anything this cannot prove (overlays, images, blending, rotation, round corners) returns null.
  var REPLACED = /^(IMG|VIDEO|CANVAS|IFRAME|OBJECT|EMBED|INPUT|TEXTAREA|SELECT|svg|PICTURE)$/;
  var paintCache = new Map();
  function blends(cs) {
    return (
      cs.opacity !== "1" ||
      cs.filter !== "none" ||
      (cs.backdropFilter || cs.webkitBackdropFilter || "none") !== "none" ||
      cs.mixBlendMode !== "normal" ||
      (cs.maskImage || cs.webkitMaskImage || "none") !== "none" ||
      cs.clipPath !== "none"
    );
  }
  function axisAligned(cs) {
    var t = cs.transform;
    if (t === "none") return true;
    var m = t.match(/^matrix\(([^)]+)\)$/);
    if (!m) return false;
    var v = m[1].split(",").map(parseFloat);
    return v[1] === 0 && v[2] === 0;
  }
  function pseudoPaints(el) {
    return ["::before", "::after"].some(function (pseudo) {
      var content = getComputedStyle(el, pseudo).content;
      return content !== "none" && content !== "normal";
    });
  }
  function hasOwnText(el) {
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 && /\S/.test(n.nodeValue || "")) return true;
    }
    return false;
  }
  function boxPaints(el, cs) {
    var bg = parseColor(cs.backgroundColor || "");
    return (
      (cs.backgroundImage || "none") !== "none" ||
      !bg ||
      bg[3] !== 0 ||
      ["Top", "Right", "Bottom", "Left"].some(function (side) {
        return (
          cs["border" + side + "Style"] !== "none" && parseFloat(cs["border" + side + "Width"]) > 0
        );
      }) ||
      cs.boxShadow !== "none" ||
      (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) ||
      pseudoPaints(el)
    );
  }
  // True unless the element provably adds no pixels of its own.
  function paints(el) {
    if (paintCache.has(el)) return paintCache.get(el);
    var cs = getComputedStyle(el);
    var result =
      cs.visibility === "hidden" && cs.filter === "none"
        ? false
        : REPLACED.test(el.tagName) ||
          !!el.ownerSVGElement ||
          hasOwnText(el) ||
          boxPaints(el, cs) ||
          blends(cs);
    paintCache.set(el, result);
    return result;
  }
  function intersects(a, b) {
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  }
  function solidBackdrop(el, rect, cs) {
    if (el.children.length > 0 || el.ownerSVGElement || cs.textShadow !== "none") return null;
    if (cs.textDecorationLine !== "none" || boxPaints(el, cs) || !axisAligned(cs)) return null;
    if ((cs.backdropFilter || cs.webkitBackdropFilter || "none") !== "none") return null;
    var region = {
      left: Math.max(0, rect.left),
      top: Math.max(0, rect.top),
      right: Math.min(window.innerWidth, rect.right),
      bottom: Math.min(window.innerHeight, rect.bottom),
    };
    if (region.right <= region.left || region.bottom <= region.top) return null;
    var chain = new Set([el]);
    var solid = null;
    for (var a = el.parentElement; a; a = a.parentElement) {
      chain.add(a);
      var acs = getComputedStyle(a);
      if (blends(acs) || !axisAligned(acs) || pseudoPaints(a)) return null;
      if (a === document.body || a === document.documentElement) {
        if (!solid) solid = canvasColor(a, acs, region);
        if (!solid && (a === document.documentElement || boxPaints(a, acs))) return null;
        continue;
      }
      if (solid) {
        if (acs.overflow !== "visible" && !contains(a.getBoundingClientRect(), acs, region))
          return null;
        continue;
      }
      var bg =
        (acs.backgroundImage || "none") === "none" ? parseColor(acs.backgroundColor || "") : null;
      if (bg && bg[3] === 1) {
        var radius = ["TopLeft", "TopRight", "BottomRight", "BottomLeft"].some(function (corner) {
          return parseFloat(acs["border" + corner + "Radius"]) > 0;
        });
        if (radius || !contains(a.getBoundingClientRect(), acs, region)) return null;
        solid = bg;
        continue;
      }
      if (hasOwnText(a) || boxPaints(a, acs)) return null;
    }
    if (!solid) return null;
    var all = document.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var other = all[i];
      if (chain.has(other) || !intersects(other.getBoundingClientRect(), region)) continue;
      if (paints(other)) return null;
    }
    return [solid[0], solid[1], solid[2]];
  }
  // body's background paints the whole canvas unless html has its own (CSS background propagation).
  function canvasColor(el, cs, region) {
    var bg =
      (cs.backgroundImage || "none") === "none" ? parseColor(cs.backgroundColor || "") : null;
    var html = document.documentElement;
    var htmlCs = getComputedStyle(html);
    var htmlBg = parseColor(htmlCs.backgroundColor || "");
    var htmlPaints = (htmlCs.backgroundImage || "none") !== "none" || !htmlBg || htmlBg[3] !== 0;
    if (el === html) return bg && bg[3] === 1 ? bg : null;
    if (!bg || bg[3] !== 1) return null;
    return htmlPaints && !contains(el.getBoundingClientRect(), cs, region) ? null : bg;
  }
  function contains(box, cs, region) {
    return (
      box.left + parseFloat(cs.borderLeftWidth) <= region.left &&
      box.top + parseFloat(cs.borderTopWidth) <= region.top &&
      box.right - parseFloat(cs.borderRightWidth) >= region.right &&
      box.bottom - parseFloat(cs.borderBottomWidth) >= region.bottom
    );
  }

  function parseColor(c) {
    var m = (c || "").match(/^rgba?\(([^)]+)\)$/i);
    if (!m) {
      var mix = (c || "").match(
        /^color-mix\(\s*in\s+srgb\s*,\s*(rgba?\([^)]+\))\s+(\d+(?:\.\d+)?|\.\d+)%\s*,\s*(rgba?\([^)]+\))\s+(\d+(?:\.\d+)?|\.\d+)%\s*\)$/i,
      );
      if (!mix) return null;
      var first = parseColor(mix[1]);
      var second = parseColor(mix[3]);
      var firstWeight = parseFloat(mix[2]);
      var secondWeight = parseFloat(mix[4]);
      var weightTotal = firstWeight + secondWeight;
      if (!first || !second || !isFinite(weightTotal) || weightTotal <= 0) return null;
      return first.map(function (channel, index) {
        return (channel * firstWeight + second[index] * secondWeight) / weightTotal;
      });
    }
    var p = m[1].split(",").map(function (s) {
      return parseFloat(s.trim());
    });
    if (
      (p.length !== 3 && p.length !== 4) ||
      p.some(function (v) {
        return !isFinite(v);
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

  var compositionBoxPaint = new WeakMap();
  var COMPOSITION_BOX_TAGS = new Set(["DIV", "SECTION"]);

  function hasContainerPaint(style) {
    var background = parseColor(style.backgroundColor);
    if (
      style.backgroundColor &&
      style.backgroundColor !== "transparent" &&
      (!background || background[3] > 0)
    )
      return true;
    if (
      ["backgroundImage", "boxShadow", "filter", "backdropFilter"].some(function (property) {
        return style[property] && style[property] !== "none";
      })
    )
      return true;
    if (parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== "none") return true;
    return ["Top", "Right", "Bottom", "Left"].some(function (side) {
      return (
        parseFloat(style["border" + side + "Width"]) > 0 &&
        style["border" + side + "Style"] !== "none"
      );
    });
  }

  function isUnpaintedCompositionBox(el) {
    if (!el || !el.matches("[data-composition-id], [data-hf-inner-root]")) return false;
    if (!el.closest("[data-composition-id]")) return false;
    if (
      el.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
      !COMPOSITION_BOX_TAGS.has(el.tagName) ||
      el.shadowRoot
    )
      return false;
    if (compositionBoxPaint.has(el)) return !compositionBoxPaint.get(el);
    var painted =
      Array.from(el.childNodes).some(function (child) {
        return child.nodeType === 3 && (child.textContent || "").trim().length > 0;
      }) || hasContainerPaint(getComputedStyle(el));
    if (!painted) {
      painted = ["::before", "::after"].some(function (pseudo) {
        var content = getComputedStyle(el, pseudo).content;
        return content && content !== "none" && content !== "normal";
      });
    }
    compositionBoxPaint.set(el, !!painted);
    return !painted;
  }

  function paintsAnyProbePoint(el, rect, skipCompositionBoxes) {
    // Keep probe resolution aligned with layout-audit.browser.js. Edge strips
    // narrower than the nearest probe point are treated as clipped away to
    // avoid noisy typewriter pre-reveal contrast reports.
    for (var ci = 0; ci < CLIP_PROBE_COLS.length; ci++) {
      for (var ri = 0; ri < CLIP_PROBE_ROWS.length; ri++) {
        var x = rect.left + rect.width * CLIP_PROBE_COLS[ci];
        var y = rect.top + rect.height * CLIP_PROBE_ROWS[ri];
        var hits =
          skipCompositionBoxes && typeof document.elementsFromPoint === "function"
            ? document.elementsFromPoint(x, y)
            : [document.elementFromPoint(x, y)];
        for (var hit of hits) {
          if (hit === el || el.contains(hit)) return true;
          if (!skipCompositionBoxes || !isUnpaintedCompositionBox(hit)) break;
        }
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
    return !paintsAnyProbePoint(el, rect, true);
  }

  function isIntentionallyOccluded(el, rect) {
    if (typeof document.elementFromPoint !== "function") return false;
    if (!el.closest || !el.closest("[data-layout-allow-occlusion]")) return false;
    return !paintsAnyProbePoint(el, rect, true);
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
    var fg = isSvgText ? parseColor(cs.fill) || parseColor(cs.color) : parseColor(cs.color);
    if (!fg) continue;
    if (fg[3] <= 0.01) continue;
    var strokeWidth = parseFloat(cs.webkitTextStrokeWidth || "0");
    var stroke = strokeWidth > 0 ? parseColor(cs.webkitTextStrokeColor || "") : null;
    if (stroke && stroke[3] <= 0.01) stroke = null;

    var fontSize = parseFloat(cs.fontSize);
    var fontWeight = Number(cs.fontWeight) || 400;
    var large = fontSize >= 24 || (fontSize >= 19 && fontWeight >= 700);

    // Glyphs sit on this element's own fill. The bounding box also contains
    // border-radius corners and neighbouring pixels, and those read as the
    // panel behind a circular avatar. An opaque background with no image is
    // the fill; pixel sampling stays for transparent text.
    var ownBg = null;
    if ((cs.backgroundImage || "none") === "none") {
      var parsedOwnBg = parseColor(cs.backgroundColor || "");
      if (parsedOwnBg && parsedOwnBg[3] >= 0.99) ownBg = parsedOwnBg;
    }

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
    var origStrokeColor = null,
      origStrokeColorPriority = null;
    if (stroke) {
      origStrokeColor = el.style.getPropertyValue("-webkit-text-stroke-color");
      origStrokeColorPriority = el.style.getPropertyPriority("-webkit-text-stroke-color");
      el.style.setProperty("-webkit-text-stroke-color", "transparent", "important");
    }
    restores.push({
      el: el,
      origTransition: origTransition,
      origTransitionPriority: origTransitionPriority,
      origColor: origColor,
      origColorPriority: origColorPriority,
      origFill: origFill,
      origFillPriority: origFillPriority,
      origStrokeColor: origStrokeColor,
      origStrokeColorPriority: origStrokeColorPriority,
      hasStroke: !!stroke,
      isSvgText: isSvgText,
    });

    out.push({
      selector: selectorOf(el),
      text: (el.textContent || "").trim().slice(0, 50),
      fg: fg,
      stroke: stroke,
      fontSize: fontSize,
      fontWeight: fontWeight,
      large: large,
      ownBg: ownBg,
      solidBg: ownBg ? null : solidBackdrop(el, rect, cs),
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
    if (r.hasStroke) {
      if (r.origStrokeColor)
        r.el.style.setProperty(
          "-webkit-text-stroke-color",
          r.origStrokeColor,
          r.origStrokeColorPriority,
        );
      else r.el.style.removeProperty("-webkit-text-stroke-color");
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

window.__contrastAuditFinish = async function (imgBase64, time, candidates, region) {
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

  // No image when every candidate's background is known from styles.
  var canvas = { width: region ? region.frameWidth : 0, height: region ? region.frameHeight : 0 };
  var px = null;
  if (imgBase64) {
    var img = new Image();
    await new Promise(function (resolve) {
      img.onload = resolve;
      img.onerror = function () {
        resolve();
      };
      img.src = "data:image/png;base64," + imgBase64;
    });
    if (!img.naturalWidth) return [];
    canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || 1920;
    canvas.height = img.naturalHeight || 1080;
    var ctx = canvas.getContext("2d");
    if (!ctx) return [];
    ctx.drawImage(img, 0, 0);
    px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  }
  // A clipped shot holds `region.clip` of the frame: clamp to the frame, read at the offset.
  var w = region ? region.frameWidth : canvas.width;
  var h = region ? region.frameHeight : canvas.height;
  var ox = region ? region.clip.x : 0;
  var oy = region ? region.clip.y : 0;

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
    var known = c.ownBg && c.ownBg.length >= 4 && c.ownBg[3] >= 0.99 ? c.ownBg : c.solidBg;
    var rr = [],
      gg = [],
      bb = [],
      aa = [];
    for (var y = y0; !known && y <= y1; y += stepY) {
      for (var x = x0; x <= x1; x += stepX) {
        var idx = ((y - oy) * canvas.width + (x - ox)) * 4;
        rr.push(px[idx]);
        gg.push(px[idx + 1]);
        bb.push(px[idx + 2]);
        aa.push(px[idx + 3]);
      }
    }
    if (!known && rr.length === 0) continue;

    var bgR, bgG, bgB;
    if (known) {
      bgR = known[0];
      bgG = known[1];
      bgB = known[2];
    } else {
      // A transparent sampled backdrop is supplied by the downstream editor,
      // not this composition. WCAG contrast cannot be inferred until that live
      // video/image is known, so do not invent an opaque browser default and
      // hard-fail an otherwise valid alpha overlay.
      if (median(aa) < 255) continue;
      bgR = median(rr);
      bgG = median(gg);
      bgB = median(bb);
    }

    // Composite foreground alpha over the measured background
    var fg = c.fg;
    var compR = Math.round(fg[0] * fg[3] + bgR * (1 - fg[3]));
    var compG = Math.round(fg[1] * fg[3] + bgG * (1 - fg[3]));
    var compB = Math.round(fg[2] * fg[3] + bgB * (1 - fg[3]));

    var ratio = +wcagRatio(compR, compG, compB, bgR, bgG, bgB).toFixed(2);

    // A solid text stroke is part of the visible glyph paint. Use whichever
    // of fill or stroke provides the stronger edge contrast, rather than
    // failing readable outlined captions based on fill alone.
    if (c.stroke) {
      var stroke = c.stroke;
      var strokeR = Math.round(stroke[0] * stroke[3] + bgR * (1 - stroke[3]));
      var strokeG = Math.round(stroke[1] * stroke[3] + bgG * (1 - stroke[3]));
      var strokeB = Math.round(stroke[2] * stroke[3] + bgB * (1 - stroke[3]));
      var strokeRatio = +wcagRatio(strokeR, strokeG, strokeB, bgR, bgG, bgB).toFixed(2);
      if (strokeRatio > ratio) {
        compR = strokeR;
        compG = strokeG;
        compB = strokeB;
        ratio = strokeRatio;
      }
    }

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
