// @vitest-environment happy-dom

import type React from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { OffCanvasRect } from "./OffCanvasIndicators";
import { recomputeOffCanvasIndicators } from "./offCanvasIndicatorGeometry";
import { DOM_EDIT_LAYER_OBSERVER_INIT, createDomEditLayerWalkCache } from "./domEditLayerWalkCache";

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

/**
 * A group's box is the union of its MEMBERS' rects, not its own. That makes it
 * the one item whose measurement depends on elements BELOW it, and the walk
 * cache invalidates upward only — so a cached group union would go stale the
 * moment a member moved, and stay stale, because nothing ever writes to the
 * wrapper.
 */
describe("recomputeOffCanvasIndicators group measurement", () => {
  function rebuildGroupTwice(): { first: string; second: string } {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("Expected iframe content document");
    doc.body.innerHTML =
      `<div data-composition-id="root" data-width="800" data-height="450">` +
      `<div id="grp" data-hf-group="Group"><div id="member" class="member"></div></div>` +
      `</div>`;
    const member = doc.getElementById("member") as HTMLElement;

    const overlay = document.createElement("div");
    document.body.append(overlay);

    // Only the member has a box; the wrapper measures empty, which is exactly
    // the case the union exists for. Moving the member moves the group.
    let memberLeft = -500;
    Element.prototype.getBoundingClientRect = function (): DOMRect {
      if (this === iframe || this === overlay) return new DOMRect(0, 0, 800, 450);
      if (this === member) return new DOMRect(memberLeft, 40, 100, 40);
      return new DOMRect(0, 0, 0, 0);
    };

    const cache = createDomEditLayerWalkCache();
    const observer = new MutationObserver(() => {});
    observer.observe(doc.documentElement, DOM_EDIT_LAYER_OBSERVER_INIT);

    const sigRef = { current: "" } as React.MutableRefObject<string>;
    const elementsRef = { current: new Map<string, HTMLElement>() } as React.MutableRefObject<
      Map<string, HTMLElement>
    >;
    let rects: OffCanvasRect[] = [];
    const rebuild = () => {
      cache.ingest(observer.takeRecords());
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
        cache,
      );
      const group = rects.find((rect) => rect.key.includes("grp"));
      return group ? `${group.left},${group.top},${group.width},${group.height}` : "absent";
    };

    const first = rebuild();
    // What an animation frame does: one inline style write on the member.
    memberLeft = -300;
    member.style.transform = "translateX(200px)";
    const second = rebuild();

    observer.disconnect();
    iframe.remove();
    overlay.remove();
    return { first, second };
  }

  it("re-measures a group when a member moves and nothing writes to the wrapper", () => {
    const { first, second } = rebuildGroupTwice();

    expect(first).not.toBe("absent");
    expect(second).not.toBe(first);
  });
});

/**
 * Layout changes that emit no mutation record at all.
 *
 * An `<img>` finishing decode, a web font swapping in, a CSS transition or
 * `@keyframes` frame, a container query re-evaluating, a `CSSStyleSheet.insertRule`
 * — every one of them moves an element's border box with nothing written to the
 * DOM. A rebuild that re-measures everything picks them up for free; a rebuild
 * that reuses a previous measurement cannot see them at all.
 */
describe("recomputeOffCanvasIndicators layout changes with no mutation record", () => {
  /** Rebuild twice, changing only what layout REPORTS between the two, with no
   *  DOM write of any kind in between. */
  function rebuildAcrossSilentLayoutChange(): { first: string; second: string } {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("Expected iframe content document");
    doc.body.innerHTML =
      `<div data-composition-id="root" data-width="800" data-height="450">` +
      `<img id="hero" class="hero">` +
      `</div>`;
    const hero = doc.getElementById("hero") as HTMLElement;

    const overlay = document.createElement("div");
    document.body.append(overlay);

    // Before decode the image lays out at zero-ish; after decode it takes its
    // intrinsic size, off the left edge of the composition. No attribute is
    // written, no node is added, no text changes.
    let heroRect = new DOMRect(-500, 40, 100, 40);
    Element.prototype.getBoundingClientRect = function (): DOMRect {
      if (this === iframe || this === overlay) return new DOMRect(0, 0, 800, 450);
      if (this === hero) return heroRect;
      return new DOMRect(0, 0, 0, 0);
    };

    const cache = createDomEditLayerWalkCache();
    const observer = new MutationObserver(() => {});
    observer.observe(doc.documentElement, DOM_EDIT_LAYER_OBSERVER_INIT);

    const sigRef = { current: "" } as React.MutableRefObject<string>;
    const elementsRef = { current: new Map<string, HTMLElement>() } as React.MutableRefObject<
      Map<string, HTMLElement>
    >;
    let rects: OffCanvasRect[] = [];
    const rebuild = () => {
      cache.ingest(observer.takeRecords());
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
        cache,
      );
      const marker = rects.find((rect) => rect.key.includes("hero"));
      return marker ? `${marker.left},${marker.top},${marker.width},${marker.height}` : "absent";
    };

    const first = rebuild();
    heroRect = new DOMRect(-500, 40, 320, 180); // decode finished
    const second = rebuild();

    observer.disconnect();
    iframe.remove();
    overlay.remove();
    return { first, second };
  }

  it("re-measures an element whose own box changed with no DOM write", () => {
    const { first, second } = rebuildAcrossSilentLayoutChange();

    expect(first).toBe("-500,40,100,40");
    expect(second).toBe("-500,40,320,180");
  });
});

