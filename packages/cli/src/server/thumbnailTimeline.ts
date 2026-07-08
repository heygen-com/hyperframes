export function isThumbnailTimelineReady(): boolean {
  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  if (typeof window === "undefined") return false;

  const timelines = Reflect.get(window, "__timelines");
  if (isRecord(timelines) && Object.keys(timelines).length > 0) return true;

  // fallow-ignore-next-line code-duplication
  const api = Reflect.get(window, "hyperframesAnime");
  if (isRecord(api)) {
    const entries = Reflect.get(api, "entries");
    if (typeof entries === "function") {
      try {
        const result = entries.call(api);
        if (Array.isArray(result) && result.length > 0) return true;
      } catch {
        /* fall back to __hfAnime below */
      }
    }
  }

  const registry = Reflect.get(window, "__hfAnime");
  return isRecord(registry) && Object.keys(registry).length > 0;
}

// fallow-ignore-next-line complexity
export function seekThumbnailPage(t: number): void {
  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  function animeInstances(source: unknown): unknown[] {
    if (!isRecord(source)) return [];
    const values = Object.values(source);
    return values.map((value) => {
      if (isRecord(value)) {
        const instance = Reflect.get(value, "instance");
        if (isRecord(instance)) return instance;
      }
      return value;
    });
  }

  if (typeof window === "undefined") return;

  const player = Reflect.get(window, "__player");
  if (isRecord(player)) {
    const seek = Reflect.get(player, "seek");
    if (typeof seek === "function") {
      seek.call(player, t);
      return;
    }
  }

  const timelines = Reflect.get(window, "__timelines");
  if (isRecord(timelines) && Object.keys(timelines).length > 0) {
    for (const tl of Object.values(timelines)) {
      if (!isRecord(tl)) continue;
      const pause = Reflect.get(tl, "pause");
      if (typeof pause === "function") pause.call(tl, t);
    }
    const gsap = Reflect.get(window, "gsap");
    const ticker = isRecord(gsap) ? Reflect.get(gsap, "ticker") : undefined;
    const tick = isRecord(ticker) ? Reflect.get(ticker, "tick") : undefined;
    if (typeof tick === "function") tick.call(ticker);
    return;
  }

  // fallow-ignore-next-line code-duplication
  const api = Reflect.get(window, "hyperframesAnime");
  let instances: unknown[] = [];
  if (isRecord(api)) {
    const entries = Reflect.get(api, "entries");
    if (typeof entries === "function") {
      try {
        const result = entries.call(api);
        if (Array.isArray(result)) instances = animeInstances(result);
      } catch {
        instances = [];
      }
    }
  }
  if (instances.length === 0) {
    instances = animeInstances(Reflect.get(window, "__hfAnime"));
  }

  const timeMs = Math.max(0, (Number(t) || 0) * 1000);
  for (const instance of instances) {
    if (!isRecord(instance)) continue;
    const seek = Reflect.get(instance, "seek");
    if (typeof seek === "function") seek.call(instance, timeMs);
  }
}
