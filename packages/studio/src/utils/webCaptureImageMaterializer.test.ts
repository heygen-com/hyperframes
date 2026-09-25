import { describe, expect, it, vi } from "vitest";
import { createWebCaptureImageMaterializer } from "./webCaptureImageMaterializer";

describe("createWebCaptureImageMaterializer", () => {
  it("decodes image bytes, reports independent dimensions, and releases the bitmap", async () => {
    const close = vi.fn();
    const decode = vi.fn(async (blob: Blob) => {
      expect(blob.type).toBe("image/webp");
      expect(blob.size).toBe(4);
      return { width: 320, height: 180, close };
    });
    const materialize = createWebCaptureImageMaterializer(decode);

    await expect(
      materialize(
        new Uint8Array([1, 2, 3, 4]),
        { mime: "image/webp", width: 1, height: 1 },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ mime: "image/webp", width: 320, height: 180 });
    expect(decode).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects an aborted decode and still releases its bitmap", async () => {
    const controller = new AbortController();
    const close = vi.fn();
    let finishDecode:
      | ((image: { width: number; height: number; close: () => void }) => void)
      | null = null;
    const materialize = createWebCaptureImageMaterializer(
      () =>
        new Promise((resolve) => {
          finishDecode = resolve;
        }),
    );

    const result = materialize(
      new Uint8Array([1]),
      { mime: "image/png", width: 1, height: 1 },
      controller.signal,
    );
    controller.abort();
    if (!finishDecode) throw new Error("Decoder did not start");
    finishDecode({ width: 1, height: 1, close });

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not invoke an image decoder for unsupported resource MIME", async () => {
    const decode = vi.fn();
    const materialize = createWebCaptureImageMaterializer(decode);

    await expect(
      materialize(
        new Uint8Array([1]),
        { mime: "video/mp4", width: 1, height: 1, durationMs: 1 },
        new AbortController().signal,
      ),
    ).resolves.toBeNull();
    expect(decode).not.toHaveBeenCalled();
  });
});
