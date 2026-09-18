import { describe, expect, it, vi } from "vitest";
import {
  computeReadinessInput,
  mediaReadinessInput,
  paintAndIdleReadinessInput,
  scanPendingCompositionAssets,
  settleCompositionReadiness,
} from "./compositionReadiness.js";

function docWith(bodyHtml: string): Document {
  const doc = document.implementation.createHTMLDocument("");
  doc.body.innerHTML = bodyHtml;
  return doc;
}

// A same-origin composition iframe's document always has a defaultView; the
// two timing-based inputs need one to call requestAnimationFrame on, so
// `docWith` (a viewless DOMImplementation document, like the composition
// tag-scanning tests above use) can't exercise them.
function docWithFakeWindow(renderReady = false): {
  doc: Document;
  win: { __renderReady: boolean };
  fireFrame: (ts: number) => void;
} {
  let queue: Array<(ts: number) => void> = [];
  const win = {
    __renderReady: renderReady,
    requestAnimationFrame: (cb: (ts: number) => void) => {
      queue.push(cb);
      return queue.length;
    },
  };
  const fireFrame = (ts: number) => {
    const callbacks = queue;
    queue = [];
    callbacks.forEach((cb) => cb(ts));
  };
  const doc = { defaultView: win } as unknown as Document;
  return { doc, win, fireFrame };
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
});

describe("mediaReadinessInput", () => {
  it("returns null when there is nothing to wait on", () => {
    expect(mediaReadinessInput(docWith(""))).toBeNull();
  });
});

describe("computeReadinessInput", () => {
  it("returns null when the runtime already published __renderReady", () => {
    const { doc } = docWithFakeWindow(true);
    expect(computeReadinessInput(doc)).toBeNull();
  });

  it("returns null for a document with no view (nothing to poll)", () => {
    expect(computeReadinessInput(docWith(""))).toBeNull();
  });

  it("resolves once __renderReady flips true", async () => {
    vi.useFakeTimers();
    const { doc, win } = docWithFakeWindow(false);
    let resolved = false;
    computeReadinessInput(doc)!.then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(resolved).toBe(false);
    win.__renderReady = true;
    await vi.advanceTimersByTimeAsync(50);
    expect(resolved).toBe(true);
    vi.useRealTimers();
  });
});

function startPaintAndIdleTracking(): {
  fireFrame: (ts: number) => void;
  isResolved: () => boolean;
} {
  const { doc, fireFrame } = docWithFakeWindow();
  let resolved = false;
  paintAndIdleReadinessInput(doc)!.then(() => {
    resolved = true;
  });
  return { fireFrame, isResolved: () => resolved };
}

describe("paintAndIdleReadinessInput", () => {
  it("returns null for a document with no view (nothing to observe)", () => {
    expect(paintAndIdleReadinessInput(docWith(""))).toBeNull();
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
});

describe("settleCompositionReadiness", () => {
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
