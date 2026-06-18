import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createD3Adapter } from "./d3";

type D3TransitionLike = {
  end: () => PromiseLike<void>;
};

const d3Window = window as Window & { __hfD3?: D3TransitionLike[] };

function createMockTransition(opts?: { resolved?: boolean }): D3TransitionLike {
  let resolver: (() => void) | null = null;
  return {
    end: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          if (opts?.resolved) {
            resolve();
          } else {
            resolver = resolve;
          }
        }),
    ),
    _resolve() {
      resolver?.();
    },
  } as D3TransitionLike & { _resolve: () => void };
}

describe("d3 adapter", () => {
  beforeEach(() => {
    delete d3Window.__hfD3;
  });

  afterEach(() => {
    delete d3Window.__hfD3;
  });

  it("has correct name", () => {
    expect(createD3Adapter().name).toBe("d3");
  });

  describe("getReadyPromise", () => {
    it("returns null when no transitions registered", () => {
      const adapter = createD3Adapter();
      expect(adapter.getReadyPromise!()).toBeNull();
    });

    it("returns null when __hfD3 is empty", () => {
      d3Window.__hfD3 = [];
      const adapter = createD3Adapter();
      expect(adapter.getReadyPromise!()).toBeNull();
    });

    it("resolves when transition ends", async () => {
      const t = createMockTransition() as D3TransitionLike & { _resolve: () => void };
      d3Window.__hfD3 = [t];
      const adapter = createD3Adapter();
      const promise = adapter.getReadyPromise!();
      expect(promise).not.toBeNull();
      t._resolve();
      await promise;
    });

    it("resolves immediately for already-resolved transition", async () => {
      const t = createMockTransition({ resolved: true });
      d3Window.__hfD3 = [t];
      const adapter = createD3Adapter();
      const promise = adapter.getReadyPromise!();
      expect(promise).not.toBeNull();
      await promise;
    });

    it("returns same promise on repeated calls (stable identity)", () => {
      const t = createMockTransition();
      d3Window.__hfD3 = [t];
      const adapter = createD3Adapter();
      const p1 = adapter.getReadyPromise!();
      const p2 = adapter.getReadyPromise!();
      expect(p1).toBe(p2);
    });

    it("returns null after all transitions have settled", async () => {
      const t = createMockTransition({ resolved: true });
      d3Window.__hfD3 = [t];
      const adapter = createD3Adapter();
      await adapter.getReadyPromise!();
      expect(adapter.getReadyPromise!()).toBeNull();
    });
  });

  it("discover is a no-op", () => {
    const adapter = createD3Adapter();
    expect(() => adapter.discover()).not.toThrow();
  });

  it("seek is a no-op", () => {
    const adapter = createD3Adapter();
    expect(() => adapter.seek({ time: 1 })).not.toThrow();
  });
});
