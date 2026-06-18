import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMapboxAdapter } from "./mapbox";

type MapboxMapLike = {
  loaded: () => boolean;
  on: (event: string, cb: () => void) => void;
};

const mapWindow = window as Window & { __hfMapbox?: MapboxMapLike[] };

function createMockMap(opts?: { loaded?: boolean }): MapboxMapLike {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    loaded: vi.fn(() => opts?.loaded ?? false),
    on: vi.fn((event: string, cb: () => void) => {
      (listeners[event] ??= []).push(cb);
    }),
    _fire(event: string) {
      for (const cb of listeners[event] ?? []) cb();
    },
  } as MapboxMapLike & { _fire: (e: string) => void };
}

describe("mapbox adapter", () => {
  beforeEach(() => {
    delete mapWindow.__hfMapbox;
  });

  afterEach(() => {
    delete mapWindow.__hfMapbox;
  });

  it("has correct name", () => {
    expect(createMapboxAdapter().name).toBe("mapbox");
  });

  describe("getReadyPromise", () => {
    it("returns null when no maps registered", () => {
      const adapter = createMapboxAdapter();
      expect(adapter.getReadyPromise!()).toBeNull();
    });

    it("returns null when __hfMapbox is empty", () => {
      mapWindow.__hfMapbox = [];
      const adapter = createMapboxAdapter();
      expect(adapter.getReadyPromise!()).toBeNull();
    });

    it("resolves when map fires load event", async () => {
      const map = createMockMap() as MapboxMapLike & { _fire: (e: string) => void };
      mapWindow.__hfMapbox = [map];
      const adapter = createMapboxAdapter();
      const promise = adapter.getReadyPromise!();
      expect(promise).not.toBeNull();
      map._fire("load");
      await promise;
    });

    it("resolves immediately for already-loaded map", async () => {
      const map = createMockMap({ loaded: true });
      mapWindow.__hfMapbox = [map];
      const adapter = createMapboxAdapter();
      const promise = adapter.getReadyPromise!();
      expect(promise).not.toBeNull();
      await promise;
    });

    it("returns same promise on repeated calls (stable identity)", () => {
      const map = createMockMap();
      mapWindow.__hfMapbox = [map];
      const adapter = createMapboxAdapter();
      const p1 = adapter.getReadyPromise!();
      const p2 = adapter.getReadyPromise!();
      expect(p1).toBe(p2);
    });

    it("returns null after all maps have settled", async () => {
      const map = createMockMap({ loaded: true });
      mapWindow.__hfMapbox = [map];
      const adapter = createMapboxAdapter();
      await adapter.getReadyPromise!();
      expect(adapter.getReadyPromise!()).toBeNull();
    });

    it("handles mix of loaded and unloaded maps", async () => {
      const loaded = createMockMap({ loaded: true });
      const unloaded = createMockMap() as MapboxMapLike & { _fire: (e: string) => void };
      mapWindow.__hfMapbox = [loaded, unloaded];
      const adapter = createMapboxAdapter();
      const promise = adapter.getReadyPromise!();
      expect(promise).not.toBeNull();
      unloaded._fire("load");
      await promise;
      expect(adapter.getReadyPromise!()).toBeNull();
    });

    it("resolves via loaded() check when map finishes loading before subscribe", async () => {
      const racyMap = {
        loaded: vi.fn(() => true),
        on: vi.fn(),
      };
      mapWindow.__hfMapbox = [racyMap];
      const adapter = createMapboxAdapter();
      const promise = adapter.getReadyPromise!();
      expect(promise).not.toBeNull();
      await promise;
      expect(racyMap.on).not.toHaveBeenCalled();
    });
  });

  it("discover is a no-op", () => {
    const adapter = createMapboxAdapter();
    expect(() => adapter.discover()).not.toThrow();
  });

  it("seek is a no-op", () => {
    const adapter = createMapboxAdapter();
    expect(() => adapter.seek({ time: 1 })).not.toThrow();
  });
});
