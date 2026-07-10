import { resolveRuntimeLabelSeconds } from "../../inline-scripts/parityContract";
import type {
  RuntimeAnimeApi,
  RuntimeAnimeInstance,
  RuntimeAnimeLabelMap,
  RuntimeAnimeRegisterOptions,
  RuntimeAnimeRegistration,
  RuntimeAnimeRegistry,
  RuntimeDeterministicAdapter,
} from "../types";
import { swallow } from "../diagnostics";
import { createRuntimeStartTimeResolver } from "../startResolver";

/**
 * anime.js adapter for HyperFrames.
 *
 * anime.js v4 exposes a namespace object at `window.anime`; animations and
 * timelines are created with `anime.animate(...)` and `anime.createTimeline(...)`.
 * HyperFrames uses explicit registration as the first-party contract:
 *
 * ```html
 * <script src="https://cdn.jsdelivr.net/npm/animejs@4.5.0/dist/bundles/anime.umd.min.js"></script>
 * <script>
 *   const tl = anime.createTimeline({ autoplay: false });
 *   tl.add(".box", { x: 300, duration: 2000 }, 0);
 *   hyperframesAnime.register("main", tl, { labels: { intro: 0, outro: 2 } });
 * </script>
 * ```
 *
 * `window.__hfAnime = [instance]` is still read as a legacy compatibility
 * source, but keyed registration is the authoritative runtime contract.
 */
const primedAnimeInstances = new WeakSet<RuntimeAnimeInstance>();

export function createAnimeJsAdapter(): RuntimeDeterministicAdapter {
  return {
    name: "animejs",

    discover: () => {
      installHyperframesAnimeApi();
    },

    seek: (ctx) => {
      const globalTimeSeconds = Math.max(0, Number(ctx.time) || 0);
      const resolvers = createAnimeRuntimeTimingResolvers();
      for (const entry of collectAnimeRegistrations()) {
        try {
          if (typeof entry.instance.seek === "function") {
            entry.instance.seek(resolveAnimeSeekTimeMs(entry, globalTimeSeconds, resolvers));
          }
        } catch (err) {
          swallow("runtime.adapters.animejs.site1", err);
        }
      }
    },

    pause: () => {
      for (const entry of collectAnimeRegistrations()) {
        try {
          if (typeof entry.instance.pause === "function") {
            entry.instance.pause();
          }
        } catch (err) {
          swallow("runtime.adapters.animejs.site2", err);
        }
      }
    },

    play: () => {
      for (const entry of collectAnimeRegistrations()) {
        try {
          if (typeof entry.instance.play === "function") {
            entry.instance.play();
          }
        } catch (err) {
          swallow("runtime.adapters.animejs.site3", err);
        }
      }
    },

    revert: () => {
      // Do not clear __hfAnime; instances are owned by the composition.
    },

    getInferredDurationSeconds: () => {
      let maxSeconds = 0;
      const resolvers = createAnimeRuntimeTimingResolvers();
      for (const entry of collectAnimeRegistrations()) {
        const host = findAnimeCompositionHost(entry);
        const durationMs = resolveAnimeDurationMs(entry, host, resolvers.authoredDurations);
        if (durationMs == null) continue;
        const startSeconds = host ? resolvers.starts.resolveStartForElement(host, 0) : 0;
        maxSeconds = Math.max(maxSeconds, startSeconds + durationMs / 1000);
      }
      return maxSeconds > 0 ? maxSeconds : null;
    },
  };
}

