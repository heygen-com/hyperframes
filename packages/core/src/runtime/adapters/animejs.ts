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
export function createAnimeJsAdapter(): RuntimeDeterministicAdapter {
  return {
    name: "animejs",

    discover: () => {
      installHyperframesAnimeApi();
    },

    seek: (ctx) => {
      const timeMs = Math.max(0, (Number(ctx.time) || 0) * 1000);
      for (const entry of collectAnimeRegistrations()) {
        try {
          if (typeof entry.instance.seek === "function") {
            entry.instance.seek(timeMs);
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
      for (const entry of collectAnimeRegistrations()) {
        const durationMs = readDurationMs(entry.instance);
        if (durationMs == null) continue;
        maxSeconds = Math.max(maxSeconds, durationMs / 1000);
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
      const registration: RuntimeAnimeRegistration = {
        id,
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
    get: (id) => collectAnimeRegistrations().find((entry) => entry.id === id) ?? null,
    entries: () => collectAnimeRegistrations(),
    resolveLabel: (id, label) => {
      const entry = collectAnimeRegistrations().find((candidate) => candidate.id === id);
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
    return {
      id: value.id || fallbackId,
      instance: value.instance,
      labels: value.labels,
    };
  }
  if (isAnimeInstance(value)) {
    return {
      id: fallbackId,
      instance: value,
      labels: {},
    };
  }
  return null;
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
