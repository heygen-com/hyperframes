// fallow-ignore-file code-duplication
// (splitTopLevelWhitespace intentionally mirrors the studio-side copies in
// manualEditsDom.ts / manualEditsRenderScript.ts — this module ships inside
// the self-contained runtime bundle and cannot import studio code.)
/**
 * Editor position edits (SDK `moveElement`) applied at render time.
 *
 * The SDK's `moveElement` writes `data-x` / `data-y` plus a captured baseline
 * (`data-hf-edit-base-x` / `data-hf-edit-base-y` — the values before the first
 * edit). The runtime renders the edit as the DELTA between the two, via the
 * independent CSS `translate` longhand, so it composes additively with any
 * position the composition itself produces (GSAP tweens, `tl.set`, CSS).
 *
 * Why `translate` and why after timeline bind: GSAP folds a `translate` that
 * is present when it FIRST parses an element into its cached transform (and
 * an absolute tween then discards it on the animated axis — the per-axis loss
 * bug). A `translate` set AFTER that parse is never read, cleared, or baked
 * by GSAP 3.x on subsequent seeks, so a single application at bind time holds
 * for the whole timeline. Before the first apply, the element's transform
 * parse is primed (gsap.getProperty) so tweens and positioned set()s that
 * first RENDER later reuse the cache instead of folding the edit. Known
 * limitation: if GSAP itself loads only after the apply ran, a later tween's
 * first parse still folds the edit (the fold guard then skips re-apply and
 * emits position_edit_fold_skipped instead of double-applying).
 */

import { emitAnalyticsEvent } from "./analytics";

export const EDIT_BASE_X_ATTR = "data-hf-edit-base-x";
export const EDIT_BASE_Y_ATTR = "data-hf-edit-base-y";
export const EDIT_ORIGINAL_TRANSLATE_ATTR = "data-hf-edit-original-translate";

/**
 * Elements a position edit can apply to: HTML elements AND SVG graphics (authored `<text>` labels,
 * shapes, groups). Both expose `.style` and honor the CSS `translate` longhand in modern Chrome, so
 * the same delta→translate compose logic works for either. (SVG was previously excluded by an
 * `instanceof HTMLElement`-only guard, which silently dropped every move on an SVG element.)
 */
type StylableElement = HTMLElement | SVGElement;

const num = (value: string | null): number => {
  const n = parseFloat(value ?? "");
  return Number.isFinite(n) ? n : 0;
};

/** Split "10px 20px" / "calc(1px + 2px) 3px" on top-level whitespace only. */
const splitTopLevelWhitespace = (value: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value.trim()) {
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (/\s/.test(char) && depth === 0) {
      if (current) parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);
  return parts;
};

const PX_VALUE = /^-?(?:\d+(?:\.\d+)?|\.\d+)px$/;

/** Sum two lengths — numerically when both are plain px, via calc() otherwise. */
const addLengths = (a: string, b: string): string => {
  if (PX_VALUE.test(a) && PX_VALUE.test(b)) return `${parseFloat(a) + parseFloat(b)}px`;
  return `calc(${a} + ${b})`;
};

/** Compose the edit delta with the element's pre-edit translate value. */
export const composeTranslate = (original: string, x: string, y: string): string => {
  if (!original || original === "none") return `${x} ${y}`;
  const [ox, oy, oz] = splitTopLevelWhitespace(original);
  if (ox === undefined) return `${x} ${y}`;
  if (oy === undefined) return `${addLengths(ox, x)} ${y}`;
  const z = oz === undefined ? "" : ` ${oz}`;
  return `${addLengths(ox, x)} ${addLengths(oy, y)}${z}`;
};

/**
 * Force GSAP (when present) to parse and cache the element's transform BEFORE
 * the edit translate is written. GSAP folds a CSS `translate` it sees at an
 * element's first parse into its cached transform (losing it per-axis on
 * absolute tweens); once the cache exists, later tweens and positioned set()s
 * reuse it and never read the translate again. gsap.getProperty parses
 * without mutating the element. Best-effort — absent or failing GSAP is fine.
 */
const primeGsapTransformCache = (el: StylableElement): void => {
  try {
    const view = el.ownerDocument.defaultView as
      | (Window & { gsap?: { getProperty?: (t: Element, p: string) => unknown } })
      | null;
    view?.gsap?.getProperty?.(el, "x");
  } catch {
    // parse priming is an optimization, never a requirement
  }
};

/** The element's effective translate: inline if set, computed otherwise ("" = none). */
export const readCurrentTranslate = (el: StylableElement): string => {
  const inline = el.style.getPropertyValue("translate").trim();
  if (inline) return inline === "none" ? "" : inline;
  try {
    const view = el.ownerDocument.defaultView;
    const computed = view ? view.getComputedStyle(el).getPropertyValue("translate").trim() : "";
    return computed === "none" ? "" : computed;
  } catch {
    return "";
  }
};