export function installHyperframesAnimeApi(): RuntimeAnimeApi {
  const win: AnimeWindow = window;
  if (win.hyperframesAnime) {
    ensureAnimeRegistry();
    if (win.__hyperframes) {
      win.__hyperframes.hyperframesAnime = win.hyperframesAnime;
    }
    return win.hyperframesAnime;
  }

  const api: RuntimeAnimeApi = {
    register: (id, instance, options) => {
      const registry = ensureAnimeRegistry();
      if (Reflect.get(registry, id)) {
        console.warn(`[hyperframes] Replacing anime.js registration "${id}"`);
      }
      primeAnimeInstance(instance);
      const registration: RuntimeAnimeRegistration = {
        id,
        registryKey: id,
        instance,
        labels: normalizeLabels(options),
      };
      Reflect.set(registry, id, registration);
      notifyAnimeRegistered(id);
      return registration;
    },
    unregister: (id) => {
      const registry = ensureAnimeRegistry();
      Reflect.deleteProperty(registry, id);
    },
    get: (id) =>
      collectAnimeRegistrations().find((entry) => entry.id === id || entry.registryKey === id) ??
      null,
    entries: () => collectAnimeRegistrations(),
    resolveLabel: (id, label) => {
      const entry = collectAnimeRegistrations().find(
        (candidate) => candidate.id === id || candidate.registryKey === id,
      );
      return resolveRuntimeLabelSeconds(entry?.labels, label);
    },
  };

  ensureAnimeRegistry();
  installAnimeNoneClipPathGuard();
  win.hyperframesAnime = api;
  if (win.__hyperframes) {
    win.__hyperframes.hyperframesAnime = api;
  }
  return api;
}

function ensureAnimeRegistry(): RuntimeAnimeRegistry {
  const win: AnimeWindow = window;
  if (win.__hfAnime) {
    return win.__hfAnime;
  }

  const registry: RuntimeAnimeInstance[] = [];
  win.__hfAnime = registry;
  return registry;
}

function collectAnimeRegistrations(): RuntimeAnimeRegistration[] {
  const win: AnimeWindow = window;
  const registry = win.__hfAnime;
  const entries: RuntimeAnimeRegistration[] = [];
  if (!registry) return entries;

  for (const [id, value] of Object.entries(registry)) {
    const fallbackId = Array.isArray(registry) && isArrayIndexKey(id) ? `legacy-${id}` : id;
    const normalized = normalizeRegistration(fallbackId, value);
    if (normalized) entries.push(normalized);
  }
  return entries;
}

function isArrayIndexKey(value: string): boolean {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && String(index) === value;
}

function normalizeRegistration(
  fallbackId: string,
  value: RuntimeAnimeRegistration | RuntimeAnimeInstance | undefined,
): RuntimeAnimeRegistration | null {
  if (!value) return null;
  if (isAnimeRegistration(value)) {
    primeAnimeInstance(value.instance);
    return {
      id: value.id || fallbackId,
      registryKey: value.registryKey || fallbackId,
      instance: value.instance,
      labels: value.labels,
    };
  }
  if (isAnimeInstance(value)) {
    primeAnimeInstance(value);
    return {
      id: fallbackId,
      registryKey: fallbackId,
      instance: value,
      labels: {},
    };
  }
  return null;
}

type AnimeStartTimeResolver = ReturnType<typeof createRuntimeStartTimeResolver>;

type AnimeTimingResolvers = {
  starts: AnimeStartTimeResolver;
  authoredDurations: AnimeStartTimeResolver;
};

function createAnimeRuntimeTimingResolvers(): AnimeTimingResolvers {
  const win: AnimeWindow = window;
  return {
    starts: createRuntimeStartTimeResolver({
      timelineRegistry: win.__timelines ?? {},
      includeAuthoredTimingAttrs: true,
    }),
    authoredDurations: createRuntimeStartTimeResolver({
      timelineRegistry: {},
      includeAuthoredTimingAttrs: true,
    }),
  };
}

function resolveAnimeSeekTimeMs(
  entry: RuntimeAnimeRegistration,
  globalTimeSeconds: number,
  resolvers: AnimeTimingResolvers,
): number {
  const host = findAnimeCompositionHost(entry);
  const startSeconds = host ? resolvers.starts.resolveStartForElement(host, 0) : 0;
  const localTimeMs = secondsToMilliseconds(globalTimeSeconds - startSeconds);
  const durationMs = resolveAnimeDurationMs(entry, host, resolvers.authoredDurations);
  return durationMs == null ? localTimeMs : Math.min(localTimeMs, durationMs);
}

function resolveAnimeDurationMs(
  entry: RuntimeAnimeRegistration,
  host: Element | null,
  resolver: AnimeStartTimeResolver,
): number | null {
  if (host) {
    const hostDuration = resolver.resolveDurationForElement(host);
    if (hostDuration != null && hostDuration > 0) {
      return secondsToMilliseconds(hostDuration);
    }
  }
  return readDurationMs(entry.instance);
}

function secondsToMilliseconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.max(0, Math.round(seconds * 1_000_000_000) / 1_000_000);
}

function findAnimeCompositionHost(entry: RuntimeAnimeRegistration): Element | null {
  if (typeof document === "undefined") return null;
  for (const compositionId of getAnimeCompositionIdCandidates(entry)) {
    const host = document.querySelector(
      `[data-composition-id="${escapeCssAttributeValue(compositionId)}"]`,
    );
    if (host) return host;
  }
  return null;
}

function getAnimeCompositionIdCandidates(entry: RuntimeAnimeRegistration): string[] {
  const candidates: string[] = [];
  appendAnimeCompositionIdCandidates(candidates, entry.registryKey);
  appendAnimeCompositionIdCandidates(candidates, entry.id);
  return candidates;
}

function appendAnimeCompositionIdCandidates(candidates: string[], rawId: string | undefined): void {
  if (!rawId) return;
  appendUniqueCandidate(candidates, rawId);
  const scopeSeparatorIndex = rawId.indexOf("::");
  if (scopeSeparatorIndex > 0) {
    appendUniqueCandidate(candidates, rawId.slice(0, scopeSeparatorIndex));
  }
}

function appendUniqueCandidate(candidates: string[], value: string): void {
  if (!candidates.includes(value)) candidates.push(value);
}

function escapeCssAttributeValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Fallback priming distance for duck-typed wrappers that expose seek() but no
// readable duration (legacy `window.__hfAnime.push({seek,pause,play})`
// registrations). anime.js clamps seek to the timeline duration, so a large
// value engages every child regardless of actual length.
const PRIME_FALLBACK_MS = 36_000_000;
const PRIME_ZERO_EPSILON_MS = 0.001;

const TRANSFORM_DECOMPOSED_PROPERTIES = new Set([
  "translateX",
  "translateY",
  "scale",
  "scaleX",
  "scaleY",
  "rotate",
]);

type TransformDecomposition = Partial<Record<string, number>>;

const lastKnownCircleClipPathByElement = new WeakMap<Element, string>();
const CIRCLE_CLIP_PATH_CENTER_PATTERN = /circle\(\s*[\d.]+%\s+at\s+([\d.]+%\s+[\d.]+%)\s*\)/i;

// anime.js v4.5.0 cannot correctly resolve a literal "none" target for
// clip-path when a preceding tween on the same target used a structured
// circle() shape: it silently re-templates "none" as a zeroed copy of the
// prior shape (confirmed via internal tween inspection: `_toNumbers` become
// `[0, 0, 0]` reusing the prior circle() string template), rendering a
// near-fully-clipped black/empty box instead of a fully revealed one. Patch
// every timeline's `.add` to rewrite a literal "none" into an equivalent
// fully-open circle BEFORE anime.js ever parses it, sidestepping the bug
// with a value anime already interpolates correctly.
function installAnimeNoneClipPathGuard(): void {
  const win: AnimeWindow = window;
  const animeGlobal = win.anime as
    | (AnimeGlobal & { __hfNoneClipPathGuardInstalled?: boolean })
    | undefined;
  if (!animeGlobal || typeof animeGlobal.createTimeline !== "function") return;
  if (animeGlobal.__hfNoneClipPathGuardInstalled) return;
  animeGlobal.__hfNoneClipPathGuardInstalled = true;

  const realCreateTimeline = animeGlobal.createTimeline.bind(animeGlobal);
  animeGlobal.createTimeline = (...args: unknown[]) => {
    const timeline = realCreateTimeline(...args);
    if (isRecord(timeline)) patchTimelineAddForNoneClipPath(timeline);
    return timeline;
  };
}

function patchTimelineAddForNoneClipPath(timeline: Record<string, unknown>): void {
  const realAdd = timeline.add;
  if (typeof realAdd !== "function") return;
  timeline.add = function patchedAdd(
    this: Record<string, unknown>,
    targets: unknown,
    params: unknown,
    position?: unknown,
  ) {
    rewriteNoneClipPathParams(targets, params);
    return (realAdd as (...args: unknown[]) => unknown).call(this, targets, params, position);
  };
}

