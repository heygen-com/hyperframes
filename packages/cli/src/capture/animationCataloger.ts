/**
 * Catalog all animations on a rendered page.
 *
 * Captures:
 * 1. Web Animations API — active animations with full keyframes + timing
 * 2. CSS animation/transition declarations via getComputedStyle
 * 3. IntersectionObserver targets (scroll-triggered elements)
 * 4. CDP Animation domain events
 *
 * The catalog is saved as animations.json and gives Claude Code
 * everything needed to recreate animations in GSAP.
 *
 * NOTE: Must be used on a page with ALL scripts running (not stripped).
 * Call setupAnimationCapture() BEFORE page.goto() for IO patching.
 * Call collectAnimationCatalog() AFTER page has loaded and settled.
 */

import type { Page, CDPSession } from "puppeteer-core";
import { isDegradableEvaluateTimeoutError, withRemainingBudget } from "./captureTimeout.js";
import { lazyScrollForCapture } from "./lazyScrollForCapture.js";

export interface AnimationCatalog {
  /** Active animations via document.getAnimations() — includes keyframes */
  webAnimations: WebAnimationEntry[];
  /** Elements with CSS animation/transition properties declared */
  cssDeclarations: CssAnimationEntry[];
  /** Elements being watched by IntersectionObserver (scroll triggers) */
  scrollTargets: ScrollTarget[];
  /** CDP Animation domain events captured during page lifecycle */
  cdpAnimations: CdpAnimationEntry[];
  /** Total counts summary */
  summary: {
    webAnimations: number;
    cssDeclarations: number;
    scrollTargets: number;
    cdpAnimations: number;
    canvases: number;
  };
}

export interface WebAnimationEntry {
  type: string;
  playState: string;
  animationName?: string;
  targetSelector?: string;
  targetRect?: { x: number; y: number; width: number; height: number };
  keyframes?: Array<Record<string, string | number | null>>;
  timing?: {
    duration: number;
    delay: number;
    iterations: number;
    easing: string;
    direction: string;
  };
}

export interface CssAnimationEntry {
  selector: string;
  animation?: { name: string; duration: string; easing: string };
  transition?: { property: string; duration: string };
}

export interface ScrollTarget {
  selector: string;
  rect: { top: number; height: number; width: number };
}

export interface CdpAnimationEntry {
  id: string;
  name: string;
  type: string;
  duration?: number;
  delay?: number;
}

/**
 * Set up animation capture hooks BEFORE navigating to the page.
 * This patches IntersectionObserver to track scroll-triggered elements.
 */
export async function setupAnimationCapture(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(`
    window.__hf_io_targets = [];
    var OrigIO = window.IntersectionObserver;
    window.IntersectionObserver = function(callback, options) {
      var observer = new OrigIO(callback, options);
      var origObserve = observer.observe.bind(observer);
      observer.observe = function(target) {
        var sel = target.id ? '#' + target.id : target.tagName.toLowerCase();
        if (target.className && typeof target.className === 'string') {
          var cls = Array.from(target.classList).slice(0, 2).join('.');
          if (cls) sel += '.' + cls;
        }
        try {
          var rect = target.getBoundingClientRect();
          window.__hf_io_targets.push({
            selector: sel,
            rect: { top: Math.round(rect.top + window.scrollY), height: Math.round(rect.height), width: Math.round(rect.width) }
          });
        } catch(e) {}
        return origObserve(target);
      };
      return observer;
    };
    window.IntersectionObserver.prototype = OrigIO.prototype;
  `);
}

/**
 * Start CDP Animation domain listener.
 * Returns the CDPSession and a reference to the captured array.
 */
export async function startCdpAnimationCapture(
  page: Page,
): Promise<{ cdp: CDPSession; animations: CdpAnimationEntry[] }> {
  const cdp = await page.createCDPSession();
  await cdp.send("Animation.enable");
  const animations: CdpAnimationEntry[] = [];

  cdp.on("Animation.animationStarted", (event: any) => {
    animations.push({
      id: event.animation.id,
      name: event.animation.name || "",
      type: event.animation.type,
      duration: event.animation.source?.duration,
      delay: event.animation.source?.delay,
    });
  });

  return { cdp, animations };
}

const EMPTY_ANIMATION_SCAN = {
  webAnimations: [] as WebAnimationEntry[],
  cssDeclarations: [] as CssAnimationEntry[],
  scrollTargets: [] as ScrollTarget[],
  canvasCount: 0,
};

