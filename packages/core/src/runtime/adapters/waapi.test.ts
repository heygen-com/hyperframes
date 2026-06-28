import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createWaapiAdapter } from "./waapi";

describe("waapi adapter", () => {
  const originalDocument = (globalThis as { document?: unknown }).document;

  const makeAnimation = (currentTime = 0) => ({
    addEventListener: vi.fn(),
    pause: vi.fn(),
    currentTime,
  });

  const setAnimations = (items: Array<ReturnType<typeof makeAnimation>>) => {
    const getAnimations = vi.fn(() => items);
    (document as any).getAnimations = getAnimations;
    return getAnimations;
  };

  const makeDynamicDiscoveryFixture = (dynamicStartMs = 0) => {
    const existing = makeAnimation();
    const dynamic = makeAnimation(dynamicStartMs);
    let includeDynamic = false;
    (document as any).getAnimations = vi.fn(() =>
      includeDynamic ? [existing, dynamic] : [existing],
    );

    const adapter = createWaapiAdapter();
    adapter.discover();
    adapter.seek({ time: 0.6 });
    expect(existing.currentTime).toBe(600);

    return {
      adapter,
      dynamic,
      revealDynamic: () => {
        includeDynamic = true;
      },
    };
  };

  beforeEach(() => {
    (globalThis as { document?: unknown }).document = {
      getAnimations: vi.fn(() => []),
    };
  });

  afterEach(() => {
    if (originalDocument === undefined) {
      delete (globalThis as { document?: unknown }).document;
      return;
    }

    (globalThis as { document?: unknown }).document = originalDocument;
  });

  it("has correct name", () => {
    expect(createWaapiAdapter().name).toBe("waapi");
  });

  it("seek pauses and sets currentTime on all animations", () => {
    const mockAnim = makeAnimation();
    setAnimations([mockAnim]);

    const adapter = createWaapiAdapter();
    adapter.seek({ time: 2.5 });

    expect(mockAnim.pause).toHaveBeenCalled();
    expect(mockAnim.currentTime).toBe(2500); // seconds → ms
  });

  it("seek clamps negative time to 0", () => {
    const mockAnim = makeAnimation();
    setAnimations([mockAnim]);

    const adapter = createWaapiAdapter();
    adapter.seek({ time: -3 });

    expect(mockAnim.currentTime).toBe(0);
  });

  it("pause pauses all animations", () => {
    const mockAnim = makeAnimation();
    setAnimations([mockAnim]);

    const adapter = createWaapiAdapter();
    adapter.pause();

    expect(mockAnim.pause).toHaveBeenCalled();
  });

  it("handles missing getAnimations API", () => {
    const original = document.getAnimations;
    (document as Record<string, unknown>).getAnimations = undefined;

    const adapter = createWaapiAdapter();
    expect(() => adapter.seek({ time: 1 })).not.toThrow();
    expect(() => adapter.pause()).not.toThrow();

    document.getAnimations = original;
  });

  it("handles animation that throws on pause", () => {
    const mockAnim = makeAnimation();
    mockAnim.pause.mockImplementation(() => {
      throw new Error("invalid state");
    });
    setAnimations([mockAnim]);

    const adapter = createWaapiAdapter();
    expect(() => adapter.seek({ time: 1 })).not.toThrow();
  });

  it("still sets currentTime when pause throws for an unresolved infinite animation", () => {
    const mockAnim = makeAnimation();
    mockAnim.pause.mockImplementation(() => {
      throw new Error("invalid state");
    });
    setAnimations([mockAnim]);

    const adapter = createWaapiAdapter();
    adapter.seek({ time: 1.25 });

    expect(mockAnim.currentTime).toBe(1250);
  });

  it("discover is a no-op", () => {
    const adapter = createWaapiAdapter();
    expect(() => adapter.discover()).not.toThrow();
  });

  it.each([
    ["relative start", 0],
    ["inherited absolute composition time", 700],
  ])("anchors newly discovered WAAPI animations with %s", (_label, dynamicStartMs) => {
    const { adapter, dynamic, revealDynamic } = makeDynamicDiscoveryFixture(dynamicStartMs);

    revealDynamic();
    adapter.seek({ time: 0.7 });
    expect(dynamic.currentTime).toBe(0);

    adapter.seek({ time: 0.8 });
    expect(dynamic.currentTime).toBe(100);
  });

  it("does not double-count inherited absolute time when discover runs again after time has advanced", () => {
    const { adapter, dynamic, revealDynamic } = makeDynamicDiscoveryFixture(700);

    revealDynamic();
    adapter.discover();
    adapter.seek({ time: 0.7 });

    expect(dynamic.currentTime).toBe(200);
  });

  it("does not rescan document animations on every seek when discover found none", () => {
    const getAnimations = setAnimations([]);

    const adapter = createWaapiAdapter();
    adapter.discover();
    adapter.seek({ time: 0.1 });
    adapter.seek({ time: 0.2 });
    adapter.seek({ time: 0.3 });

    expect(getAnimations).toHaveBeenCalledTimes(1);
  });

  it("tracks WAAPI animations created after an empty discover via Element.animate", () => {
    const getAnimations = setAnimations([]);

    const originalElement = (globalThis as { Element?: unknown }).Element;
    const animation = makeAnimation();
    class MockElement {}
    (MockElement.prototype as { animate?: () => typeof animation }).animate = vi.fn(
      () => animation,
    );
    (globalThis as { Element?: unknown }).Element = MockElement;

    try {
      const adapter = createWaapiAdapter();
      adapter.discover();

      const el = new MockElement() as InstanceType<typeof MockElement> & {
        animate: () => typeof animation;
      };
      el.animate();
      adapter.seek({ time: 0.25 });

      expect(animation.currentTime).toBe(250);
      expect(animation.pause).toHaveBeenCalled();
      // The hook tracks the created animation; once WAAPI is active, the
      // adapter may resume scanning to catch sibling animations.
      expect(getAnimations).toHaveBeenCalledTimes(2);
    } finally {
      if (originalElement === undefined) {
        delete (globalThis as { Element?: unknown }).Element;
      } else {
        (globalThis as { Element?: unknown }).Element = originalElement;
      }
    }
  });

  it("drops finished lazy-tracked animations so empty scans stay skipped again", () => {
    const getAnimations = setAnimations([]);

    const originalElement = (globalThis as { Element?: unknown }).Element;
    const animation = makeAnimation();
    const listeners = new Map<string, EventListener>();
    animation.addEventListener.mockImplementation((type: string, listener: EventListener) => {
      listeners.set(type, listener);
    });
    class MockElement {}
    (MockElement.prototype as { animate?: () => typeof animation }).animate = vi.fn(
      () => animation,
    );
    (globalThis as { Element?: unknown }).Element = MockElement;

    const adapter = createWaapiAdapter();
    try {
      adapter.discover();

      const el = new MockElement() as InstanceType<typeof MockElement> & {
        animate: () => typeof animation;
      };
      el.animate();
      adapter.seek({ time: 0.25 });

      expect(animation.currentTime).toBe(250);
      expect(getAnimations).toHaveBeenCalledTimes(2);

      listeners.get("finish")?.({} as Event);
      adapter.seek({ time: 0.5 });

      expect(getAnimations).toHaveBeenCalledTimes(2);
      expect(animation.currentTime).toBe(250);
    } finally {
      adapter.revert?.();
      if (originalElement === undefined) {
        delete (globalThis as { Element?: unknown }).Element;
      } else {
        (globalThis as { Element?: unknown }).Element = originalElement;
      }
    }
  });

  it("revert restores the Element.animate hook", () => {
    const originalElement = (globalThis as { Element?: unknown }).Element;
    const animation = makeAnimation();
    const originalAnimate = vi.fn(() => animation);
    class MockElement {}
    (MockElement.prototype as { animate?: typeof originalAnimate }).animate = originalAnimate;
    (globalThis as { Element?: unknown }).Element = MockElement;

    const adapter = createWaapiAdapter();
    try {
      adapter.discover();

      expect((MockElement.prototype as { animate?: unknown }).animate).not.toBe(originalAnimate);

      adapter.revert?.();

      expect((MockElement.prototype as { animate?: unknown }).animate).toBe(originalAnimate);
      expect(
        (MockElement.prototype as { __hfOriginalAnimate?: unknown }).__hfOriginalAnimate,
      ).toBeUndefined();
    } finally {
      if (originalElement === undefined) {
        delete (globalThis as { Element?: unknown }).Element;
      } else {
        (globalThis as { Element?: unknown }).Element = originalElement;
      }
    }
  });
});