function rewriteNoneClipPathParams(targets: unknown, params: unknown): void {
  if (!isRecord(params)) return;
  const key = "clipPath" in params ? "clipPath" : "clip-path" in params ? "clip-path" : null;
  if (!key) return;
  const value = Reflect.get(params, key);
  if (typeof value !== "string") return;

  for (const element of resolveAnimeTargetElements(targets)) {
    if (value.trim().toLowerCase() === "none") {
      const priorShape = lastKnownCircleClipPathByElement.get(element);
      const rewritten = rewriteNoneClipPathValue(priorShape);
      if (rewritten) {
        Reflect.set(params, key, rewritten);
        lastKnownCircleClipPathByElement.set(element, rewritten);
      }
    } else {
      lastKnownCircleClipPathByElement.set(element, value);
    }
  }
}

function rewriteNoneClipPathValue(priorShape: string | undefined): string | null {
  if (!priorShape) return null;
  const match = CIRCLE_CLIP_PATH_CENTER_PATTERN.exec(priorShape);
  if (!match) return null;
  return `circle(150% at ${match[1]})`;
}

function resolveAnimeTargetElements(targets: unknown): Element[] {
  if (targets instanceof Element) return [targets];
  if (typeof targets === "string") {
    try {
      return Array.from(document.querySelectorAll(targets));
    } catch (err) {
      swallow("runtime.adapters.animejs.site6", err);
      return [];
    }
  }
  if (Array.isArray(targets) || targets instanceof NodeList) {
    return Array.from(targets as ArrayLike<unknown>).filter(
      (item): item is Element => item instanceof Element,
    );
  }
  return [];
}

// anime.js v4.5.0's implicit "from" resolution for decomposed transform
// sub-properties (translateX/Y, scale, rotate, ...) authored without an
// explicit `[from, to]` array does not read the element's CSS-cascaded
// `transform` value — it silently defaults to identity (translateX/Y=0,
// scale=1, rotate=0), rendering the element at (or near) its target value
// from the very first frame regardless of the authored CSS starting state
// (e.g. `.node { transform: translate(-50%, -50%) scale(0); }`). This
// mutates each affected tween's internal `_fromNumber`/`_number` fields —
// read at render time as the tween's "from" value — with the correct
// CSS-cascaded value BEFORE the instance's very first seek, so every
// subsequent render (including the prime-then-restore dance below) computes
// the right interpolation across the tween's whole lifecycle.
function correctImplicitTransformFromValues(instance: RuntimeAnimeInstance): void {
  const seen = new WeakSet<object>();
  const decomposedByTarget = new WeakMap<Element, TransformDecomposition>();
  visitAnimeRenderable(instance, seen, (node) => {
    correctImplicitTransformFromValueForNode(node, decomposedByTarget);
  });
}

function correctImplicitTransformFromValueForNode(
  node: Record<string, unknown>,
  decomposedByTarget: WeakMap<Element, TransformDecomposition>,
): void {
  const property = readStringProperty(node, "property");
  if (!property || !TRANSFORM_DECOMPOSED_PROPERTIES.has(property)) return;
  const target = Reflect.get(node, "target");
  if (!isStyleElement(target)) return;
  if (readBooleanishProperty(node, "_hasFromValue")) return;
  if (typeof Reflect.get(node, "_fromNumber") !== "number") return;

  applyCorrectedTransformFromValue(node, target, property, decomposedByTarget);
}

function applyCorrectedTransformFromValue(
  node: Record<string, unknown>,
  target: HTMLElement | SVGElement,
  property: string,
  decomposedByTarget: WeakMap<Element, TransformDecomposition>,
): void {
  let decomposition = decomposedByTarget.get(target);
  if (!decomposition) {
    decomposition = decomposeCurrentTransform(target);
    decomposedByTarget.set(target, decomposition);
  }
  const currentValue = decomposition[property];
  if (currentValue == null || !Number.isFinite(currentValue)) return;

  const unit = Reflect.get(node, "_unit");
  const correctedFrom =
    unit === "%" ? toPercentOfBox(target, property, currentValue) : currentValue;
  if (!Number.isFinite(correctedFrom)) return;

  Reflect.set(node, "_fromNumber", correctedFrom);
  Reflect.set(node, "_number", correctedFrom);
}

