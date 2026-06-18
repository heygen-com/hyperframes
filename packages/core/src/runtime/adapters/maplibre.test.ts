import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMaplibreAdapter } from "./maplibre";

type MaplibreMapLike = {
  loaded: () => boolean;
  on: (event: string, cb: () => void) => void;
};

const mapWindow = window as Window & { __hfMaplibre?: MaplibreMapLike[] };

function createMockMap(opts?: {
  loaded?: boolean;
}): MaplibreMapLike & { _fire: (e: string) => void } {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    loaded: vi.fn(() => opts?.loaded ?? false),
    on: vi.fn((event: string, cb: () => void) => {
      (listeners[event] ??= []).push(cb);
    }),
    _fire(event: string) {
      for (const cb of listeners[event] ?? []) cb();
    },
  };
}

describe("maplibre adapter", () => {
  beforeEach(() => {
    delete mapWindow.__hfMaplibre;
  });

  afterEach(() => {
    delete mapWindow.__hfMaplibre;
  });

  it("has correct name", () => {
    expect(createMaplibreAdapter().name).toBe("maplibre");
  });

  describe("getReadyPromise", () => {
    it("returns null when no maps registered", () => {
      const adapter = createMaplibreAdapter();
      expect(adapter.getReadyPromise!()).toBeNull();
    });

    it("returns null when __hfMaplibre is empty", () => {
      mapWindow.__hfMaplibre = [];
      const adapter = createMaplibreAdapter();
      expect(adapter.getReadyPromise!()).toBeNull();
    });

    it("resolves when map fires load event", async () => {
      const map = createMockMap();
      mapWindow.__hfMaplibre = [map];
      const adapter = createMaplibreAdapter();
      const promise = adapter.getReadyPromise!();
      expect(promise).not.toBeNull();
      map._fire("load");
      await promise;
    });

    it("resolves immediately for already-loaded map", async () => {
      const map = createMockMap({ loaded: true });
      mapWindow.__hfMaplibre = [map];
      const adapter = createMaplibreAdapter();
      const promise = adapter.getReadyPromise!();
      expect(promise).not.toBeNull();
      await promise;
    });

    it("returns same promise on repeated calls (stable identity)", () => {
      const map = createMockMap();
      mapWindow.__hfMaplibre = [map];
      const adapter = createMaplibreAdapter();
      const p1 = adapter.getReadyPromise!();
      const p2 = adapter.getReadyPromise!();
      expect(p1).toBe(p2);
    });

    it("returns null after all maps have settled", async () => {
      const map = createMockMap({ loaded: true });
      mapWindow.__hfMaplibre = [map];
      const adapter = createMaplibreAdapter();
      await adapter.getReadyPromise!();
      expect(adapter.getReadyPromise!()).toBeNull();
    });

    it("handles mix of loaded and unloaded maps", async () => {
      const loaded = createMockMap({ loaded: true });
      const unloaded = createMockMap();
      mapWindow.__hfMaplibre = [loaded, unloaded];
      const adapter = createMaplibreAdapter();
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
      mapWindow.__hfMaplibre = [racyMap];
      const adapter = createMaplibreAdapter();
      const promise = adapter.getReadyPromise!();
      expect(promise).not.toBeNull();
      await promise;
      expect(racyMap.on).not.toHaveBeenCalled();
    });
  });

  it("discover is a no-op", () => {
    const adapter = createMaplibreAdapter();
    expect(() => adapter.discover()).not.toThrow();
  });

  it("seek is a no-op", () => {
    const adapter = createMaplibreAdapter();
    expect(() => adapter.seek({ time: 1 })).not.toThrow();
  });
});
