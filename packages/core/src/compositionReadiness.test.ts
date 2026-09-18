import { describe, expect, it, vi } from "vitest";
import {
  mediaReadinessInput,
  scanPendingCompositionAssets,
  settleCompositionReadiness,
} from "./compositionReadiness.js";

function docWith(bodyHtml: string): Document {
  const doc = document.implementation.createHTMLDocument("");
  doc.body.innerHTML = bodyHtml;
  return doc;
}

describe("scanPendingCompositionAssets", () => {
  it("reports nothing pending for an empty document", () => {
    const scan = scanPendingCompositionAssets(docWith(""));
    expect(scan).toEqual({ pendingMedia: [], pendingImages: [], fontsLoading: false });
  });

  it("finds a not-yet-decoded image as pending", () => {
    const scan = scanPendingCompositionAssets(docWith('<img src="a.png">'));
    expect(scan.pendingImages).toHaveLength(1);
  });
});

describe("mediaReadinessInput", () => {
  it("returns null when there is nothing to wait on", () => {
    expect(mediaReadinessInput(docWith(""))).toBeNull();
  });
});

describe("settleCompositionReadiness", () => {
  it("calls back synchronously, before returning, when nothing is pending", () => {
    let calledSync = false;
    settleCompositionReadiness(docWith(""), () => {
      calledSync = true;
    });
    // If this ever ran via a microtask instead, calledSync would still be
    // false right here — a caller that plays/enables playback immediately
    // after this call would see stale state, which is the exact regression
    // this test guards against.
    expect(calledSync).toBe(true);
  });

  it("calls back asynchronously when something is pending", () => {
    const doc = docWith('<img src="a.png">');
    const img = doc.querySelector("img")!;
    Object.defineProperty(img, "complete", { value: false });
    img.decode = vi.fn().mockResolvedValue(undefined);

    let calledSync = false;
    settleCompositionReadiness(doc, () => {
      calledSync = true;
    });
    expect(calledSync).toBe(false);
  });

  it("waits for a pending image to decode before settling", async () => {
    const doc = docWith('<img src="a.png">');
    const img = doc.querySelector("img")!;
    Object.defineProperty(img, "complete", { value: false });
    img.decode = vi.fn().mockResolvedValue(undefined);

    const result = await new Promise((resolve) => settleCompositionReadiness(doc, resolve));
    expect(result).toEqual({ timedOut: false });
    expect(img.decode).toHaveBeenCalled();
  });

  it("times out rather than waiting forever on a stuck asset", async () => {
    vi.useFakeTimers();
    const doc = docWith('<img src="a.png">');
    const img = doc.querySelector("img")!;
    Object.defineProperty(img, "complete", { value: false });
    img.decode = () => new Promise<void>(() => {}); // never resolves

    const pending = new Promise((resolve) =>
      settleCompositionReadiness(doc, resolve, { timeoutMs: 1000 }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toEqual({ timedOut: true });
    vi.useRealTimers();
  });
});