function decomposeCurrentTransform(target: HTMLElement | SVGElement): TransformDecomposition {
  try {
    if (typeof DOMMatrixReadOnly === "undefined" || typeof getComputedStyle === "undefined") {
      return {};
    }
    const computed = getComputedStyle(target).transform;
    if (!computed || computed === "none") {
      return { translateX: 0, translateY: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0 };
    }
    const matrix = new DOMMatrixReadOnly(computed);
    return {
      translateX: matrix.e,
      translateY: matrix.f,
      scale: Math.hypot(matrix.a, matrix.b),
      scaleX: Math.hypot(matrix.a, matrix.b),
      scaleY: Math.hypot(matrix.c, matrix.d),
      rotate: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI,
    };
  } catch (err) {
    swallow("runtime.adapters.animejs.site4", err);
    return {};
  }
}

function toPercentOfBox(
  target: HTMLElement | SVGElement,
  property: string,
  pxValue: number,
): number {
  if (!(target instanceof HTMLElement)) return pxValue;
  const basis = property === "translateY" ? target.offsetHeight : target.offsetWidth;
  return basis > 0 ? (pxValue / basis) * 100 : pxValue;
}

function primeAnimeInstance(instance: RuntimeAnimeInstance): void {
  if (primedAnimeInstances.has(instance)) return;
  primedAnimeInstances.add(instance);
  if (typeof instance.seek !== "function") return;
  correctImplicitTransformFromValues(instance);
  const durationMs = readDurationMs(instance) ?? PRIME_FALLBACK_MS;
  const inlineStylesBeforePrime = snapshotPrimeInlineStyles();
  const styleTimings = collectPrimeStylePropertyTimings(instance);
  let inlineStylesAfterDuration: PrimeInlineStyleSnapshot | null = null;
  let inlineStylesAfterZero: PrimeInlineStyleSnapshot | null = null;
  try {
    // anime.js 4.5.0: a timeline child added at position > 0 is not rendered
    // to its "from" value until the timeline has been sought to/past that
    // position once. A cold seek to an earlier time, such as frame 0 capture,
    // leaves it untouched. Prime once at discovery so every child is engaged
    // before any real seek. See U3-GATE-RESULT.md "Critical finding". This
    // mirrors the GSAP totalTime nudge in runtime/init.ts for its analogous
    // no-render-at-creation-position edge case.
    instance.seek(durationMs);
    inlineStylesAfterDuration = snapshotPrimeInlineStyles();
    instance.seek(0);
    inlineStylesAfterZero = snapshotPrimeInlineStyles();
  } catch (err) {
    swallow("runtime.adapters.animejs.prime", err);
  } finally {
    restorePrimeInlineStyles({
      beforePrime: inlineStylesBeforePrime,
      afterDuration: inlineStylesAfterDuration,
      afterZero: inlineStylesAfterZero,
      styleTimings,
    });
  }
}

type PrimeInlineStyleValue = {
  value: string;
  priority: string;
};

type PrimeInlineStyleProperties = Map<string, PrimeInlineStyleValue>;
type PrimeInlineStyleSnapshot = Map<HTMLElement | SVGElement, PrimeInlineStyleProperties>;

type PrimeStylePropertyTiming = {
  earliestStartTime: number | null;
  earliestHasFromValue: boolean;
};

type PrimeStylePropertyTimings = WeakMap<
  HTMLElement | SVGElement,
  Map<string, PrimeStylePropertyTiming>
>;

type RestorePrimeInlineStylesOptions = {
  beforePrime: PrimeInlineStyleSnapshot;
  afterDuration: PrimeInlineStyleSnapshot | null;
  afterZero: PrimeInlineStyleSnapshot | null;
  styleTimings: PrimeStylePropertyTimings;
};

type PrimeInlineStyleRestoreSnapshots = {
  beforePrime: PrimeInlineStyleSnapshot;
  durationStyles: PrimeInlineStyleSnapshot;
  currentStyles: PrimeInlineStyleSnapshot;
  styleTimings: PrimeStylePropertyTimings;
};

