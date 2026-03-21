import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWaapiAdapter } from "./waapi";

describe("waapi adapter", () => {
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
      pause: vi.fn(() => { throw new Error("invalid state"); }),
      currentTime: 0,
    };
    (document as any).getAnimations = vi.fn(() => [mockAnim]);

    const adapter = createWaapiAdapter();
    expect(() => adapter.seek({ time: 1 })).not.toThrow();

    delete (document as any).getAnimations;
  });

  it("discover is a no-op", () => {
    const adapter = createWaapiAdapter();
    expect(() => adapter.discover()).not.toThrow();
  });
});