/**
 * The translate value this module last wrote per element. When a re-apply
 * (timeline rebind) finds the element's inline translate no longer matching,
 * something else consumed it — in practice GSAP folding it into the cached
 * transform when a lazily-created tween first-parsed the element. Re-setting
 * it then would DOUBLE the offset on every axis the tween doesn't animate, so
 * the non-forced path skips instead (degrading to the documented fold-loss).
 */
const lastAppliedTranslate = new WeakMap<StylableElement, string>();

/**
 * Apply one element's position edit. Idempotent — the pre-edit translate is
 * captured exactly once (into EDIT_ORIGINAL_TRANSLATE_ATTR, empty string
 * meaning "none") on first application, and every application recomputes from
 * that baseline.
 *
 * `force` re-applies even when the previously written translate was clobbered
 * externally — used by editor commits, where the current inline translate is
 * the draft-composed one and must be overwritten.
 */
export function applyPositionEditToElement(el: StylableElement, opts?: { force?: boolean }): void {
  const previous = lastAppliedTranslate.get(el);
  if (
    !opts?.force &&
    previous !== undefined &&
    el.style.getPropertyValue("translate") !== previous
  ) {
    // Observable signal for the documented degradation — without it, a
    // fold-loss surfaces to users only as "my edit didn't stick".
    emitAnalyticsEvent("position_edit_fold_skipped", {
      hfId: el.getAttribute("data-hf-id"),
    });
    return;
  }
  const dx = num(el.getAttribute("data-x")) - num(el.getAttribute(EDIT_BASE_X_ATTR));
  const dy = num(el.getAttribute("data-y")) - num(el.getAttribute(EDIT_BASE_Y_ATTR));
  if (!el.hasAttribute(EDIT_ORIGINAL_TRANSLATE_ATTR)) {
    el.setAttribute(EDIT_ORIGINAL_TRANSLATE_ATTR, readCurrentTranslate(el));
  }
  if (previous === undefined) primeGsapTransformCache(el);
  const original = el.getAttribute(EDIT_ORIGINAL_TRANSLATE_ATTR) ?? "";
  const value = composeTranslate(original, `${dx}px`, `${dy}px`);
  el.style.setProperty("translate", value);
  lastAppliedTranslate.set(el, el.style.getPropertyValue("translate"));
}

/**
 * Apply all pending position edits in the document. Returns the number of
 * elements updated.
 *
 * Runs the RESET path first: an element still carrying the captured pre-edit
 * translate marker (EDIT_ORIGINAL_TRANSLATE_ATTR) but NO base attrs had its
 * edit undone — the attrs were removed, so it no longer matches the apply
 * selector, and the inline translate written by an earlier application would
 * stay orphaned (the element visually displaced after its edit was reverted).
 * Restore the captured translate and clear the marker so a later redo
 * re-captures a clean baseline.
 *
 * `force` forwards to applyPositionEditToElement: re-apply even when the
 * previously written translate was clobbered externally. Hosts replaying
 * undo/redo should force — after a reset the fold-guard's bookkeeping no
 * longer matches and the non-forced path would silently skip the redo.
 */
export function applyPositionEdits(doc: Document, opts?: { force?: boolean }): number {
  // Not `instanceof HTMLElement`: `doc` is frequently an iframe's document (the
  // SDK's edit preview, a host embedding a composition), and its elements are
  // HTMLElement instances of THAT frame's realm — never this module's. A
  // module-scope `instanceof HTMLElement` check silently no-ops on every element
  // cross-realm. Use the document's own realm's constructor; duck-type on
  // `.style` when defaultView is unavailable (a detached/synthetic document).
  const RealmHTMLElement = doc.defaultView?.HTMLElement;
  const RealmSVGElement = doc.defaultView?.SVGElement;
  // Stylable = HTML OR SVG element (SVG `<text>`/shapes are positioned via the same CSS `translate`
  // longhand). The old HTML-only check silently dropped every SVG move. Cross-realm safe (uses the
  // document's own realm constructors — see the note above); duck-type on `.style` when defaultView
  // is unavailable.
  const isStylable = (el: Element): el is StylableElement =>
    RealmHTMLElement || RealmSVGElement
      ? (RealmHTMLElement !== undefined && el instanceof RealmHTMLElement) ||
        (RealmSVGElement !== undefined && el instanceof RealmSVGElement)
      : typeof (el as HTMLElement).style?.setProperty === "function";

  const orphaned = doc.querySelectorAll(
    `[${EDIT_ORIGINAL_TRANSLATE_ATTR}]:not([${EDIT_BASE_X_ATTR}]):not([${EDIT_BASE_Y_ATTR}])`,
  );
  for (let i = 0; i < orphaned.length; i++) {
    const el = orphaned[i];
    if (el === undefined || !isStylable(el)) continue;
    const original = el.getAttribute(EDIT_ORIGINAL_TRANSLATE_ATTR) ?? "";
    if (original === "") {
      el.style.removeProperty("translate");
    } else {
      el.style.setProperty("translate", original);
    }
    el.removeAttribute(EDIT_ORIGINAL_TRANSLATE_ATTR);
    lastAppliedTranslate.delete(el);
  }

  const marked = doc.querySelectorAll(`[${EDIT_BASE_X_ATTR}], [${EDIT_BASE_Y_ATTR}]`);
  let applied = 0;
  for (let i = 0; i < marked.length; i++) {
    const el = marked[i];
    if (el === undefined || !isStylable(el)) continue;
    applyPositionEditToElement(el, opts);
    applied += 1;
  }
  return applied;
}

