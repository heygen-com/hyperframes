import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMediaPreloadManager } from "./mediaPreloader";

function mockMediaElement(attrs: {
  start: string;
  duration?: string;
  tag?: string;
}): HTMLMediaElement {
  const el = {
    tagName: (attrs.tag ?? "VIDEO").toUpperCase(),
    preload: "auto",
    readyState: 0,
    duration: Number.NaN,
    defaultPlaybackRate: 1,
    loop: false,
    src: `blob:mock-${attrs.start}`,
    dataset: {
      start: attrs.start,
      duration: attrs.duration,
    },
    hasAttribute: (name: string) => name === "data-start",
    getAttribute: (name: string) => {
      if (name === "data-start") return attrs.start;
      if (name === "data-duration") return attrs.duration ?? null;
      return null;
    },
    removeAttribute: (name: string) => {
      if (name === "src") {
        (el as Record<string, unknown>).src = "";
      }
    },
    closest: () => null,
    load: vi.fn(),
  } as unknown as HTMLMediaElement;
  return el;
}

function setupDOM(elements: HTMLMediaElement[]): void {
  const originalQuerySelector = document.querySelectorAll.bind(document);
  document.querySelectorAll = ((selector: string) => {
    if (selector === "video, audio") return elements as unknown as NodeListOf<Element>;
    return originalQuerySelector(selector);
  }) as typeof document.querySelectorAll;
}

function createTestFixture(
  count: number,
  options?: Parameters<typeof createMediaPreloadManager>[0],
) {
  const elements = Array.from({ length: count }, (_, i) =>
    mockMediaElement({ start: String(i * 5), duration: "5" }),
  );
  setupDOM(elements);
  const manager = createMediaPreloadManager(options);
  manager.refresh();
  return { elements, manager };
}