type PrimeInlineElementRestoreSnapshots = {
  beforeProperties: PrimeInlineStyleProperties | undefined;
  durationProperties: PrimeInlineStyleProperties | undefined;
  currentProperties: PrimeInlineStyleProperties | undefined;
};

function snapshotPrimeInlineStyles(): PrimeInlineStyleSnapshot {
  const snapshot: PrimeInlineStyleSnapshot = new Map();
  if (typeof document === "undefined") return snapshot;

  for (const element of document.querySelectorAll<HTMLElement | SVGElement>("*")) {
    const properties: PrimeInlineStyleProperties = new Map();
    const { style } = element;
    for (let index = 0; index < style.length; index += 1) {
      const property = style.item(index);
      if (!property) continue;
      properties.set(property, {
        value: style.getPropertyValue(property),
        priority: style.getPropertyPriority(property),
      });
    }
    snapshot.set(element, properties);
  }
  return snapshot;
}

function restorePrimeInlineStyles(options: RestorePrimeInlineStylesOptions): void {
  const snapshots = createPrimeInlineStyleRestoreSnapshots(options);
  const elements = collectPrimeStyleElements(
    snapshots.beforePrime,
    snapshots.durationStyles,
    snapshots.currentStyles,
  );

  for (const element of elements) {
    restorePrimeInlineStylesForElement(element, snapshots);
  }
}

function createPrimeInlineStyleRestoreSnapshots(
  options: RestorePrimeInlineStylesOptions,
): PrimeInlineStyleRestoreSnapshots {
  const currentStyles = options.afterZero ?? snapshotPrimeInlineStyles();
  return {
    beforePrime: options.beforePrime,
    durationStyles: options.afterDuration ?? currentStyles,
    currentStyles,
    styleTimings: options.styleTimings,
  };
}

function restorePrimeInlineStylesForElement(
  element: HTMLElement | SVGElement,
  snapshots: PrimeInlineStyleRestoreSnapshots,
): void {
  const elementSnapshots = getPrimeInlineElementRestoreSnapshots(element, snapshots);
  const properties = collectPrimeInlineStylePropertyNames(
    elementSnapshots.beforeProperties,
    elementSnapshots.durationProperties,
    elementSnapshots.currentProperties,
  );

  for (const property of properties) {
    restorePrimeInlineStylePropertyIfNeeded(element, property, elementSnapshots, snapshots);
  }
}

function getPrimeInlineElementRestoreSnapshots(
  element: HTMLElement | SVGElement,
  snapshots: PrimeInlineStyleRestoreSnapshots,
): PrimeInlineElementRestoreSnapshots {
  return {
    beforeProperties: snapshots.beforePrime.get(element),
    durationProperties: snapshots.durationStyles.get(element),
    currentProperties: snapshots.currentStyles.get(element),
  };
}

function restorePrimeInlineStylePropertyIfNeeded(
  element: HTMLElement | SVGElement,
  property: string,
  elementSnapshots: PrimeInlineElementRestoreSnapshots,
  snapshots: PrimeInlineStyleRestoreSnapshots,
): void {
  const beforeValue = getPrimeInlineStyleValue(elementSnapshots.beforeProperties, property);
  if (
    !shouldRestorePrimeInlineStyleProperty({
      element,
      property,
      beforeValue,
      durationValue: getPrimeInlineStyleValue(elementSnapshots.durationProperties, property),
      currentValue: getPrimeInlineStyleValue(elementSnapshots.currentProperties, property),
      styleTimings: snapshots.styleTimings,
    })
  ) {
    return;
  }

  restorePrimeInlineStyleProperty(element, property, beforeValue);
}

function getPrimeInlineStyleValue(
  properties: PrimeInlineStyleProperties | undefined,
  property: string,
): PrimeInlineStyleValue | null {
  return properties?.get(property) ?? null;
}