const SEEK_REAPPLY_WRAPPED = "__hfPositionEditsSeekReapplyWrapped";
type SeekFunction = (...args: unknown[]) => unknown;
const wrappedSeekFunctions = new WeakSet<SeekFunction>();
const observedSeekProperties = new WeakMap<object, Set<string>>();
const observedGlobalProperties = new WeakMap<object, Set<string>>();

type SeekWindow = Window &
  typeof globalThis & {
    __hf?: { seek?: (...args: unknown[]) => unknown };
    __player?: { renderSeek?: (...args: unknown[]) => unknown };
  };

/** Reapply SDK position edits after every render seek, including late-bound seeks. */
export function installPositionEditsSeekReapply(win: Window & typeof globalThis): void {
  const target = win as SeekWindow;
  const reapply = (): void => {
    try {
      applyPositionEdits(target.document);
    } catch {
      // A position edit must never break the render seek path.
    }
  };

  const isWrapped = (fn: unknown): fn is SeekFunction =>
    typeof fn === "function" &&
    (wrappedSeekFunctions.has(fn as SeekFunction) ||
      Boolean((fn as { [SEEK_REAPPLY_WRAPPED]?: boolean })[SEEK_REAPPLY_WRAPPED]));

  const markWrapped = (fn: SeekFunction): void => {
    wrappedSeekFunctions.add(fn);
    try {
      Object.defineProperty(fn, SEEK_REAPPLY_WRAPPED, { value: true });
    } catch {
      // The WeakSet keeps frozen functions from being wrapped repeatedly.
    }
  };

  const wrapFunction = (fn: unknown): unknown => {
    if (typeof fn !== "function" || isWrapped(fn)) return fn;
    const wrapped: SeekFunction = function (this: unknown, ...args: unknown[]): unknown {
      const result = fn.apply(this, args);
      reapply();
      return result;
    };
    markWrapped(wrapped);
    return wrapped;
  };

  const observeSeekProperty = (container: object, property: string): boolean => {
    let observed = observedSeekProperties.get(container);
    if (observed?.has(property)) return true;
    const descriptor = Object.getOwnPropertyDescriptor(container, property);
    if (descriptor?.configurable === false) {
      const current = (container as Record<string, unknown>)[property];
      if (typeof current === "function") {
        (container as Record<string, unknown>)[property] = wrapFunction(current);
        reapply();
      }
      return false;
    }

    let current = (container as Record<string, unknown>)[property];
    const originalSetter = descriptor?.set;
    Object.defineProperty(container, property, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get: () => current,
      set: (value: unknown) => {
        current = wrapFunction(value);
        originalSetter?.call(container, value);
      },
    });
    current = wrapFunction(current);
    observed ??= new Set<string>();
    observed.add(property);
    observedSeekProperties.set(container, observed);
    reapply();
    return true;
  };

  const observeGlobalContainer = (
    name: "__hf" | "__player",
    property: "seek" | "renderSeek",
  ): boolean => {
    let globals = observedGlobalProperties.get(target);
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    if (!globals?.has(name)) {
      if (descriptor?.configurable === false) {
        const current = target[name];
        return current ? observeSeekProperty(current, property) : false;
      }
      let value = target[name];
      Object.defineProperty(target, name, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get: () => value,
        set: (next: unknown) => {
          value = next as typeof value;
          if (value) observeSeekProperty(value, property);
        },
      });
      globals ??= new Set<string>();
      globals.add(name);
      observedGlobalProperties.set(target, globals);
    }
    const current = target[name];
    return current ? observeSeekProperty(current, property) : false;
  };

  const wrapAll = (): boolean => {
    const hfObserved = observeGlobalContainer("__hf", "seek");
    const playerObserved = observeGlobalContainer("__player", "renderSeek");
    return hfObserved && playerObserved;
  };

  if (wrapAll()) return;
  let remaining = 120;
  const interval = target.setInterval(() => {
    if (wrapAll()) {
      target.clearInterval(interval);
      return;
    }
    remaining -= 1;
    if (remaining <= 0) target.clearInterval(interval);
  }, 50);
}
