/**
 * Tests for `pollImagesReady` — the image-side analog of `pollVideosReady`.
 *
 * Critical contract:
 *   - Successfully loaded image (complete=true, naturalWidth>0) → settled.
 *   - Broken / 404 image (complete=true, naturalWidth=0) → settled.
 *     This mirrors `pollVideosReady`'s `ve.error` early-exit. Without it,
 *     the htmlCompiler 404-fallback path (where a remote <img> URL failed
 *     to download and the original URL is preserved) would silently spin
 *     the full `pageReadyTimeout` budget waiting for an image that will
 *     never load — a 45 s regression vs the pre-PR behavior.
 *   - In-flight image (complete=false) → still waiting.
 *   - data: URI src → settled (no network fetch).
 *   - Empty src → settled (nothing to load).
 */

import { describe, expect, it } from "vitest";
import type { Page } from "puppeteer-core";
import { pollImagesReady } from "./frameCapture.js";

interface ImageSpec {
  src: string;
  complete: boolean;
  naturalWidth: number;
}

// Mock `page` whose `evaluate(fn)` invokes `fn` with a Node-side `document`
// mock that returns synthetic image objects matching the spec. Snapshots the
// image state at evaluate-time, so callers can mutate `imgs` between polls
// to simulate progressive load completion.
function makeMockPage(imgs: () => ImageSpec[]): Page {
  return {
    evaluate: async (fn: () => unknown) => {
      const snapshot = imgs();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prevDoc = (globalThis as any).document;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).document = {
        querySelectorAll: () =>
          snapshot.map((spec) => ({
            getAttribute: (attr: string) => (attr === "src" ? spec.src : null),
            complete: spec.complete,
            naturalWidth: spec.naturalWidth,
          })),
      };
      try {
        return await fn();
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).document = prevDoc;
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as Page;
}

describe("pollImagesReady", () => {
  it("resolves immediately when there are no <img> elements", async () => {
    const page = makeMockPage(() => []);
    const result = await pollImagesReady(page, 1000, 10);
    expect(result).toBe(true);
  });

  it("resolves immediately when every image has loaded successfully", async () => {
    const page = makeMockPage(() => [
      { src: "/a.png", complete: true, naturalWidth: 100 },
      { src: "/b.png", complete: true, naturalWidth: 200 },
    ]);
    const result = await pollImagesReady(page, 1000, 10);
    expect(result).toBe(true);
  });

  it("treats a broken image (complete=true, naturalWidth=0) as settled — does NOT wait for timeout", async () => {
    // This is the bug Magi flagged. Without the broken-image escape, this
    // test would block the full 1000ms timeout and return false.
    const page = makeMockPage(() => [
      { src: "/a.png", complete: true, naturalWidth: 100 },
      { src: "https://broken.example.com/404.png", complete: true, naturalWidth: 0 },
    ]);
    const t0 = Date.now();
    const result = await pollImagesReady(page, 1000, 10);
    const elapsed = Date.now() - t0;
    expect(result).toBe(true);
    // Must resolve fast — well under the 1000ms timeout.
    expect(elapsed).toBeLessThan(500);
  });

  it("treats a data: URI src as settled regardless of complete/naturalWidth", async () => {
    const page = makeMockPage(() => [
      { src: "data:image/svg+xml,%3Csvg/%3E", complete: false, naturalWidth: 0 },
    ]);
    const result = await pollImagesReady(page, 1000, 10);
    expect(result).toBe(true);
  });

  it("treats an empty src as settled (nothing to load)", async () => {
    const page = makeMockPage(() => [{ src: "", complete: false, naturalWidth: 0 }]);
    const result = await pollImagesReady(page, 1000, 10);
    expect(result).toBe(true);
  });

  it("waits for an in-flight image and resolves once it completes", async () => {
    // Image starts in-flight, then completes after ~50ms.
    let started = false;
    const startTime = { value: 0 };
    const page = makeMockPage(() => {
      if (!started) {
        started = true;
        startTime.value = Date.now();
      }
      const elapsed = Date.now() - startTime.value;
      const loaded = elapsed >= 50;
      return [{ src: "/slow.png", complete: loaded, naturalWidth: loaded ? 100 : 0 }];
    });
    const result = await pollImagesReady(page, 1000, 10);
    expect(result).toBe(true);
  });

  it("times out and returns false when an in-flight image never resolves", async () => {
    // Image stays in-flight (complete=false) for the full timeout.
    const page = makeMockPage(() => [
      { src: "/never-loads.png", complete: false, naturalWidth: 0 },
    ]);
    const result = await pollImagesReady(page, 100, 10);
    expect(result).toBe(false);
  });

  it("mixed batch: loaded + broken + data: + in-flight → waits only on the in-flight image", async () => {
    let resolved = false;
    const start = Date.now();
    const page = makeMockPage(() => {
      const elapsed = Date.now() - start;
      if (elapsed >= 30) resolved = true;
      return [
        { src: "/loaded.png", complete: true, naturalWidth: 800 },
        { src: "https://broken.example.com/404.jpg", complete: true, naturalWidth: 0 },
        { src: "data:image/svg+xml,abc", complete: false, naturalWidth: 0 },
        {
          src: "/in-flight.png",
          complete: resolved,
          naturalWidth: resolved ? 200 : 0,
        },
      ];
    });
    const t0 = Date.now();
    const result = await pollImagesReady(page, 1000, 10);
    const elapsed = Date.now() - t0;
    expect(result).toBe(true);
    // Should wait roughly for the in-flight image to settle (~30ms) — not the
    // full timeout. Allow generous slack for CI scheduler jitter.
    expect(elapsed).toBeLessThan(500);
  });
});
