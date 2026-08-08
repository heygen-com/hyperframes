import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchParsedAnimations } from "./keyframeCacheAstLoad";

/**
 * Parsing a composition is a whole-file read + parse on the server, and a
 * multi-element action asks for the same file once per element. Callers that
 * overlap in time share one request; a caller that comes after the last one
 * settled does not, so a parse issued after a write is never served a
 * pre-write answer.
 */
describe("fetchParsedAnimations — in-flight sharing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(): { calls: () => number; settle: () => void } {
    let calls = 0;
    const pending: Array<() => void> = [];
    vi.stubGlobal("fetch", () => {
      calls++;
      return new Promise((resolve) => {
        pending.push(() =>
          resolve({
            ok: true,
            json: () => Promise.resolve({ animations: [{ id: "a", targetSelector: "#a" }] }),
          } as Response),
        );
      });
    });
    return {
      calls: () => calls,
      settle: () => {
        for (const release of pending.splice(0, pending.length)) release();
      },
    };
  }

  it("serves overlapping reads of one file from a single request", async () => {
    const fetchStub = stubFetch();

    const pending = [
      fetchParsedAnimations("p", "index.html"),
      fetchParsedAnimations("p", "index.html"),
      fetchParsedAnimations("p", "index.html"),
    ];
    fetchStub.settle();
    const results = await Promise.all(pending);

    expect(fetchStub.calls()).toBe(1);
    expect(results.map((parsed) => parsed?.animations.length)).toEqual([1, 1, 1]);
  });

  it("does not share across files", async () => {
    const fetchStub = stubFetch();

    const pending = [
      fetchParsedAnimations("p", "index.html"),
      fetchParsedAnimations("p", "other.html"),
    ];
    fetchStub.settle();
    await Promise.all(pending);

    expect(fetchStub.calls()).toBe(2);
  });

  it("re-requests once the previous read has settled", async () => {
    const fetchStub = stubFetch();

    const first = fetchParsedAnimations("p", "index.html");
    fetchStub.settle();
    await first;
    const second = fetchParsedAnimations("p", "index.html");
    fetchStub.settle();
    await second;

    expect(fetchStub.calls()).toBe(2);
  });
});
