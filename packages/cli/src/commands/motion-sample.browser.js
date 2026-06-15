// In-page motion sampler for `hyperframes inspect` motion verification (#1437).
// Runs inside the seeked, paused page (via page.evaluate). For each asserted
// selector it returns this frame's { rect, opacity, visible }; for each liveness
// scope it returns a bucketed signature of all visible elements, so the Node-side
// evaluator can detect frozen windows by comparing signatures across frames.
(function () {
  const IGNORE_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "META", "LINK"]);

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function toRect(rect) {
    return {
      left: round(rect.left),
      top: round(rect.top),
      right: round(rect.right),
      bottom: round(rect.bottom),
      width: round(rect.width),
      height: round(rect.height),
    };
  }

  function opacityChain(element) {
    let opacity = 1;
    for (let current = element; current; current = current.parentElement) {
      const parsed = Number.parseFloat(getComputedStyle(current).opacity || "1");
      if (Number.isFinite(parsed)) opacity *= parsed;
    }
    return opacity;
  }

  // Mirrors layout-audit.browser.js isVisibleElement.
  // fallow-ignore-next-line complexity
  function isVisibleElement(element) {
    if (IGNORE_TAGS.has(element.tagName)) return false;
    const style = getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse"
    ) {
      return false;
    }
    if (opacityChain(element) < 0.2) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0.5 && rect.height > 0.5;
  }

  function sampleElement(element) {
    const rect = element.getBoundingClientRect();
    return {
      rect: toRect(rect),
      opacity: round(opacityChain(element)),
      visible: isVisibleElement(element),
    };
  }

  function compositionRoot() {
    return document.querySelector("[data-composition-id]") || document.body;
  }

  // ponytail: bucket position to 2px and opacity to 0.08 so the RFC's "moves ≥2px /
  // opacity ≥0.08" thresholds fall out of bucketing. Boundary-straddling moves are
  // approximate — good enough for liveness; tighten only if false negatives show up.
  function elementSignature(element) {
    const rect = element.getBoundingClientRect();
    const bx = Math.round(rect.left / 2);
    const by = Math.round(rect.top / 2);
    const bw = Math.round(rect.width / 2);
    const bh = Math.round(rect.height / 2);
    const bo = Math.round(opacityChain(element) / 0.08);
    return bx + "," + by + "," + bw + "," + bh + "," + bo;
  }

  function livenessSignature(root) {
    if (!root) return "";
    const parts = [];
    // ponytail: O(DOM) × MOTION_MAX_SAMPLES (300) — fine for typical compositions;
    // narrow selector (e.g. "[id],[class]") if heavy-DOM compositions slow this down.
    const all = root.querySelectorAll("*");
    for (const element of all) {
      if (!isVisibleElement(element)) continue;
      parts.push(elementSignature(element));
    }
    return parts.join("|");
  }

  function safeQuery(selector) {
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }

  function sampleSelectors(selectors) {
    const data = {};
    for (const selector of selectors) {
      // Multi-match selectors are rejected before this point by findAmbiguousSelectors
      // in layout.ts; querySelector is safe here.
      const element = safeQuery(selector);
      data[selector] = element ? sampleElement(element) : null;
    }
    return data;
  }

  function sampleLiveness(scopes) {
    const liveness = {};
    for (const scope of scopes) {
      const root = scope === "*" ? compositionRoot() : safeQuery(scope);
      liveness[scope] = livenessSignature(root);
    }
    return liveness;
  }

  window.__hyperframesMotionSample = function motionSample(options) {
    const { selectors = [], livenessScopes = [] } = options || {};
    return { data: sampleSelectors(selectors), liveness: sampleLiveness(livenessScopes) };
  };
})();
