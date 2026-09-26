import { describe, expect, it, vi } from "vitest";
import {
  computeReadinessInput,
  mediaReadinessInput,
  paintAndIdleReadinessInput,
  scanPendingCompositionAssets,
  settleCompositionReadiness,
  settleFirstFrameCompositionReadiness,
} from "./compositionReadiness.js";
import { createRuntimeStartTimeResolver } from "./runtime/startResolver.js";
import { isRuntimeElementVisibleAt } from "./runtime/timeline.js";

function docWith(bodyHtml: string): Document {
  const doc = document.implementation.createHTMLDocument("");
  doc.body.innerHTML = bodyHtml;
  return doc;
}

// A same-origin composition iframe's document always has a defaultView; the
// two timing-based inputs need one to call requestAnimationFrame on, so
// `docWith` (a viewless DOMImplementation document, like the composition
// tag-scanning tests above use) can't exercise them.
function docWithFakeWindow(
  renderReady = false,
  hasRuntime = true,
): {
  doc: Document;
  win: { __renderReady: boolean; __hf?: Record<string, unknown> };
  fireFrame: (ts: number) => void;
  pendingFrameCount: () => number;
} {
  let queue = new Map<number, (ts: number) => void>();
  let nextId = 1;
  const win = {
    __renderReady: renderReady,
    __hf: hasRuntime ? {} : undefined,
    requestAnimationFrame: (cb: (ts: number) => void) => {
      const id = nextId++;
      queue.set(id, cb);
      return id;
    },
    cancelAnimationFrame: (id: number) => {
      queue.delete(id);
    },
  };
  const fireFrame = (ts: number) => {
    const callbacks = Array.from(queue.values());
    queue.clear();
    callbacks.forEach((cb) => cb(ts));
  };
  const doc = { defaultView: win } as unknown as Document;
  return { doc, win, fireFrame, pendingFrameCount: () => queue.size };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("scanPendingCompositionAssets", () => {
  it("reports nothing pending for an empty document", () => {
    const scan = scanPendingCompositionAssets(docWith(""));
    expect(scan).toEqual({ pendingMedia: [], pendingImages: [], fontsLoading: false });
  });

  it("finds a not-yet-decoded image as pending", () => {
    const scan = scanPendingCompositionAssets(docWith('<img src="a.png">'));
    expect(scan.pendingImages).toHaveLength(1);
  });

  it("scopes first-frame scans to assets active at t=0", () => {
    const doc = docWith(
      '<img id="first" data-start="0" data-duration="5" src="first.png">' +
        '<video id="later" data-start="30" data-duration="5" src="later.mp4"></video>',
    );
    const scan = scanPendingCompositionAssets(doc, { scope: "first-frame" });

    expect(scan.pendingImages.map((image) => image.id)).toEqual(["first"]);
    expect(scan.pendingMedia.map((media) => media.id)).toEqual([]);
  });

  it("keeps untimed media in the first-frame scan", () => {
    const doc = docWith('<video id="untimed" src="video.mp4"></video>');

    const scan = scanPendingCompositionAssets(doc, { scope: "first-frame" });

    expect(scan.pendingMedia.map((media) => media.id)).toEqual(["untimed"]);
  });

  it("keeps nested timing decisions aligned with the runtime visibility owner", () => {
    const doc = docWith(
      '<section data-start="30" data-duration="5"><video id="nested" src="later.mp4"></video></section>',
    );
    const nested = doc.querySelector<HTMLElement>("#nested")!;
    const resolver = createRuntimeStartTimeResolver({ documentRef: doc });
    const runtimeDecision = isRuntimeElementVisibleAt(doc.querySelector("section")!, {
      currentTime: 0,
      compositionDuration: Number.POSITIVE_INFINITY,
      canonicalFps: 30,
      exportRenderSeek: false,
      timelineRegistry: {},
      resolver,
    });

    expect(scanPendingCompositionAssets(doc, { scope: "first-frame" }).pendingMedia).toEqual([]);
    expect(runtimeDecision).toBe(false);
    expect(nested.closest("[data-start]")).not.toBeNull();
  });
});

describe("mediaReadinessInput", () => {
  it("returns null when there is nothing to wait on", () => {
    expect(mediaReadinessInput(docWith(""), new AbortController().signal)).toBeNull();
  });

  // 80 elements already errored (a missing asset) before this input attaches
  // its listeners — reproduces a real composition with many duplicate sfx tags.
  it("resolves media whose error already fired before this input ran, without waiting for the shared timeout", async () => {
    vi.useFakeTimers();
    const doc = docWith(
      Array.from({ length: 80 }, () => '<audio src="missing.mp3"></audio>').join(""),
    );
    for (const el of Array.from(doc.querySelectorAll("audio"))) {
      Object.defineProperty(el, "readyState", { value: 0, configurable: true });
      Object.defineProperty(el, "error", {
        value: { code: 4, message: "MEDIA_ELEMENT_ERROR: Format error" },
        configurable: true,
      });
    }

    const result = await new Promise((resolve) =>
      settleCompositionReadiness(doc, resolve, {
        inputs: [mediaReadinessInput],
        timeoutMs: 8000,
      }),
    );
    // No fake-timer advance needed: already-errored elements resolve
    // synchronously via the el.error check.
    expect(result).toEqual({ timedOut: false });
    vi.useRealTimers();
  });

  it("does not wait for a later first-frame video", async () => {
    const doc = docWith(
      '<img id="first" data-start="0" data-duration="5" src="first.png">' +
        '<video id="later" data-start="30" data-duration="5" src="later.mp4"></video>',
    );
    const image = doc.querySelector<HTMLImageElement>("#first")!;
    Object.defineProperty(image, "complete", { value: false });
    let resolveImage!: () => void;
    image.decode = () => new Promise<void>((resolve) => (resolveImage = resolve));
    const pending = mediaReadinessInput(doc, new AbortController().signal, {
      scope: "first-frame",
    });

    expect(pending).not.toBeNull();
    resolveImage();
    await expect(pending).resolves.toBeUndefined();
  });

  it("waits for later media in the default full scan", async () => {
    const doc = docWith(
      '<img id="first" data-start="0" data-duration="5" src="first.png">' +
        '<video id="later" data-start="30" data-duration="5" src="later.mp4"></video>',
    );
    const image = doc.querySelector<HTMLImageElement>("#first")!;
    const video = doc.querySelector<HTMLVideoElement>("#later")!;
    Object.defineProperty(image, "complete", { value: false });
    image.decode = () => Promise.resolve();
    Object.defineProperty(video, "readyState", { value: 0, configurable: true });
    const pending = mediaReadinessInput(doc, new AbortController().signal, { scope: "all" });

    let settled = false;
    pending?.then(() => {
      settled = true;
    });
    await flushMicrotasks();
    expect(settled).toBe(false);
    video.dispatchEvent(new Event("canplay"));
    await expect(pending).resolves.toBeUndefined();
  });

  it("neither waits for nor decodes a later scene's image, even in the full scan", () => {
    const doc = docWith(
      '<div data-start="30" data-duration="5"><img id="later" src="later.png"></div>',
    );
    const image = doc.querySelector<HTMLImageElement>("#later")!;
    Object.defineProperty(image, "complete", { value: false });
    image.decode = vi.fn().mockResolvedValue(undefined);

    expect(scanPendingCompositionAssets(doc, { scope: "all" }).pendingImages).toEqual([]);
    expect(mediaReadinessInput(doc, new AbortController().signal, { scope: "all" })).toBeNull();
    expect(image.decode).not.toHaveBeenCalled();
  });
});

describe("computeReadinessInput", () => {
  it("returns null when the runtime already published __renderReady", () => {
    const { doc } = docWithFakeWindow(true);
    expect(computeReadinessInput(doc, new AbortController().signal)).toBeNull();
  });

  it("returns null for a document with no view (nothing to poll)", () => {
    expect(computeReadinessInput(docWith(""), new AbortController().signal)).toBeNull();
  });

  it("returns null when no runtime ever ran (no window.__hf) instead of polling for __renderReady forever", () => {
    // A probe-only composition (plain video/native duration, no HyperFrames
    // runtime injected) never sets window.__hf, so __renderReady would also
    // never be set — this is the exact shape that used to poll for the full
    // 8s shared timeout on every single Play.
    const { doc } = docWithFakeWindow(false, false);
    expect(computeReadinessInput(doc, new AbortController().signal)).toBeNull();
  });

  it("resolves once __renderReady flips true", async () => {
    vi.useFakeTimers();
    const { doc, win } = docWithFakeWindow(false);
    let resolved = false;
    computeReadinessInput(doc, new AbortController().signal)!.then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(resolved).toBe(false);
    win.__renderReady = true;
    await vi.advanceTimersByTimeAsync(50);
    expect(resolved).toBe(true);
    vi.useRealTimers();
  });

  it("stops polling once aborted, and resolves without __renderReady ever flipping", async () => {
    vi.useFakeTimers();
    const { doc } = docWithFakeWindow(false);
    const controller = new AbortController();
    let resolved = false;
    computeReadinessInput(doc, controller.signal)!.then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(resolved).toBe(false);
    const pendingBefore = vi.getTimerCount();
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
    // The poll's own timer is cleared on abort, not just left to fire once more.
    expect(vi.getTimerCount()).toBe(pendingBefore - 1);
    vi.useRealTimers();
  });
});

function startPaintAndIdleTracking(signal: AbortSignal = new AbortController().signal): {
  fireFrame: (ts: number) => void;
  isResolved: () => boolean;
  pendingFrameCount: () => number;
} {
  const { doc, fireFrame, pendingFrameCount } = docWithFakeWindow();
  let resolved = false;
  paintAndIdleReadinessInput(doc, signal)!.then(() => {
    resolved = true;
  });
  return { fireFrame, isResolved: () => resolved, pendingFrameCount };
}

describe("paintAndIdleReadinessInput", () => {
  it("returns null for a document with no view (nothing to observe)", () => {
    expect(paintAndIdleReadinessInput(docWith(""), new AbortController().signal)).toBeNull();
  });

  it("settles on a host whose requestAnimationFrame calls back synchronously", async () => {
    let ts = 0;
    const win = { requestAnimationFrame: (cb: (t: number) => void) => (cb((ts += 16)), 1) };
    const doc = { defaultView: win } as unknown as Document;

    await expect(
      paintAndIdleReadinessInput(doc, new AbortController().signal),
    ).resolves.toBeUndefined();
  });

  it("waits for first paint, then two consecutive quiet frame gaps", async () => {
    const { fireFrame, isResolved } = startPaintAndIdleTracking();

    // First paint: two nested frames.
    fireFrame(0);
    await flushMicrotasks();
    fireFrame(16);
    await flushMicrotasks();
    expect(isResolved()).toBe(false);

    // First quiet gap (10ms < 50ms threshold) — one is not enough.
    fireFrame(26);
    await flushMicrotasks();
    expect(isResolved()).toBe(false);

    // Second consecutive quiet gap settles it.
    fireFrame(36);
    await flushMicrotasks();
    expect(isResolved()).toBe(true);
  });

  it("resets the quiet streak on a slow frame gap (the busy stretch itself)", async () => {
    const { fireFrame, isResolved } = startPaintAndIdleTracking();

    fireFrame(0); // first paint scheduled
    await flushMicrotasks();
    fireFrame(16); // first paint presented, lastTs = 16
    await flushMicrotasks();

    fireFrame(26); // quiet gap 1 (10ms)
    await flushMicrotasks();
    fireFrame(626); // a 600ms stall — the busy stretch — resets the streak
    await flushMicrotasks();
    expect(isResolved()).toBe(false);

    fireFrame(636); // quiet gap 1 again
    await flushMicrotasks();
    expect(isResolved()).toBe(false);
    fireFrame(646); // quiet gap 2 — now it settles
    await flushMicrotasks();
    expect(isResolved()).toBe(true);
  });

  it("cancels its pending rAF and resolves once aborted mid-wait", async () => {
    const controller = new AbortController();
    const { fireFrame, isResolved, pendingFrameCount } = startPaintAndIdleTracking(
      controller.signal,
    );

    fireFrame(0); // first paint scheduled
    await flushMicrotasks();
    expect(pendingFrameCount()).toBe(1); // second first-paint frame in flight

    controller.abort();
    await flushMicrotasks();
    expect(isResolved()).toBe(true);
    expect(pendingFrameCount()).toBe(0); // the in-flight rAF was cancelled, not left pending
  });

  it("gives up and resolves after MAX_PAINT_WAIT_MS of steady sub-20fps painting, never reaching a quiet gap", async () => {
    // A composition rendering a real, steady 15fps (~66ms/frame) never
    // produces a sub-50ms gap — this is the exact shape that used to hang
    // paintAndIdleReadinessInput until settleCompositionReadiness's 8s
    // shared timeout won the race on every single Play.
    const { fireFrame, isResolved } = startPaintAndIdleTracking();
    const FRAME_GAP_MS = 66;

    let ts = 0;
    fireFrame(ts); // first paint scheduled
    await flushMicrotasks();
    ts += FRAME_GAP_MS;
    fireFrame(ts); // first paint presented, lastTs = 66
    await flushMicrotasks();

    while (ts < 1_500) {
      expect(isResolved()).toBe(false);
      ts += FRAME_GAP_MS;
      fireFrame(ts);
      await flushMicrotasks();
    }
    // The frame that crosses MAX_PAINT_WAIT_MS resolves on its own — no
    // quiet gap was ever produced, only elapsed steady-paint time.
    expect(isResolved()).toBe(true);
  });
});

describe("settleCompositionReadiness", () => {
  it("does not wait for a later video through the public first-frame path", async () => {
    const doc = docWith(
      '<img id="first" data-start="0" data-duration="5" src="first.png">' +
        '<video id="later" data-start="30" data-duration="5" src="later.mp4"></video>',
    );
    const image = doc.querySelector<HTMLImageElement>("#first")!;
    const video = doc.querySelector<HTMLVideoElement>("#later")!;
    Object.defineProperty(image, "complete", { value: false });
    let resolveImage!: () => void;
    image.decode = () => new Promise<void>((resolve) => (resolveImage = resolve));
    let resolveFonts!: () => void;
    Object.defineProperty(doc, "fonts", {
      configurable: true,
      value: {
        status: "loading",
        ready: new Promise<void>((resolve) => (resolveFonts = resolve)),
      },
    });
    Object.defineProperty(video, "readyState", { value: 0, configurable: true });

    let result: { timedOut: boolean } | undefined;
    settleFirstFrameCompositionReadiness(
      doc,
      (settled) => {
        result = settled;
      },
      { timeoutMs: 50 },
    );

    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(result).toBeUndefined();
    resolveImage();
    await flushMicrotasks();
    expect(result).toBeUndefined();
    resolveFonts();
    await flushMicrotasks();
    expect(result).toEqual({ timedOut: false });
  });

  it("keeps the explicit full-scan path waiting for a later video", async () => {
    const doc = docWith(
      '<img id="first" data-start="0" data-duration="5" src="first.png">' +
        '<video id="later" data-start="30" data-duration="5" src="later.mp4"></video>',
    );
    const image = doc.querySelector<HTMLImageElement>("#first")!;
    const video = doc.querySelector<HTMLVideoElement>("#later")!;
    Object.defineProperty(image, "complete", { value: true });
    Object.defineProperty(video, "readyState", { value: 0, configurable: true });

    let result: { timedOut: boolean } | undefined;
    settleCompositionReadiness(
      doc,
      (settled) => {
        result = settled;
      },
      { scope: "all", timeoutMs: 1 },
    );

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(result).toEqual({ timedOut: true });
  });

  it("defaults to media, compute and paint-and-idle together", async () => {
    vi.useFakeTimers();
    const { win, fireFrame } = docWithFakeWindow(false);
    const doc = docWith("");
    Object.defineProperty(doc, "defaultView", { value: win, configurable: true });
    let settled = false;
    settleCompositionReadiness(doc, () => {
      settled = true;
    });
    expect(settled).toBe(false); // paint-and-idle alone keeps this pending

    win.__renderReady = true; // compute settles once its poll observes the flag
    await vi.advanceTimersByTimeAsync(50);

    fireFrame(0);
    await vi.advanceTimersByTimeAsync(0);
    fireFrame(16);
    await vi.advanceTimersByTimeAsync(0);
    fireFrame(26);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false); // one quiet gap isn't enough
    fireFrame(36);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    vi.useRealTimers();
  });

  it("calls back synchronously, before returning, when nothing is pending", () => {
    let calledSync = false;
    settleCompositionReadiness(docWith(""), () => {
      calledSync = true;
    });
    // If this ever ran via a microtask instead, calledSync would still be
    // false right here — a caller that plays/enables playback immediately
    // after this call would see stale state, which is the exact regression
    // this test guards against.
    expect(calledSync).toBe(true);
  });

  it("calls back asynchronously when something is pending", () => {
    const doc = docWith('<img src="a.png">');
    const img = doc.querySelector("img")!;
    Object.defineProperty(img, "complete", { value: false });
    img.decode = vi.fn().mockResolvedValue(undefined);

    let calledSync = false;
    settleCompositionReadiness(doc, () => {
      calledSync = true;
    });
    expect(calledSync).toBe(false);
  });

  it("waits for a pending image to decode before settling", async () => {
    const doc = docWith('<img src="a.png">');
    const img = doc.querySelector("img")!;
    Object.defineProperty(img, "complete", { value: false });
    img.decode = vi.fn().mockResolvedValue(undefined);

    const result = await new Promise((resolve) => settleCompositionReadiness(doc, resolve));
    expect(result).toEqual({ timedOut: false });
    expect(img.decode).toHaveBeenCalled();
  });

  it("times out rather than waiting forever on a stuck asset", async () => {
    vi.useFakeTimers();
    const doc = docWith('<img src="a.png">');
    const img = doc.querySelector("img")!;
    Object.defineProperty(img, "complete", { value: false });
    img.decode = () => new Promise<void>(() => {}); // never resolves

    const pending = new Promise((resolve) =>
      settleCompositionReadiness(doc, resolve, { timeoutMs: 1000 }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toEqual({ timedOut: true });
    vi.useRealTimers();
  });
});
