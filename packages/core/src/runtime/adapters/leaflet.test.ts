import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLeafletAdapter } from "./leaflet";

type LeafletMapLike = {
  whenReady: (cb: () => void) => void;
};

const mapWindow = window as Window & { __hfLeaflet?: LeafletMapLike[] };

function createMockMap(opts?: { ready?: boolean }): LeafletMapLike {
  return {
    whenReady: vi.fn((cb: () => void) => {
      if (opts?.ready ?? false) cb();
    }),
    _fireReady() {
      const calls = (this.whenReady as ReturnType<typeof vi.fn>).mock.calls;
      for (const [cb] of calls) cb();
    },
  } as LeafletMapLike & { _fireReady: () => void };
}

describe("leaflet adapter", () => {
  beforeEach(() => {
    delete mapWindow.__hfLeaflet;
  });

  afterEach(() => {
    delete mapWindow.__hfLeaflet;
  });

  it("has correct name", () => {
    expect(createLeafletAdapter().name).toBe("leaflet");
  });

  describe("getReadyPromise", () => {
    it("returns null when no maps registered", () => {
      const adapter = createLeafletAdapter();
      expect(adapter.getReadyPromise!()).toBeNull();
    });

    it("returns null when __hfLeaflet is empty", () => {
      mapWindow.__hfLeaflet = [];
      const adapter = createLeafletAdapter();
      expect(adapter.getReadyPromise!()).toBeNull();
    });

    it("resolves when map fires whenReady callback", async () => {
      const map = createMockMap() as LeafletMapLike & { _fireReady: () => void };
      mapWindow.__hfLeaflet = [map];
      const adapter = createLeafletAdapter();
      const promise = adapter.getReadyPromise!();
      expect(promise).not.toBeNull();
      map._fireReady();
      await promise;
    });

    it("resolves immediately for already-ready map", async () => {
      const map = createMockMap({ ready: true });
      mapWindow.__hfLeaflet = [map];
      const adapter = createLeafletAdapter();
      const promise = adapter.getReadyPromise!();
      expect(promise).not.toBeNull();
      await promise;
    });

    it("returns same promise on repeated calls (stable identity)", () => {
      const map = createMockMap();
      mapWindow.__hfLeaflet = [map];
      const adapter = createLeafletAdapter();
      const p1 = adapter.getReadyPromise!();
      const p2 = adapter.getReadyPromise!();
      expect(p1).toBe(p2);
    });

    it("returns null after all maps have settled", async () => {
      const map = createMockMap({ ready: true });
      mapWindow.__hfLeaflet = [map];
      const adapter = createLeafletAdapter();
      await adapter.getReadyPromise!();
      expect(adapter.getReadyPromise!()).toBeNull();
    });
  });

  it("discover is a no-op", () => {
    const adapter = createLeafletAdapter();
    expect(() => adapter.discover()).not.toThrow();
  });

  it("seek is a no-op", () => {
    const adapter = createLeafletAdapter();
    expect(() => adapter.seek({ time: 1 })).not.toThrow();
  });
});
