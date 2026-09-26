// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { SCENE_SWAP_MS, sceneSwapFor } from "./sceneSwap";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function swappableIframe(swap = vi.fn(async () => {})) {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  Object.assign(iframe.contentWindow as object, { __hfSwapScenes: swap });
  return { iframe, swap };
}

describe("sceneSwapFor", () => {
  it("gives up on a preview download that never finishes, so the caller can reload", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
        ),
    );
    const { iframe, swap } = swappableIframe();
    const swapping = sceneSwapFor(iframe)!("/preview", () => true);
    const outcome = expect(swapping).rejects.toThrow("took too long");
    await vi.advanceTimersByTimeAsync(SCENE_SWAP_MS);
    await outcome;
    expect(swap).not.toHaveBeenCalled();
  });

  it.each([
    ["a body that never finishes", async () => new Response(new ReadableStream())],
    ["a runtime swap that never finishes", async () => new Response("<html></html>")],
  ])("gives up on %s, so the caller can reload", async (_stall, respond) => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(respond);
    const { iframe } = swappableIframe(vi.fn(() => new Promise<void>(() => {})));
    const swapped = vi.fn();
    iframe.addEventListener("hf-scenes-swapped", swapped);
    const outcome = expect(sceneSwapFor(iframe)!("/preview", () => true)).rejects.toThrow(
      "took too long",
    );
    await vi.advanceTimersByTimeAsync(SCENE_SWAP_MS);
    await outcome;
    expect(swapped).not.toHaveBeenCalled();
  });

  it("swaps a document that arrives in time", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("<html></html>"));
    const { iframe, swap } = swappableIframe();
    await sceneSwapFor(iframe)!("/preview", () => true);
    expect(swap).toHaveBeenCalledWith("<html></html>");
  });
});
