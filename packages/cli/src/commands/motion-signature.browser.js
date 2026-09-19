// Shared "what counts as motion" classifier for the two seek-time samplers.
// Injected via page.addScriptTag BEFORE layout-audit.browser.js and
// motion-sample.browser.js (see checkBrowser.ts injectAuditScripts and
// layout.ts); both consume it through window.__hyperframesMotionSignature.
//
// Two Node-side decisions compare per-sample signatures of the composition:
//   - the frozen-sweep guard (#U10, checkPipeline.ts detectSweepStatic) reads
//     window.__hyperframesLayoutGeometry once per layout-grid seek and fails
//     the run with sweep_static when every sample is byte-identical;
//   - keepsMoving liveness (motionAudit.ts) reads motion-sample's liveness
//     signature per motion sample and reports motion_frozen on long runs of
//     identical signatures.
// They meet in one decision (a motion_frozen finding suppresses sweep_static),
// so the set of channels that count as motion MUST be identical for both —
// otherwise a composition one sampler accepts as live is rejected as frozen
// by the other. This module is that single owner. The only sanctioned
// difference is quantization: liveness buckets position to 2px and opacity to
// 0.08 so the motion RFC's "moves ≥2px / opacity ≥0.08" thresholds fall out of
// bucketing, while the sweep guard wants exact (0.01) rounding because it asks
// whether the seek moved anything at all.
//
// Adding a channel (e.g. SVG stroke-dasharray/dashoffset): append one reader
// `(element, ctx) => string` to BOX_CHANNELS (reads the element's own box,
// including a control's widget type and checked state) or CONTENT_CHANNELS (reads what the
// element's contents paint — text, pseudo content, control values, media
// pixels — which `content-visibility: hidden` skips). `ctx`
// carries the element's computed style, its ::before/::after styles, its
// inherited opacity, and the quantize flag. A reader returns a string that is
// equal between two samples iff that channel did not visibly change; return ""
// for elements the channel does not apply to so ordinary compositions gain no
// payload.
//
// Signatures are a single opaque string per sample (not a structured array):
// Node only ever needs equality, never per-element diffing. Textual channels
// are hashed (FNV-1a, length-delimited fields) so raw composition text never
// leaves the page and per-sample payloads stay compact.
(function () {
  const IGNORE_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "META", "LINK"]);
  const MEDIA_TAGS = new Set(["CANVAS", "VIDEO", "IMG"]);
  const FNV_OFFSET_BASIS = 2166136261;
  const FNV_PRIME = 16777619;
  const LIVENESS_POSITION_BUCKET_PX = 2;
  const LIVENESS_OPACITY_BUCKET = 0.08;
  const IGNORE_SELECTOR = "[data-layout-ignore], [data-layout-check='ignore']";
  // counter(name) / counters(name, sep) in generated content. A list-item box
  // whose ::marker content is `normal` paints counter(list-item) implicitly.
  const COUNTER_FUNCTION = /counters?\(\s*([^\s,)]+)/g;
  const IMPLICIT_MARKER_CONTENT = "counter(list-item)";
  const LIST_ITEM_DISPLAY = /\blist-item\b/;
  // Whether an element sits inside skipped contents (content-visibility:
  // hidden, or auto while off-screen) is not on its own computed style; only
  // the platform knows. RENDERED_BOX asks "does this element have a rendered
  // box" (false for display:none, display:contents, and skipped contents);
  // PAINTED adds the opacity/visibility properties and is the option set
  // layout-audit.browser.js isVisibleElement uses on its opacity-floor path.
  // happy-dom has no checkVisibility, so both callers keep a computed-style
  // fallback.
  const RENDERED_BOX_OPTIONS = { contentVisibilityAuto: true };
  const PAINTED_OPTIONS = {
    opacityProperty: true,
    visibilityProperty: true,
    contentVisibilityAuto: true,
  };
  // Stand-in for the ::before/::after of an element whose contents are skipped:
  // no pseudo box exists, so nothing it declares (content, counter-*) paints.
  const NO_BOX = Object.freeze({ display: "none" });
  const SKIPPED_PSEUDO = Object.freeze({ before: NO_BOX, after: NO_BOX });
  // content-visibility only skips contents where size containment applies
  // (css-contain-2): not on non-atomic inline boxes, display:contents, table
  // boxes and internal table boxes, or the inline ruby container and internal
  // ruby boxes. Such a host paints everything. The guard mirrors Chromium (152)
  // where it parts ways with that list, since the platform's behaviour is what
  // decides what paints: a table-cell host does skip its contents, and a
  // table-caption host does not (the spec would have it the other way round
  // for both). Replaced elements (MEDIA_TAGS) are atomic even at
  // display:inline.
  const NOT_CONTAINABLE_DISPLAY =
    /^(inline( list-item)?|contents|table|inline-table|table-(?!cell$)[a-z-]+|ruby[a-z-]*)$/;

  function skipsContents(element, style) {
    if (style.contentVisibility !== "hidden") return false;
    return MEDIA_TAGS.has(element.tagName) || !NOT_CONTAINABLE_DISPLAY.test(style.display);
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function opacityChain(element) {
    let opacity = 1;
    for (let current = element; current; current = current.parentElement) {
      const parsed = Number.parseFloat(getComputedStyle(current).opacity || "1");
      if (Number.isFinite(parsed)) opacity *= parsed;
    }
    return opacity;
  }

  function compositionRoot() {
    return (
      document.querySelector("[data-composition-id][data-width][data-height]") ||
      document.querySelector("[data-composition-id]") ||
      document.body
    );
  }

  function isHiddenStyle(style) {
    return (
      style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse"
    );
  }

  // Visibility floor: checkVisibility (as layout-audit.browser.js
  // isVisibleElement's opacity-floor path; its default path skips it and so
  // cannot see skipped contents), then display/visibility, then inherited
  // opacity, then a non-empty box. Kept local rather than shared because
  // layout-audit is also installed and tested on its own; this module owns the
  // decision for both motion samplers. The author opt-out (data-layout-ignore /
  // data-layout-check=ignore) is NOT applied here: motion-sample reports this
  // bit for explicitly asserted selectors, and an assertion naming an element
  // outranks a layout-audit opt-out. compositionSignature applies the opt-out
  // itself (see there). clip-path is not probed either; it is a channel, so a
  // clip-path wipe over a static box counts as motion directly.
  // fallow-ignore-next-line complexity
  function isVisibleElement(element, style, opacity) {
    if (IGNORE_TAGS.has(element.tagName)) return false;
    if (
      typeof element.checkVisibility === "function" &&
      !element.checkVisibility(PAINTED_OPTIONS)
    ) {
      return false;
    }
    if (isHiddenStyle(style || getComputedStyle(element))) return false;
    if ((opacity === undefined ? opacityChain(element) : opacity) < 0.2) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0.5 && rect.height > 0.5;
  }

  function foldField(hash, value) {
    hash ^= value.length;
    hash = Math.imul(hash, FNV_PRIME);
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, FNV_PRIME);
    }
    return hash;
  }

  function hashFields(fields) {
    let hash = FNV_OFFSET_BASIS;
    for (const field of fields) hash = foldField(hash, field);
    return (hash >>> 0).toString(36);
  }

  // `none` / `normal` are the computed initial values of content, counter-*,
  // clip-path, and font-variation-settings; collapse them so unused channels
  // stay "".
  function cssValue(value) {
    return value === "none" || value === "normal" ? "" : value || "";
  }

  // --- Per-element channels: (element, ctx) => string --------------------------

  function boxChannel(element, ctx) {
    const rect = element.getBoundingClientRect();
    const box = [rect.left, rect.top, rect.width, rect.height];
    if (ctx.quantize) {
      return box.map((value) => Math.round(value / LIVENESS_POSITION_BUCKET_PX)).join(",");
    }
    return box.map(round).join(",");
  }

  function opacityChannel(element, ctx) {
    return String(
      ctx.quantize ? Math.round(ctx.opacity / LIVENESS_OPACITY_BUCKET) : round(ctx.opacity),
    );
  }

  // Variable-font axis animation moves no geometry and no opacity; in a
  // DUPLEXED face (Recursive holds one advance width at every weight) not even
  // the line width shifts, so without this channel the whole run reads frozen.
  function fontAxesChannel(element, ctx) {
    const axes = cssValue(ctx.style.fontVariationSettings);
    return axes ? hashFields([axes]) : "";
  }

  // A clip-path wipe (inset(0 100% 0 0) → inset(0)) reveals a box that never
  // moves; the computed clip-path string is the only thing that changes.
  function clipPathChannel(element, ctx) {
    const clip = cssValue(ctx.style.clipPath);
    return clip ? hashFields([clip]) : "";
  }

  // Direct text nodes only: descendants are signed separately, and a hidden
  // descendant's text mutation must not masquerade as visible motion.
  function textChannel(element) {
    const text = Array.from(element.childNodes)
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent)
      .join("");
    return text && hashFields([text]);
  }

  function flag(value) {
    return value ? "1" : "0";
  }

  function selectState(element) {
    const fields = [String(element.selectedIndex), element.value || ""];
    for (const option of element.options) fields.push(flag(option.selected));
    return fields;
  }

  // A control's value is painted by its inner (shadow) contents, which
  // content-visibility: hidden skips; the widget itself (its type, a
  // checkbox/radio glyph) is theme paint of the control's own box and still
  // shows. Hence two channels.
  const CONTROL_VALUE = {
    INPUT: (element) => [element.value || ""],
    TEXTAREA: (element) => [element.value || ""],
    SELECT: selectState,
  };

  function controlValueChannel(element) {
    const read = CONTROL_VALUE[element.tagName];
    return read ? hashFields(read(element)) : "";
  }

  function controlWidgetChannel(element) {
    if (element.tagName !== "INPUT") return "";
    return hashFields([element.type || "", flag(element.checked), flag(element.indeterminate)]);
  }

  // Chromium substitutes attr() in computed pseudo content, so this is the
  // platform-owned rendered string rather than a CSS expression to reparse.
  // counter() is NOT substituted — that is what the counter channel is for.
  function generatedContentChannel(element, ctx) {
    const before = cssValue(ctx.pseudo.before.content);
    const after = cssValue(ctx.pseudo.after.content);
    return before || after ? hashFields([before, after]) : "";
  }

  // Pixel-only media motion (a 2D/WebGL canvas repainting, a playing video, or
  // an equal-size opaque <img> src swap) moves no geometry and no opacity, so
  // it is invisible to every DOM-state channel. Downsample each visible media
  // element to 8x8 and fold its pixels in. Tainted, zero-sized, or unreadable
  // media hashes to a constant — no worse than DOM-state-only detection and
  // never a new false negative for DOM-motion compositions. Media inside
  // iframes is intentionally outside this signature: it lives in a separate
  // document, and cross-origin frames are inaccessible under SOP.
  // fallow-ignore-next-line complexity
  function mediaPixelChannel(element) {
    if (!MEDIA_TAGS.has(element.tagName)) return "";
    try {
      const rect = element.getBoundingClientRect();
      const sourceWidth = element.videoWidth || element.width || rect.width;
      const sourceHeight = element.videoHeight || element.height || rect.height;
      if (!sourceWidth || !sourceHeight) return "x";
      const off = document.createElement("canvas");
      off.width = 8;
      off.height = 8;
      const ctx2d = off.getContext("2d");
      if (!ctx2d) return "x";
      ctx2d.drawImage(element, 0, 0, 8, 8);
      const data = ctx2d.getImageData(0, 0, 8, 8).data;
      let hash = 0;
      for (let i = 0; i < data.length; i++) hash = (hash * 31 + data[i]) >>> 0;
      return String(hash);
    } catch {
      return "x";
    }
  }

  // The element's own box still paints when its contents are skipped
  // (content-visibility: hidden) — including a checkbox's check glyph; its
  // text, pseudo boxes, control value, and replaced content (a canvas/video/img's
  // pixels) do not.
  const BOX_CHANNELS = [
    boxChannel,
    opacityChannel,
    fontAxesChannel,
    clipPathChannel,
    controlWidgetChannel,
  ];
  const CONTENT_CHANNELS = [
    textChannel,
    controlValueChannel,
    generatedContentChannel,
    mediaPixelChannel,
  ];
  const ELEMENT_CHANNELS = [...BOX_CHANNELS, ...CONTENT_CHANNELS];

  // --- Composition-level counter channel ------------------------------------
  //
  // Counter declarations often live on zero-box owners (or on ancestors of the
  // composition root) while some pseudo-element paints the value, so counter
  // state is a composition-level channel over every element that generates a
  // box — not just the visible ones. Two guards keep a decoy counter from
  // making a frozen composition read as live: a display:none subtree generates
  // no boxes and therefore cannot feed any painted counter(), and only
  // declarations that NAME a counter some generated content actually paints
  // are folded in — a varying counter nobody renders is not motion. The gate
  // is name-level, not scope-level: a same-named owner that cannot reach the
  // consumer in the box tree still counts, which is accepted for a guard whose
  // job is catching frozen timelines, not defeating deliberate authors.
  // visibility:hidden and zero-box owners stay in as owners: they generate
  // boxes, their counters propagate to visible descendants/siblings, and their
  // own absolutely-positioned pseudo-elements can paint. <ol start> / <li
  // value> are not surfaced in computed counter-* and stay invisible here.

  // Generated content of one box owner that reaches the screen: the host has
  // a paintable inherited opacity and paints its contents, and the pseudo box
  // itself is not hidden. A list-item box also paints its ::marker
  // (counter(list-item) when the marker content is `normal`). The caller has
  // already excluded opted-out hosts and hosts whose contents are skipped.
  function markerContent(element, style) {
    if (isHiddenStyle(style) || !LIST_ITEM_DISPLAY.test(style.display)) return "";
    return cssValue(getComputedStyle(element, "::marker").content) || IMPLICIT_MARKER_CONTENT;
  }

  function paintedContent(element, style, pseudo, opacity) {
    if (opacity < 0.2) return [];
    const boxes = [pseudo.before, pseudo.after].filter((box) => !isHiddenStyle(box));
    return [...boxes.map((box) => cssValue(box.content)), markerContent(element, style)];
  }

  // The author opt-out applies to elements INSIDE the measured root, never to
  // the root itself or its ancestors: a keepsMoving scope (or the composition
  // root) is explicitly asserted, and an assertion naming an element outranks
  // a layout-audit opt-out — see isVisibleElement.
  function isOptedOut(element, root) {
    for (let current = element; current && current !== root; current = current.parentElement) {
      if (current.matches(IGNORE_SELECTOR)) return true;
    }
    return false;
  }

  function consumedCounterNames(owners) {
    const names = new Set();
    for (const owner of owners) {
      for (const content of owner.painted) {
        for (const match of content.matchAll(COUNTER_FUNCTION)) names.add(match[1]);
      }
    }
    return names;
  }

  // `counter-reset: a 10 b 3` → does any named counter get painted?
  function namesConsumedCounter(declaration, consumed) {
    return declaration.split(/\s+/).some((token) => consumed.has(token));
  }

  function counterState(style, consumed) {
    const fields = [style.counterReset, style.counterIncrement, style.counterSet]
      .map(cssValue)
      .filter((declaration) => declaration && namesConsumedCounter(declaration, consumed));
    return fields.length > 0 ? "c:" + hashFields(fields) : "";
  }

  function counterParts(root, owners) {
    const consumed = consumedCounterNames(owners);
    if (consumed.size === 0) return [];
    const parts = [];
    function push(style) {
      const state = counterState(style, consumed);
      if (state) parts.push(state);
    }
    for (let ancestor = root.parentElement; ancestor; ancestor = ancestor.parentElement) {
      push(getComputedStyle(ancestor));
    }
    for (const owner of owners) {
      push(owner.style);
      push(owner.pseudo.before);
      push(owner.pseudo.after);
    }
    return parts;
  }

  // One signature of everything under `root` (root included — a composition
  // whose only textual motion is a direct text node of the root still moves)
  // that a viewer could see change between two seeks. `options.quantize`
  // selects liveness bucketing (see header). Elements under an author opt-out
  // inside the root (data-layout-ignore / data-layout-check=ignore) — typically
  // a decorative layer that may animate off the seeked timeline — are neither
  // signed nor allowed to consume counters: they must not prove that the
  // timeline advanced. They remain counter owners, since their boxes still
  // propagate. The root itself is always measured (see isOptedOut).
  // fallow-ignore-next-line complexity
  function compositionSignature(root, options) {
    if (!root) return "";
    const quantize = !!(options && options.quantize);
    const parts = [];
    const boxOwners = [];
    // Unrendered elements (display:none subtrees, skipped contents) paint
    // nothing and cannot feed a painted counter(). The platform decides where it
    // can; the fallback is display:none and content-visibility:hidden hosts,
    // propagated to descendants. display:contents has no box of its own but its
    // pseudo-elements and children render, so it stays an owner — except as
    // the child of a host that skips its contents, where its pseudo-elements
    // paint nothing either. The platform check cannot tell that from an
    // ordinary display:contents host (both have no box), so the parent's
    // skipsContents verdict decides; a display:contents child of an off-screen
    // `auto` host is not caught (see below).
    const unrenderedBelow = new Set();
    const skippedHosts = new Set();
    for (const element of [root, ...root.querySelectorAll("*")]) {
      if (IGNORE_TAGS.has(element.tagName)) continue;
      const style = getComputedStyle(element);
      const parent = element.parentElement;
      const platformDecides = typeof element.checkVisibility === "function";
      const noBox = platformDecides
        ? !element.checkVisibility(RENDERED_BOX_OPTIONS)
        : style.display === "none";
      const boxlessOwner = style.display === "contents" && !skippedHosts.has(parent);
      if (unrenderedBelow.has(parent) || (noBox && !boxlessOwner)) {
        unrenderedBelow.add(element);
        continue;
      }
      // A host that skips its contents paints its box but none of its contents.
      // Its counter-* declarations stay in: in Chromium a skipped host's
      // counter-increment / counter-set still reach a sibling's painted
      // counter() (counter-reset does not; keeping it is an over-count accepted
      // for a guard). An `auto` host that is currently off-screen skips its
      // contents too but is not detected here; its boxed descendants are pruned
      // by the platform check above, while its own direct text / pseudo content
      // and a display:contents child's pseudo content would still be signed.
      const skipped = skipsContents(element, style);
      if (skipped) skippedHosts.add(element);
      if (skipped && !platformDecides) unrenderedBelow.add(element);
      const pseudo = skipped
        ? SKIPPED_PSEUDO
        : {
            before: getComputedStyle(element, "::before"),
            after: getComputedStyle(element, "::after"),
          };
      const opacity = opacityChain(element);
      const optedOut = isOptedOut(element, root);
      const paintsContent = !optedOut && !skipped;
      boxOwners.push({
        style,
        pseudo,
        painted: paintsContent ? paintedContent(element, style, pseudo, opacity) : [],
      });
      if (optedOut || !isVisibleElement(element, style, opacity)) continue;
      const ctx = { style, pseudo, opacity, quantize };
      const channels = skipped ? BOX_CHANNELS : ELEMENT_CHANNELS;
      parts.push(channels.map((channel) => channel(element, ctx)).join(","));
    }
    parts.push(...counterParts(root, boxOwners));
    return parts.join("|");
  }

  window.__hyperframesMotionSignature = {
    compositionRoot,
    isVisibleElement,
    opacityChain,
    round,
    compositionSignature,
  };

  // Frozen-sweep guard entry point (checkBrowser.ts collectLayoutGeometry).
  // The name predates the textual/media channels and is kept for driver
  // compatibility.
  window.__hyperframesLayoutGeometry = function collectLayoutGeometry() {
    return compositionSignature(compositionRoot(), { quantize: false });
  };
})();
