// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { SCENE_SWAP_MS, onPreviewContentReplaced, sceneSwapFor } from "./sceneSwap";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Swap = (html: string, signal?: AbortSignal) => Promise<void>;

function swappableIframe(swap: Swap = vi.fn(async () => {})) {
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

  it("cancels the runtime's swap as it gives up, so captions arriving later replace nothing", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("<html></html>"));
    let captionsArrive = () => {};
    const captions = new Promise<void>((resolve) => (captionsArrive = resolve));
    let replaced = false;
    // As the runtime does: it waits for the caption overrides, then refuses a cancelled swap.
    const { iframe } = swappableIframe(async (_html, signal) => {
      await captions;
      if (signal?.aborted) throw new Error("the swap was cancelled");
      replaced = true;
    });
    const outcome = expect(sceneSwapFor(iframe)!("/preview", () => true)).rejects.toThrow(
      "took too long",
    );
    await vi.advanceTimersByTimeAsync(SCENE_SWAP_MS);
    await outcome;
    captionsArrive();
    await vi.advanceTimersByTimeAsync(0);
    expect(replaced).toBe(false);
  });

  it("does not start a swap whose cancel signal was aborted before the call", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("<html></html>"));
    const { iframe, swap } = swappableIframe();
    const cancel = new AbortController();
    cancel.abort(new Error("superseded by a newer edit"));
    await expect(sceneSwapFor(iframe)!("/preview", () => true, cancel.signal)).rejects.toThrow(
      "superseded",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(swap).not.toHaveBeenCalled();
  });

  it("swaps a document that arrives in time", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("<html></html>"));
    const { iframe, swap } = swappableIframe();
    await sceneSwapFor(iframe)!("/preview", () => true);
    expect(swap).toHaveBeenCalledWith("<html></html>", expect.anything());
  });
});

describe("onPreviewContentReplaced", () => {
  it("ignores the late load of the page already in use, and reports a new page or a scene swap", () => {
    const iframe = document.createElement("iframe");
    let page = {};
    Object.defineProperty(iframe, "contentDocument", { get: () => page });
    const replaced = vi.fn();
    const stop = onPreviewContentReplaced(iframe, replaced);

    iframe.dispatchEvent(new Event("load"));
    expect(replaced).not.toHaveBeenCalled();

    page = {};
    iframe.dispatchEvent(new Event("load"));
    expect(replaced).toHaveBeenCalledTimes(1);

    iframe.dispatchEvent(new Event("hf-scenes-swapped"));
    expect(replaced).toHaveBeenCalledTimes(2);
    stop();
  });
});
