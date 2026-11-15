// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scaledFrames } from "./thumbnailFrameSink";

const drawImage = vi.fn();
const createImageBitmapMock = vi.fn();
const bitmap = { close: vi.fn() };

function sample(over: Partial<{ rotation: number; flipped: boolean }> = {}) {
  const frame = { displayWidth: 3456, displayHeight: 2234, close: vi.fn() };
  return {
    frame,
    rotation: 0,
    flipped: false,
    toVideoFrame: vi.fn(() => frame),
    drawWithFit: vi.fn(),
    close: vi.fn(),
    ...over,
  };
}

async function collect(samples: (ReturnType<typeof sample> | null)[], fit: "cover" | "contain") {
  const sink = {
    async *samplesAtTimestamps() {
      yield* samples;
    },
  };
  const out: ({ canvas: HTMLCanvasElement } | null)[] = [];
  const times = (async function* () {})();
  for await (const item of scaledFrames(sink, times, { width: 360, height: 240 }, fit))
    out.push(item as { canvas: HTMLCanvasElement } | null);
  return out;
}

describe("scaledFrames", () => {
  beforeEach(() => {
    vi.stubGlobal("createImageBitmap", createImageBitmapMock.mockResolvedValue(bitmap));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as RenderingContext);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("crops and scales a straight frame in createImageBitmap, centred for cover", async () => {
    const s = sample();
    const [out] = await collect([s], "cover");

    expect(s.drawWithFit).not.toHaveBeenCalled();
    const [frame, x, y, w, h, options] = createImageBitmapMock.mock.calls[0]!;
    expect(frame).toBe(s.frame);
    expect(options).toMatchObject({ resizeWidth: 360, resizeHeight: 240 });
    expect(w / h).toBeCloseTo(360 / 240, 3);
    expect(x + w / 2).toBeCloseTo(3456 / 2, 3);
    expect(y + h / 2).toBeCloseTo(2234 / 2, 3);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 360, 240);
    expect([out!.canvas.width, out!.canvas.height]).toEqual([360, 240]);
    expect(s.frame.close).toHaveBeenCalled();
    expect(bitmap.close).toHaveBeenCalled();
    expect(s.close).toHaveBeenCalled();
  });

  it("contain keeps the whole frame", async () => {
    await collect([sample()], "contain");
    const [, x, y, w, h] = createImageBitmapMock.mock.calls[0]!;
    expect([x, y, w, h]).toEqual([0, 0, 3456, 2234]);
  });

  it("leaves turned and flipped frames to the sample's own draw, which applies the turn", async () => {
    const turned = sample({ rotation: 90 });
    const flipped = sample({ flipped: true });
    await collect([turned, flipped], "cover");

    expect(createImageBitmapMock).not.toHaveBeenCalled();
    expect(turned.drawWithFit).toHaveBeenCalledWith(expect.anything(), { fit: "cover" });
    expect(flipped.drawWithFit).toHaveBeenCalled();
  });

  it("passes a missing frame through and closes the sample even when the scale fails", async () => {
    expect(await collect([null], "cover")).toEqual([null]);

    const s = sample();
    createImageBitmapMock.mockRejectedValueOnce(new Error("decode failed"));
    await expect(collect([s], "cover")).rejects.toThrow("decode failed");
    expect(s.frame.close).toHaveBeenCalled();
    expect(s.close).toHaveBeenCalled();
  });
});
