// Shared "what counts as motion" classifier, injected before layout-audit.browser.js and motion-sample.browser.js.
// The frozen-sweep guard (sweep_static) and keepsMoving liveness (motion_frozen) meet in one decision, so both
// must count the same channels as motion; only quantization differs (liveness buckets 2px and 0.08 opacity).
// A channel reader returns a string equal across samples iff it did not visibly change, "" when it does not apply.
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
  // Whether an element sits inside skipped contents is not on its computed style; only checkVisibility knows.
  // PAINTED_OPTIONS matches layout-audit.browser.js isVisibleElement's opacity-floor path. happy-dom lacks
  // checkVisibility, so callers keep a computed-style fallback.
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
  // content-visibility skips contents only where size containment applies (css-contain-2); hosts matching this
  // paint everything. It mirrors Chromium 152 where that differs from the spec: a table-cell host skips, a
  // table-caption host does not. Replaced elements (MEDIA_TAGS) are atomic even at display:inline.
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

  // Kept local rather than shared with layout-audit, which is installed and tested on its own. The author
  // opt-out is not applied: an asserted selector outranks it, and compositionSignature applies it itself.
  // clip-path is a channel, not a visibility probe, so a wipe over a static box counts as motion.
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

  // Pixel-only media motion (canvas repaint, playing video, same-size <img> swap) is invisible to DOM channels,
  // so fold in an 8x8 downsample. Unreadable media hashes to a constant; iframe media is a separate document.
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
  // Counter declarations often live on zero-box owners while a pseudo-element elsewhere paints the value, so
  // every box-generating element is an owner, but only declarations naming a painted counter fold in.
  // The gate is by name, not scope: enough for catching frozen timelines. <ol start> and <li value> are missed.

  // Generated content of one box owner that reaches the screen, including a list-item's ::marker.
  // Callers have already excluded opted-out hosts and hosts whose contents are skipped.
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

  // One signature of everything under `root`, root included, that a viewer could see change between seeks.
  // Opted-out elements inside the root may animate off the timeline, so they are neither signed nor counter
  // consumers, but stay counter owners; the root itself is always measured.
  // fallow-ignore-next-line complexity
  function compositionSignature(root, options) {
    if (!root) return "";
    const quantize = !!(options && options.quantize);
    const parts = [];
    const boxOwners = [];
    // Unrendered elements paint nothing and feed no counter(). A display:contents child of a skipping host
    // paints nothing either, which checkVisibility cannot tell from an ordinary one, so the parent's
    // skipsContents verdict decides. A display:contents child of an off-screen `auto` host is missed.
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
      // A skipping host paints its box but not its contents. Its counter-* stay in: in Chromium its
      // increment and set still reach a sibling's painted counter(). Off-screen `auto` hosts are missed.
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