function collectPrimeStyleElements(
  beforePrime: PrimeInlineStyleSnapshot,
  afterDuration: PrimeInlineStyleSnapshot,
  afterZero: PrimeInlineStyleSnapshot,
): Set<HTMLElement | SVGElement> {
  const elements = new Set<HTMLElement | SVGElement>();
  for (const element of beforePrime.keys()) elements.add(element);
  for (const element of afterDuration.keys()) elements.add(element);
  for (const element of afterZero.keys()) elements.add(element);
  return elements;
}

function collectPrimeInlineStylePropertyNames(
  beforePrime: PrimeInlineStyleProperties | undefined,
  afterDuration: PrimeInlineStyleProperties | undefined,
  afterZero: PrimeInlineStyleProperties | undefined,
): Set<string> {
  const properties = new Set<string>();
  if (beforePrime) {
    for (const property of beforePrime.keys()) properties.add(property);
  }
  if (afterDuration) {
    for (const property of afterDuration.keys()) properties.add(property);
  }
  if (afterZero) {
    for (const property of afterZero.keys()) properties.add(property);
  }
  return properties;
}

type ShouldRestorePrimeInlineStylePropertyOptions = {
  element: HTMLElement | SVGElement;
  property: string;
  beforeValue: PrimeInlineStyleValue | null;
  durationValue: PrimeInlineStyleValue | null;
  currentValue: PrimeInlineStyleValue | null;
  styleTimings: PrimeStylePropertyTimings;
};

function shouldRestorePrimeInlineStyleProperty(
  options: ShouldRestorePrimeInlineStylePropertyOptions,
): boolean {
  const { element, property, beforeValue, durationValue, currentValue, styleTimings } = options;
  const timing = styleTimings.get(element)?.get(property);
  if (timing) {
    return (
      timing.earliestStartTime != null &&
      timing.earliestStartTime > PRIME_ZERO_EPSILON_MS &&
      !timing.earliestHasFromValue
    );
  }

  if (!isPrimeFallbackRestoredProperty(property)) return false;
  return (
    currentValue != null &&
    primeInlineStyleValuesEqual(durationValue, currentValue) &&
    !primeInlineStyleValuesEqual(beforeValue, currentValue)
  );
}

function restorePrimeInlineStyleProperty(
  element: HTMLElement | SVGElement,
  property: string,
  value: PrimeInlineStyleValue | null,
): void {
  if (value) {
    element.style.setProperty(property, value.value, value.priority);
  } else {
    element.style.removeProperty(property);
  }
  if (element.getAttribute("style") === "") {
    element.removeAttribute("style");
  }
}

function primeInlineStyleValuesEqual(
  a: PrimeInlineStyleValue | null,
  b: PrimeInlineStyleValue | null,
): boolean {
  return a?.value === b?.value && a?.priority === b?.priority;
}

function isPrimeFallbackRestoredProperty(property: string): boolean {
  return property === "visibility" || property === "display";
}

function collectPrimeStylePropertyTimings(
  instance: RuntimeAnimeInstance,
): PrimeStylePropertyTimings {
  const timings: PrimeStylePropertyTimings = new WeakMap();
  const seen = new WeakSet<object>();
  visitAnimeRenderable(instance, seen, (node) => {
    recordPrimeStyleTweenTiming(node, timings);
  });
  return timings;
}

function visitAnimeRenderable(
  value: unknown,
  seen: WeakSet<object>,
  visitor: (node: Record<string, unknown>) => void,
): void {
  if (!isRecord(value)) return;
  if (seen.has(value)) return;
  seen.add(value);
  visitor(value);

  let child = readRecord(value, "_head");
  while (child) {
    visitAnimeRenderable(child, seen, visitor);
    child = readRecord(child, "_next");
  }
}

function recordPrimeStyleTweenTiming(
  node: Record<string, unknown>,
  timings: PrimeStylePropertyTimings,
): void {
  const target = Reflect.get(node, "target");
  if (!isStyleElement(target)) return;

  const rawProperty = readStringProperty(node, "property");
  if (!rawProperty) return;

  const startTime = readFiniteNumberProperty(node, "_absoluteStartTime");
  if (startTime == null) return;

  const property = canonicalStylePropertyName(rawProperty);
  const timing = ensurePrimeStylePropertyTiming(timings, target, property);
  const hasFromValue = readBooleanishProperty(node, "_hasFromValue");
  if (
    timing.earliestStartTime == null ||
    startTime < timing.earliestStartTime - PRIME_ZERO_EPSILON_MS
  ) {
    timing.earliestStartTime = startTime;
    timing.earliestHasFromValue = hasFromValue;
  } else if (Math.abs(startTime - timing.earliestStartTime) <= PRIME_ZERO_EPSILON_MS) {
    timing.earliestHasFromValue ||= hasFromValue;
  }
}

