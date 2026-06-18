import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createGoogleMapsAdapter } from "./google-maps";

type GoogleMapLike = {
  addListener: (event: string, cb: () => void) => { remove: () => void };
};

const mapWindow = window as Window & { __hfGoogleMaps?: GoogleMapLike[] };

function createMockMap(): GoogleMapLike & { _fire: (e: string) => void } {
  const listeners: Record<string, { cb: () => void; handle: { remove: () => void } }[]> = {};
  return {
    addListener: vi.fn((event: string, cb: () => void) => {
      const entry = { cb, handle: { remove: vi.fn() } };
      (listeners[event] ??= []).push(entry);
      return entry.handle;
    }),
    _fire(event: string) {
      for (const entry of listeners[event] ?? []) entry.cb();
    },
  };
}

describe("google-maps adapter", () => {
  beforeEach(() => {
    delete mapWindow.__hfGoogleMaps;
  });

  afterEach(() => {
    delete mapWindow.__hfGoogleMaps;
  });

  it("has correct name", () => {
    expect(createGoogleMapsAdapter().name).toBe("google-maps");
  });

  describe("getReadyPromise", () => {
    it("returns null when no maps registered", () => {
      const adapter = createGoogleMapsAdapter();
      expect(adapter.getReadyPromise!()).toBeNull();
    });

    it("returns null when __hfGoogleMaps is empty", () => {
      mapWindow.__hfGoogleMaps = [];
      const adapter = createGoogleMapsAdapter();
      expect(adapter.getReadyPromise!()).toBeNull();
    });

    it("resolves when map fires tilesloaded", async () => {
      const map = createMockMap();
      mapWindow.__hfGoogleMaps = [map];
      const adapter = createGoogleMapsAdapter();
      const promise = adapter.getReadyPromise!();
      expect(promise).not.toBeNull();
      map._fire("tilesloaded");
      await promise;
    });

    it("returns same promise on repeated calls (stable identity)", () => {
      const map = createMockMap();
      mapWindow.__hfGoogleMaps = [map];
      const adapter = createGoogleMapsAdapter();
      const p1 = adapter.getReadyPromise!();
      const p2 = adapter.getReadyPromise!();
      expect(p1).toBe(p2);
    });

    it("returns null after all maps have settled", async () => {
      const map = createMockMap();
      mapWindow.__hfGoogleMaps = [map];
      const adapter = createGoogleMapsAdapter();
      const promise = adapter.getReadyPromise!();
      map._fire("tilesloaded");
      await promise;
      expect(adapter.getReadyPromise!()).toBeNull();
    });

    it("removes listener after first tilesloaded fire", async () => {
      const map = createMockMap();
      mapWindow.__hfGoogleMaps = [map];
      const adapter = createGoogleMapsAdapter();
      const promise = adapter.getReadyPromise!();
      map._fire("tilesloaded");
      await promise;
      const handle = (map.addListener as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(handle.remove).toHaveBeenCalled();
    });

    it("handles multiple maps", async () => {
      const map1 = createMockMap();
      const map2 = createMockMap();
      mapWindow.__hfGoogleMaps = [map1, map2];
      const adapter = createGoogleMapsAdapter();
      const promise = adapter.getReadyPromise!();
      map1._fire("tilesloaded");
      map2._fire("tilesloaded");
      await promise;
      expect(adapter.getReadyPromise!()).toBeNull();
    });
  });

  it("discover is a no-op", () => {
    const adapter = createGoogleMapsAdapter();
    expect(() => adapter.discover()).not.toThrow();
  });

  it("seek is a no-op", () => {
    const adapter = createGoogleMapsAdapter();
    expect(() => adapter.seek({ time: 1 })).not.toThrow();
  });
});
