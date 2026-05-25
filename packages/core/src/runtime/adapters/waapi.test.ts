import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createWaapiAdapter } from "./waapi";

describe("waapi adapter", () => {
  const originalDocument = (globalThis as { document?: unknown }).document;

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
    const mockAnim = { pause: vi.fn(), currentTime: 0 };
    (document as any).getAnimations = vi.fn(() => [mockAnim]);

    const adapter = createWaapiAdapter();
    adapter.seek({ time: 2.5 });

    expect(mockAnim.pause).toHaveBeenCalled();
    expect(mockAnim.currentTime).toBe(2500); // seconds → ms

    delete (document as any).getAnimations;
  });

  it("seek clamps negative time to 0", () => {
    const mockAnim = { pause: vi.fn(), currentTime: 0 };
    (document as any).getAnimations = vi.fn(() => [mockAnim]);

    const adapter = createWaapiAdapter();
    adapter.seek({ time: -3 });

    expect(mockAnim.currentTime).toBe(0);
    delete (document as any).getAnimations;
  });

  it("pause pauses all animations", () => {
    const mockAnim = { pause: vi.fn(), currentTime: 0 };
    (document as any).getAnimations = vi.fn(() => [mockAnim]);

    const adapter = createWaapiAdapter();
    adapter.pause();

    expect(mockAnim.pause).toHaveBeenCalled();
    delete (document as any).getAnimations;
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
    const mockAnim = {
      pause: vi.fn(() => {
        throw new Error("invalid state");
      }),
      currentTime: 0,
    };
    (document as any).getAnimations = vi.fn(() => [mockAnim]);

    const adapter = createWaapiAdapter();
    expect(() => adapter.seek({ time: 1 })).not.toThrow();

    delete (document as any).getAnimations;
  });

  it("still sets currentTime when pause throws for an unresolved infinite animation", () => {
    const mockAnim = {
      pause: vi.fn(() => {
        throw new Error("invalid state");
      }),
      currentTime: 0,
    };
    (document as any).getAnimations = vi.fn(() => [mockAnim]);

    const adapter = createWaapiAdapter();
    adapter.seek({ time: 1.25 });

    expect(mockAnim.currentTime).toBe(1250);
    delete (document as any).getAnimations;
  });

  it("discover is a no-op", () => {
    const adapter = createWaapiAdapter();
    expect(() => adapter.discover()).not.toThrow();
  });

  it("anchors newly discovered WAAPI animations to the seek where they first appear", () => {
    const existing = { pause: vi.fn(), currentTime: 0 };
    const dynamic = { pause: vi.fn(), currentTime: 0 };
    let includeDynamic = false;
    (document as any).getAnimations = vi.fn(() =>
      includeDynamic ? [existing, dynamic] : [existing],
    );

    const adapter = createWaapiAdapter();
    adapter.discover();

    adapter.seek({ time: 0.6 });
    expect(existing.currentTime).toBe(600);

    includeDynamic = true;
    adapter.seek({ time: 0.7 });
    expect(existing.currentTime).toBe(700);
    expect(dynamic.currentTime).toBe(0);

    adapter.seek({ time: 0.8 });
    expect(dynamic.currentTime).toBe(100);

    delete (document as any).getAnimations;
  });

  it("rebases newly discovered WAAPI animations that inherit absolute composition time", () => {
    const existing = { pause: vi.fn(), currentTime: 0 };
    const dynamic = { pause: vi.fn(), currentTime: 700 };
    let includeDynamic = false;
    (document as any).getAnimations = vi.fn(() =>
      includeDynamic ? [existing, dynamic] : [existing],
    );

    const adapter = createWaapiAdapter();
    adapter.discover();

    adapter.seek({ time: 0.6 });
    expect(existing.currentTime).toBe(600);

    includeDynamic = true;
    adapter.seek({ time: 0.7 });
    expect(dynamic.currentTime).toBe(0);

    adapter.seek({ time: 0.8 });
    expect(dynamic.currentTime).toBe(100);

    delete (document as any).getAnimations;
  });

  it("does not double-count inherited absolute time when discover runs again after time has advanced", () => {
    const existing = { pause: vi.fn(), currentTime: 0 };
    const dynamic = { pause: vi.fn(), currentTime: 700 };
    let includeDynamic = false;
    (document as any).getAnimations = vi.fn(() =>
      includeDynamic ? [existing, dynamic] : [existing],
    );

    const adapter = createWaapiAdapter();
    adapter.discover();

    adapter.seek({ time: 0.6 });
    expect(existing.currentTime).toBe(600);

    includeDynamic = true;
    adapter.discover();
    adapter.seek({ time: 0.7 });

    expect(dynamic.currentTime).toBe(200);

    delete (document as any).getAnimations;
  });
});