export interface CollectAnimationCatalogOutcome {
  catalog: AnimationCatalog;
  timedOut: boolean;
}

export async function collectAnimationCatalog(
  page: Page,
  cdpAnimations: CdpAnimationEntry[],
  cdp: CDPSession,
  opts: { scrollBudgetMs?: number; evaluateBudgetMs?: number } = {},
): Promise<CollectAnimationCatalogOutcome> {
  const scrollBudgetMs = opts.scrollBudgetMs ?? 8_000;
  const evaluateBudgetMs = opts.evaluateBudgetMs ?? 15_000;
  const scroll = await lazyScrollForCapture(page, scrollBudgetMs);
  let timedOut = scroll.degraded || scroll.timedOut;

  let result = EMPTY_ANIMATION_SCAN;
  try {
    result = (await withRemainingBudget(
      page.evaluate(`(() => {
    var webAnimations = [];
    var cssDeclarations = [];

    try {
      var anims = document.getAnimations();
      webAnimations = anims.map(function(anim) {
        var r = { type: anim.constructor.name, playState: anim.playState, animationName: anim.animationName || null };
        var effect = anim.effect;
        if (effect && effect.target) {
          var t = effect.target;
          r.targetSelector = t.id ? '#' + t.id : t.tagName.toLowerCase();
          if (t.className && typeof t.className === 'string') {
            var cls = Array.from(t.classList).slice(0, 3).join('.');
            if (cls) r.targetSelector += '.' + cls;
          }
          try { r.targetRect = t.getBoundingClientRect().toJSON(); } catch(e) {}
        }
        if (effect && typeof effect.getKeyframes === 'function') {
          try { r.keyframes = effect.getKeyframes(); } catch(e) {}
        }
        if (effect && typeof effect.getComputedTiming === 'function') {
          try {
            var timing = effect.getComputedTiming();
            r.timing = { duration: timing.duration, delay: timing.delay, iterations: timing.iterations, easing: timing.easing, direction: timing.direction };
          } catch(e) {}
        }
        return r;
      });
    } catch(e) {}

    var allEls = document.querySelectorAll('*');
    for (var i = 0; i < allEls.length && i < 5000; i++) {
      var el = allEls[i];
      try {
        var cs = getComputedStyle(el);
        var hasAnim = cs.animationName && cs.animationName !== 'none';
        var hasTrans = cs.transitionProperty && cs.transitionProperty !== 'all' && cs.transitionProperty !== 'none' && cs.transitionDuration !== '0s';
        if (hasAnim || hasTrans) {
          var sel = el.id ? '#' + el.id : el.tagName.toLowerCase();
          if (el.className && typeof el.className === 'string') {
            var cls = Array.from(el.classList).slice(0, 2).join('.');
            if (cls) sel += '.' + cls;
          }
          var entry = { selector: sel };
          if (hasAnim) entry.animation = { name: cs.animationName, duration: cs.animationDuration, easing: cs.animationTimingFunction };
          if (hasTrans) entry.transition = { property: cs.transitionProperty, duration: cs.transitionDuration };
          cssDeclarations.push(entry);
        }
      } catch(e) {}
    }

    var scrollTargets = (window.__hf_io_targets || []).map(function(t) {
      return { selector: t.selector, rect: t.rect };
    });

    var canvasCount = document.querySelectorAll('canvas').length;

    return { webAnimations: webAnimations, cssDeclarations: cssDeclarations, scrollTargets: scrollTargets, canvasCount: canvasCount };
  })()`),
      evaluateBudgetMs,
      "animation-catalog",
    )) as typeof EMPTY_ANIMATION_SCAN;
  } catch (err) {
    if (!isDegradableEvaluateTimeoutError(err)) {
      throw err;
    }
    timedOut = true;
  }

  try {
    await cdp.send("Animation.disable");
  } catch {
    /* session may already be closed */
  }

  return {
    catalog: {
      webAnimations: result.webAnimations,
      cssDeclarations: result.cssDeclarations,
      scrollTargets: result.scrollTargets,
      cdpAnimations,
      summary: {
        webAnimations: result.webAnimations.length,
        cssDeclarations: result.cssDeclarations.length,
        scrollTargets: result.scrollTargets.length,
        cdpAnimations: cdpAnimations.length,
        canvases: result.canvasCount,
      },
    },
    timedOut,
  };
}
