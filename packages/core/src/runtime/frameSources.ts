import { exportClipWindow } from "../inline-scripts/parityContract";
import { sourceTimeAt } from "../speedRamp";
import { readElementRateSpec, readMediaStart } from "./playbackRate";
import { registerSeekCompletion } from "./adapters/seek-dispatch";
import { isClipVisibleAt } from "./clipWindow";
import type { RuntimeDeterministicAdapter } from "./types";

export interface FrameSource {
  element: Element;
  ready?: PromiseLike<unknown>;
  sourceRange?: { start: number; duration: number; fps: number };
  render: (sourceTime: number, signal: AbortSignal) => void | PromiseLike<unknown>;
  dispose?: () => void;
}

interface RegisteredSource {
  element: Element;
  ready: Promise<unknown>;
  seek: (time: number) => Promise<void>;
  dispose: () => void;
}

const sources = new Map<Element, RegisteredSource>();

export const hasFrameSources = (): boolean => sources.size > 0;

/** Bind a frame source to a timed host. Unregister before replacing its source. */
export function registerFrameSource(source: FrameSource): () => void {
  if (sources.has(source.element)) throw new Error("This element already has a frame source");
  const range = source.sourceRange;
  if (
    range &&
    (!Number.isFinite(range.start) ||
      range.start < 0 ||
      !Number.isFinite(range.duration) ||
      range.duration <= 0 ||
      !Number.isFinite(range.fps) ||
      range.fps <= 0)
  ) {
    throw new Error("Frame source ranges require a nonnegative start, positive duration and FPS");
  }
  const controller = new AbortController();
  const cancelled = new Promise<void>((resolve) => {
    controller.signal.addEventListener("abort", () => resolve(), { once: true });
  });
  const ready = Promise.race([Promise.resolve(source.ready), cancelled]);
  void ready.catch(() => {});
  let pending: number | null = null;
  let work: Promise<void> | null = null;
  const drain = async () => {
    let failure: { reason: unknown } | undefined;
    try {
      await ready;
      while (!controller.signal.aborted && pending !== null) {
        const time = pending;
        pending = null;
        try {
          await Promise.race([source.render(time, controller.signal), cancelled]);
        } catch (reason) {
          failure ??= { reason };
        }
      }
      if (failure) throw failure.reason;
    } finally {
      pending = null;
      work = null;
    }
  };
  const registered: RegisteredSource = {
    element: source.element,
    ready,
    seek(time) {
      pending = range
        ? range.start + Math.min(Math.max(0, time), Math.max(0, range.duration - 1 / range.fps))
        : time;
      work ??= drain();
      return work;
    },
    dispose() {
      if (controller.signal.aborted) return;
      controller.abort();
      pending = null;
      sources.delete(source.element);
      source.dispose?.();
    },
  };
  sources.set(source.element, registered);
  return registered.dispose;
}

export function createFrameSourceAdapter(timing: {
  start: (element: Element) => number;
  duration: (element: Element) => number | null;
  compositionDuration: () => number;
  canonicalFps: () => number;
  exportRenderSeek: () => boolean;
}): RuntimeDeterministicAdapter {
  const owned = new Set<RegisteredSource>();
  let readySources: RegisteredSource[] = [];
  let readiness: Promise<unknown> | null = null;
  const current = () => {
    for (const source of owned) {
      if (sources.get(source.element) !== source) owned.delete(source);
    }
    const connected: Array<[Element, RegisteredSource]> = [];
    for (const [element, source] of sources) {
      if (!element.isConnected) {
        source.dispose();
        continue;
      }
      if (!owned.has(source)) {
        owned.add(source);
        // Readiness trackers settle rejected setup; capture must also receive that failure.
        registerSeekCompletion(source.ready);
      }
      connected.push([element, source]);
    }
    return connected;
  };
  const removals = new MutationObserver(() => {
    current();
  });
  removals.observe(document, { childList: true, subtree: true });
  return {
    name: "frame-source",
    discover: () => {
      current();
    },
    pause: () => {},
    seek: ({ time }) => {
      for (const [element, source] of current()) {
        const start = timing.start(element);
        const duration = timing.duration(element);
        const end = start + (duration ?? Infinity);
        const clipWindow = timing.exportRenderSeek()
          ? exportClipWindow(start, end, timing.canonicalFps())
          : { start, end };
        if (!isClipVisibleAt(time, clipWindow.start, clipWindow.end, timing.compositionDuration()))
          continue;
        const localTime = Math.max(0, time - start);
        const sourceTime =
          readMediaStart(element) + sourceTimeAt(readElementRateSpec(element), localTime);
        registerSeekCompletion(source.seek(sourceTime));
      }
    },
    getReadyPromise: () => {
      const next = current().map(([, source]) => source);
      if (next.length === 0) return null;
      if (
        next.length !== readySources.length ||
        next.some((source, i) => source !== readySources[i])
      ) {
        readySources = next;
        readiness = Promise.all(next.map((source) => source.ready));
      }
      return readiness;
    },
    revert: () => {
      removals.disconnect();
      for (const source of owned) source.dispose();
      owned.clear();
    },
  };
}
