// @vitest-environment happy-dom

import type React from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { OffCanvasRect } from "./OffCanvasIndicators";
import { recomputeOffCanvasIndicators } from "./offCanvasIndicatorGeometry";

const realGetBoundingClientRect = Element.prototype.getBoundingClientRect;
afterEach(() => {
  Element.prototype.getBoundingClientRect = realGetBoundingClientRect;
});

interface Rebuild {
  /** querySelectorAll calls on the preview document, per selector. */
  queriesBySelector: Map<string, number>;
  /** querySelector (singular) calls on the preview document, per selector. This
   *  is where the composition-root lookup that resolves the iframe→overlay
   *  basis shows up. */
  singleQueriesBySelector: Map<string, number>;
  /** The indicator keys, which carry each element's selector occurrence index. */
  keys: string[];
}

/**
 * One real rebuild over a preview whose `cardCount` cards all share `.box`,
 * counting the preview document's queries. Everything below the entry point is
 * production code: the layer walk, the patch targets, and the selector
 * occurrence indices that end up in each indicator's key.
 */
function rebuildWithSharedSelector(cardCount: number): Rebuild {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument;
  if (!doc) throw new Error("Expected iframe content document");

  const cards = Array.from(
    { length: cardCount },
    (_unused, i) => `<div class="box"><span class="label">card ${i}</span></div>`,
  ).join("");
  doc.body.innerHTML = `<div data-composition-id="root" data-width="800" data-height="450">${cards}</div>`;

  const overlay = document.createElement("div");
  document.body.append(overlay);

  // Cards sit left of the composition, so every one of them is off-canvas and
  // reaches the indicator list; everything else measures empty and does not.
  Element.prototype.getBoundingClientRect = function (): DOMRect {
    if (this === iframe || this === overlay) return new DOMRect(0, 0, 800, 450);
    if (this instanceof doc.defaultView!.Element && this.classList.contains("box")) {
      return new DOMRect(-500, 40, 100, 40);
    }
    return new DOMRect(0, 0, 0, 0);
  };

  const queriesBySelector = new Map<string, number>();
  const realQuerySelectorAll = doc.querySelectorAll.bind(doc);
  Object.defineProperty(doc, "querySelectorAll", {
    configurable: true,
    value: (selector: string) => {
      queriesBySelector.set(selector, (queriesBySelector.get(selector) ?? 0) + 1);
      return realQuerySelectorAll(selector);
    },
  });

  const singleQueriesBySelector = new Map<string, number>();
  const realQuerySelector = doc.querySelector.bind(doc);
  Object.defineProperty(doc, "querySelector", {
    configurable: true,
    value: (selector: string) => {
      singleQueriesBySelector.set(selector, (singleQueriesBySelector.get(selector) ?? 0) + 1);
      return realQuerySelector(selector);
    },
  });

  const sigRef = { current: "" } as React.MutableRefObject<string>;
  const elementsRef = { current: new Map<string, HTMLElement>() } as React.MutableRefObject<
    Map<string, HTMLElement>
  >;
  let rects: OffCanvasRect[] = [];

  recomputeOffCanvasIndicators(
    iframe,
    overlay,
    doc,
    { left: 0, top: 0, width: 800, height: 450 },
    "index.html",
    sigRef,
    elementsRef,
    (next) => {
      rects = next;
    },
  );

  iframe.remove();
  overlay.remove();
  return { queriesBySelector, singleQueriesBySelector, keys: rects.map((rect) => rect.key) };
}

/** The composition-root lookups a rebuild makes. `computeOverlayRootScale` and
 *  `recomputeOffCanvasIndicators` each resolve the root once; nothing else in
 *  the pass may. */
const COMPOSITION_ROOT_SELECTOR = "[data-composition-id]";

/** The queries that resolve a class selector's occurrence index — the work this
 *  guards. Excluded: the per-element `[data-composition-id]` ancestor lookup and
 *  the stylesheet scan, which are linear per element and a separate seam. */
function classSelectorQueries(rebuild: Rebuild): Array<[string, number]> {
  return [...rebuild.queriesBySelector].filter(([selector]) => selector.startsWith(".")).sort();
}

describe("recomputeOffCanvasIndicators selector-index cost", () => {
  // The defect this guards: the occurrence index used to be resolved with its
  // own whole-document querySelectorAll PER element, so n cards sharing a class
  // cost n queries and n² source-file resolutions. A threshold would pass on a
  // small fixture while a real composition runs hundreds of cards. Invariance
  // across a 4x fixture cannot — it fails for any per-element term at all.
  it("resolves shared selectors with the same number of queries at n and at 4n", () => {
    const small = rebuildWithSharedSelector(12);
    const large = rebuildWithSharedSelector(48);

    expect(classSelectorQueries(large)).toEqual(classSelectorQueries(small));
    expect(classSelectorQueries(small)).toEqual([
      [".box", 1],
      [".label", 1],
    ]);
  });

  it("still numbers every shared-selector element in document order", () => {
    for (const cardCount of [12, 48]) {
      const { keys } = rebuildWithSharedSelector(cardCount);
      expect(keys).toEqual(
        Array.from({ length: cardCount }, (_unused, i) => `index.html:.box:${i}`),
      );
    }
  });
});

describe("recomputeOffCanvasIndicators composition-basis cost", () => {
  /**
   * The defect this guards: the iframe→overlay basis was resolved INSIDE
   * `orientedGroupAwareOverlayRect`, so every element in the preview paid its
   * own `querySelector("[data-composition-id]")` plus three layout reads to
   * rediscover a basis that is a property of the composition, not of the
   * element. On a real preview that is one lookup per element per rebuild.
   *
   * The basis is hoisted to the caller and threaded through, so the count is
   * a property of the COMPOSITION (one root, resolved twice: once for the walk
   * root, once for the basis) and cannot grow with the element count.
   */
  it("resolves the composition root the same number of times at n and at 4n", () => {
    const small = rebuildWithSharedSelector(12);
    const large = rebuildWithSharedSelector(48);

    expect(large.singleQueriesBySelector.get(COMPOSITION_ROOT_SELECTOR)).toEqual(
      small.singleQueriesBySelector.get(COMPOSITION_ROOT_SELECTOR),
    );
    // A ceiling as well as invariance, so a future caller that reintroduces a
    // per-element lookup fails here even if it happens to be element-count-flat.
    expect(small.singleQueriesBySelector.get(COMPOSITION_ROOT_SELECTOR)).toBe(2);
  });

  // Non-vacuity guard for the assertion above: it only means something if the
  // fixture actually drives the per-element geometry path.
  it("measures a rebuild that really did resolve every card's rect", () => {
    expect(rebuildWithSharedSelector(12).keys).toHaveLength(12);
  });
});