describe("createMediaPreloadManager", () => {
  let elements: HTMLMediaElement[];

  beforeEach(() => {
    elements = [];
  });

  it("is not lazy when fewer than 3 media elements", () => {
    elements = [
      mockMediaElement({ start: "0", duration: "5" }),
      mockMediaElement({ start: "5", duration: "5" }),
    ];
    setupDOM(elements);

    const manager = createMediaPreloadManager();
    manager.refresh();

    expect(manager.isLazy()).toBe(false);
  });

  it("activates lazy mode at exactly LAZY_THRESHOLD (3 elements)", () => {
    const { manager } = createTestFixture(3);
    expect(manager.isLazy()).toBe(true);
  });

  it("is not lazy with 2 elements (below threshold)", () => {
    const { manager } = createTestFixture(2);
    expect(manager.isLazy()).toBe(false);
  });

  it("activates lazy mode with 8 media elements", () => {
    const { manager } = createTestFixture(8);
    expect(manager.isLazy()).toBe(true);
  });

  it("activates lazy mode for 4-5 clip compositions without spurious eviction", () => {
    const f = createTestFixture(4);
    expect(f.manager.isLazy()).toBe(true);
    for (const el of f.elements) el.preload = "metadata";
    f.manager.sync(0);
    const promoted = f.elements.filter((el) => el.preload === "auto").length;
    expect(promoted).toBeGreaterThanOrEqual(2);
    expect(promoted).toBeLessThanOrEqual(4);
    f.manager.sync(0);
    const evicted = f.elements.filter(
      (el) =>
        el.preload === "metadata" && (el.load as ReturnType<typeof vi.fn>).mock.calls.length > 1,
    );
    expect(evicted.length).toBe(0);
  });

  it("sync promotes clips in the lookahead window", () => {
    const f = createTestFixture(8);
    for (const el of f.elements) el.preload = "metadata";
    f.manager.sync(0);
    expect(f.elements[0].preload).toBe("auto");
    expect(f.elements[1].preload).toBe("auto");
    expect(f.elements[7].preload).toBe("metadata");
  });

  it("preloadAroundTime promotes clips near seek target", () => {
    const f = createTestFixture(10);
    for (const el of f.elements) el.preload = "metadata";
    f.manager.preloadAroundTime(30);
    expect(f.elements[6].preload).toBe("auto");
    expect(f.elements[7].preload).toBe("auto");
    expect(f.elements[0].preload).toBe("metadata");
  });

  it("sync is a no-op when not lazy", () => {
    const f = createTestFixture(2);
    f.manager.sync(0);
    expect(f.manager.isLazy()).toBe(false);
  });

  it("guarantees at least LOOKAHEAD_MIN_CLIPS are promoted", () => {
    // Use 20s spacing so only 1 clip falls in the 10s lookahead window
    elements = Array.from({ length: 8 }, (_, i) =>
      mockMediaElement({ start: String(i * 20), duration: "5" }),
    );
    setupDOM(elements);
    const manager = createMediaPreloadManager();
    manager.refresh();
    for (const el of elements) el.preload = "metadata";
    manager.sync(0);
    expect(elements.filter((el) => el.preload === "auto").length).toBeGreaterThanOrEqual(2);
  });

  it("evicts clips when scrubbing away from them", () => {
    const f = createTestFixture(10);
    for (const el of f.elements) el.preload = "metadata";
    f.manager.sync(0);
    expect(f.elements[0].preload).toBe("auto");
    f.manager.sync(40);
    expect(f.elements[0].preload).toBe("metadata");
    expect(f.elements[0].src).toBe("");
    expect(f.elements[8].preload).toBe("auto");
  });

  it("restores src when re-promoting a previously evicted clip", () => {
    const f = createTestFixture(10);
    for (const el of f.elements) el.preload = "metadata";
    const originalSrc0 = f.elements[0].src;
    f.manager.sync(0);
    f.manager.sync(40);
    expect(f.elements[0].src).toBe("");
    f.manager.sync(0);
    expect(f.elements[0].src).toBe(originalSrc0);
    expect(f.elements[0].preload).toBe("auto");
  });

  it("does not exceed MAX_PROMOTED (5) clips", () => {
    const f = createTestFixture(10);
    for (const el of f.elements) el.preload = "metadata";
    f.manager.sync(0);
    expect(f.elements.filter((el) => el.preload === "auto").length).toBeLessThanOrEqual(5);
    f.manager.sync(25);
    expect(f.elements.filter((el) => el.preload === "auto").length).toBeLessThanOrEqual(5);
  });

  it("calls load() when evicting to release buffers", () => {
    const f = createTestFixture(10);
    for (const el of f.elements) el.preload = "metadata";
    f.manager.sync(0);
    const loadCallsBefore = (f.elements[0].load as ReturnType<typeof vi.fn>).mock.calls.length;
    f.manager.sync(40);
    expect((f.elements[0].load as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      loadCallsBefore,
    );
  });

  it("isLazy reports true with 6+ clips so caller can gate render-mode bypass", () => {
    const { manager } = createTestFixture(6);
    expect(manager.isLazy()).toBe(true);
  });

  it("calls onActivation when lazy mode activates", () => {
    const onActivation = vi.fn();
    createTestFixture(8, { onActivation });
    expect(onActivation).toHaveBeenCalledOnce();
    expect(onActivation).toHaveBeenCalledWith(8);
  });

  it("does not call onActivation below threshold", () => {
    const onActivation = vi.fn();
    createTestFixture(2, { onActivation });
    expect(onActivation).not.toHaveBeenCalled();
  });

  it("calls onActivation only once across multiple refreshes", () => {
    const onActivation = vi.fn();
    const { manager } = createTestFixture(8, { onActivation });
    manager.refresh();
    manager.refresh();
    expect(onActivation).toHaveBeenCalledOnce();
  });

  it("respects window.__HF_LAZY_PRELOAD_THRESHOLD override", () => {
    elements = Array.from({ length: 2 }, (_, i) =>
      mockMediaElement({ start: String(i * 5), duration: "5" }),
    );
    setupDOM(elements);

    // 2 elements is below the default threshold (3) but at our custom one
    (window as Record<string, unknown>).__HF_LAZY_PRELOAD_THRESHOLD = 2;

    const manager = createMediaPreloadManager();
    manager.refresh();

    expect(manager.isLazy()).toBe(true);

    // Clean up
    delete (window as Record<string, unknown>).__HF_LAZY_PRELOAD_THRESHOLD;
  });

  it("falls back to default threshold when __HF_LAZY_PRELOAD_THRESHOLD is not set", () => {
    elements = Array.from({ length: 2 }, (_, i) =>
      mockMediaElement({ start: String(i * 5), duration: "5" }),
    );
    setupDOM(elements);

    // Ensure it's not set
    delete (window as Record<string, unknown>).__HF_LAZY_PRELOAD_THRESHOLD;

    const manager = createMediaPreloadManager();
    manager.refresh();

    expect(manager.isLazy()).toBe(false);
  });
});
