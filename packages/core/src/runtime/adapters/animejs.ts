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
const PRIME_RESTORED_STYLE_PROPERTIES = ["visibility", "display"] as const;

function primeAnimeInstance(instance: RuntimeAnimeInstance): void {
  if (primedAnimeInstances.has(instance)) return;
  primedAnimeInstances.add(instance);
  if (typeof instance.seek !== "function") return;
  const durationMs = readDurationMs(instance) ?? PRIME_FALLBACK_MS;
  const keywordStyles = snapshotPrimeKeywordStyles();
  try {
    // anime.js 4.5.0: a timeline child added at position > 0 is not rendered
    // to its "from" value until the timeline has been sought to/past that
    // position once. A cold seek to an earlier time, such as frame 0 capture,
    // leaves it untouched. Prime once at discovery so every child is engaged
    // before any real seek. See U3-GATE-RESULT.md "Critical finding". This
    // mirrors the GSAP totalTime nudge in runtime/init.ts for its analogous
    // no-render-at-creation-position edge case.
    instance.seek(durationMs);
    instance.seek(0);
  } catch (err) {
    swallow("runtime.adapters.animejs.prime", err);
  } finally {
    restorePrimeKeywordStyles(keywordStyles);
  }
}

type PrimeRestoredStyleProperty = (typeof PRIME_RESTORED_STYLE_PROPERTIES)[number];

type PrimeKeywordStyleSnapshot = {
  element: HTMLElement | SVGElement;
  properties: {
    property: PrimeRestoredStyleProperty;
    value: string;
    priority: string;
  }[];
};

function snapshotPrimeKeywordStyles(): PrimeKeywordStyleSnapshot[] {
  if (typeof document === "undefined") return [];
  return Array.from(document.querySelectorAll<HTMLElement | SVGElement>("*"), (element) => ({
    element,
    properties: PRIME_RESTORED_STYLE_PROPERTIES.map((property) => ({
      property,
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    })),
  }));
}

function restorePrimeKeywordStyles(snapshot: PrimeKeywordStyleSnapshot[]): void {
  for (const { element, properties } of snapshot) {
    for (const { property, value, priority } of properties) {
      if (value) {
        element.style.setProperty(property, value, priority);
      } else {
        element.style.removeProperty(property);
      }
    }
  }
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