/**
 * The ancestor work, measured through the production entry point.
 *
 * Everything the rebuild asks about an ancestor — does it render, what does it
 * contribute to the composed transform, is it the source-file boundary — is the
 * same question for every element underneath it. The guard is INVARIANCE in
 * depth: burying the same cards under more shared wrappers may cost one style
 * read per added wrapper, and must not cost one per wrapper PER CARD.
 */
describe("recomputeOffCanvasIndicators ancestor cost", () => {
  /** `cardCount` off-canvas cards, all siblings, buried under `depth` shared
   *  wrappers. Returns the preview document's computed-style reads for one
   *  rebuild, and the markers it produced. */
  function rebuildAtDepth(
    cardCount: number,
    depth: number,
  ): { styleReads: number; markers: number } {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("Expected iframe content document");

    const cards = Array.from(
      { length: cardCount },
      (_unused, i) => `<div class="box"><span class="label">card ${i}</span></div>`,
    ).join("");
    const open = Array.from({ length: depth }, (_unused, i) => `<div class="w${i}">`).join("");
    const close = "</div>".repeat(depth);
    doc.body.innerHTML =
      `<div data-composition-id="root" data-width="800" data-height="450">` +
      `${open}${cards}${close}` +
      `</div>`;

    const overlay = document.createElement("div");
    document.body.append(overlay);
    Element.prototype.getBoundingClientRect = function (): DOMRect {
      if (this === iframe || this === overlay) return new DOMRect(0, 0, 800, 450);
      if (this instanceof doc.defaultView!.Element && this.classList.contains("box")) {
        return new DOMRect(-500, 40, 100, 40);
      }
      return new DOMRect(0, 0, 0, 0);
    };

    const win = doc.defaultView!;
    const realGetComputedStyle = win.getComputedStyle.bind(win);
    let styleReads = 0;
    win.getComputedStyle = ((el: Element, pseudo?: string | null) => {
      styleReads += 1;
      return realGetComputedStyle(el, pseudo ?? undefined);
    }) as typeof win.getComputedStyle;

    const sigRef = { current: "" } as React.MutableRefObject<string>;
    const elementsRef = { current: new Map<string, HTMLElement>() } as React.MutableRefObject<
      Map<string, HTMLElement>
    >;
    let rects: OffCanvasRect[] = [];
    try {
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
    } finally {
      win.getComputedStyle = realGetComputedStyle;
      iframe.remove();
      overlay.remove();
    }
    return { styleReads, markers: rects.length };
  }

  /** What burying the same cards 8 wrappers deeper costs, at `cardCount`. */
  function depthSurcharge(cardCount: number): number {
    return rebuildAtDepth(cardCount, 10).styleReads - rebuildAtDepth(cardCount, 2).styleReads;
  }

  // The load-bearing assertion, and it is INVARIANCE rather than a threshold: a
  // ceiling ("under 40 reads") passes on a small fixture and still degrades on
  // a real preview. Eight wrappers are shared by every card, so what they cost
  // is a property of the WRAPPERS. Asking each card about them separately makes
  // it a property of wrappers x cards, and that is the thing that has to stay
  // flat when the card count moves.
  it("pays for a deeper tree per added ancestor, not per ancestor per card", () => {
    expect(depthSurcharge(48)).toBe(depthSurcharge(24));
  });

  // Non-vacuity: the assertion above only means something if the fixture really
  // drove the per-element geometry path for every card at both depths.
  it("measures rebuilds that really did resolve every card's rect", () => {
    expect(rebuildAtDepth(24, 2).markers).toBe(24);
    expect(rebuildAtDepth(24, 10).markers).toBe(24);
  });
});