function ensurePrimeStylePropertyTiming(
  timings: PrimeStylePropertyTimings,
  element: HTMLElement | SVGElement,
  property: string,
): PrimeStylePropertyTiming {
  let properties = timings.get(element);
  if (!properties) {
    properties = new Map();
    timings.set(element, properties);
  }

  let timing = properties.get(property);
  if (!timing) {
    timing = {
      earliestStartTime: null,
      earliestHasFromValue: false,
    };
    properties.set(property, timing);
  }
  return timing;
}

function canonicalStylePropertyName(property: string): string {
  if (property.startsWith("--")) return property;
  return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).toLowerCase();
}

function readRecord(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const child = Reflect.get(value, key);
  return isRecord(child) ? child : null;
}

function readStringProperty(value: Record<string, unknown>, key: string): string | null {
  const raw = Reflect.get(value, key);
  return typeof raw === "string" && raw ? raw : null;
}

function readFiniteNumberProperty(value: Record<string, unknown>, key: string): number | null {
  const raw = Reflect.get(value, key);
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function readBooleanishProperty(value: Record<string, unknown>, key: string): boolean {
  const raw = Reflect.get(value, key);
  return raw === true || raw === 1;
}

function isStyleElement(value: unknown): value is HTMLElement | SVGElement {
  return (
    (typeof HTMLElement !== "undefined" && value instanceof HTMLElement) ||
    (typeof SVGElement !== "undefined" && value instanceof SVGElement)
  );
}

function normalizeLabels(options: RuntimeAnimeRegisterOptions | undefined): RuntimeAnimeLabelMap {
  const labels: RuntimeAnimeLabelMap = {};
  const raw = options?.labels;
  if (!raw) return labels;
  for (const key of Object.keys(raw)) {
    const seconds = resolveRuntimeLabelSeconds(raw, key);
    if (seconds != null) labels[key] = seconds;
  }
  return labels;
}

function readDurationMs(instance: RuntimeAnimeInstance): number | null {
  const totalDuration = readNumericProperty(instance, "totalDuration");
  const duration = totalDuration ?? readNumericProperty(instance, "duration");
  return duration != null && duration > 0 ? duration : null;
}

function readNumericProperty(instance: RuntimeAnimeInstance, key: "duration" | "totalDuration") {
  const value = instance[key];
  try {
    const raw = typeof value === "function" ? value.call(instance) : value;
    const numberValue = Number(raw);
    return Number.isFinite(numberValue) ? numberValue : null;
  } catch (err) {
    swallow("runtime.adapters.animejs.duration", err);
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAnimeInstance(value: unknown): value is RuntimeAnimeInstance {
  if (!isRecord(value)) return false;
  return (
    typeof value.seek === "function" ||
    typeof value.pause === "function" ||
    typeof value.play === "function" ||
    "duration" in value ||
    "totalDuration" in value
  );
}

function isAnimeRegistration(value: unknown): value is RuntimeAnimeRegistration {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && isAnimeInstance(value.instance);
}

function notifyAnimeRegistered(id: string): void {
  try {
    window.dispatchEvent(new CustomEvent("hf-anime-registered", { detail: { id } }));
  } catch (err) {
    swallow("runtime.adapters.animejs.notify", err);
  }
}

type AnimeGlobal = {
  createTimeline?: (...args: unknown[]) => unknown;
  animate?: (...args: unknown[]) => unknown;
  engine?: unknown;
};

interface AnimeWindow extends Window {
  anime?: AnimeGlobal;
  __hfAnime?: RuntimeAnimeRegistry;
  hyperframesAnime?: RuntimeAnimeApi;
  __hyperframes?: {
    hyperframesAnime?: RuntimeAnimeApi;
  };
}
