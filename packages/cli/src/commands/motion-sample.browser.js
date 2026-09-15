// In-page motion sampler for `hyperframes inspect` motion verification (#1437).
// Runs inside the seeked, paused page (via page.evaluate). For each asserted
// selector it returns this frame's { rect, opacity, visible }; for each liveness
// scope it returns a bucketed signature of all visible elements, so the Node-side
// evaluator can detect frozen windows by comparing signatures across frames.
(function () {
  // Visibility, opacity, and the liveness signature all come from the shared
  // motion classifier so this sampler and the frozen-sweep guard can never
  // disagree on what counts as motion (see motion-signature.browser.js).
  // Resolved at install, checked at call: addScriptTag resolves on load, so an
  // install-time throw would only surface as a page error and an opaque
  // "__hyperframesMotionSample is not a function" from the driver's evaluate.
  const shared = window.__hyperframesMotionSignature;

  function toRect(rect) {
    return {
      left: shared.round(rect.left),
      top: shared.round(rect.top),
      right: shared.round(rect.right),
      bottom: shared.round(rect.bottom),
      width: shared.round(rect.width),
      height: shared.round(rect.height),
    };
  }

  function sampleElement(element) {
    const rect = element.getBoundingClientRect();
    return {
      rect: toRect(rect),
      opacity: shared.round(shared.opacityChain(element)),
      visible: shared.isVisibleElement(element),
    };
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
      const root = scope === "*" ? shared.compositionRoot() : safeQuery(scope);
      // ponytail: O(DOM) × MOTION_MAX_SAMPLES (300), with three computed-style
      // reads (element + ::before/::after) plus an ancestor walk per box-generating
      // element — fine for typical compositions; narrow the scope if heavy-DOM
      // compositions slow down.
      liveness[scope] = shared.compositionSignature(root, { quantize: true });
    }
    return liveness;
  }

  window.__hyperframesMotionSample = function motionSample(options) {
    if (!shared) {
      throw new Error(
        "motion-signature.browser.js must be injected before motion-sample.browser.js",
      );
    }
    const { selectors = [], livenessScopes = [] } = options || {};
    return { data: sampleSelectors(selectors), liveness: sampleLiveness(livenessScopes) };
  };
})();
