import { afterEach, expect, it, vi } from "vitest";
import { createPausedVideoFrames, getPausedVideoFrame } from "../pausedVideoFrames";
import {
  patchCanvasVideoFrameCompat,
  patchExternalVideoTextureCompat,
  patchVideoTextureCompat,
  patchWebGLVideoTextureCompat,
} from "./video-texture-compat";

const sessions: ReturnType<typeof createPausedVideoFrames>[] = [];
afterEach(() => {
  for (const session of sessions.splice(0)) session.destroy();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function surfaces() {
  const draw = vi.fn();
  const offscreenDraw = vi.fn();
  const image = vi.fn();
  const subImage = vi.fn();
  const copy = vi.fn();
  const imported = vi.fn((_descriptor: unknown) => ({ texture: true }));
  const constructed = vi.fn();
  class Context2D {
    drawImage(...args: unknown[]) {
      draw.apply(this, args);
    }
  }
  class Offscreen2D {
    drawImage(...args: unknown[]) {
      offscreenDraw.apply(this, args);
    }
  }
  class GL {
    texImage2D(...args: unknown[]) {
      image.apply(this, args);
    }
    texSubImage2D(...args: unknown[]) {
      subImage.apply(this, args);
    }
  }
  class GL2 extends GL {}
  class Queue {
    copyExternalImageToTexture(...args: unknown[]) {
      copy.apply(this, args);
    }
  }
  class Device {
    importExternalTexture(descriptor: unknown) {
      return imported.call(this, descriptor);
    }
  }
  class Frame {
    close = vi.fn();
    constructor(source: unknown, options: unknown) {
      constructed(source, options);
    }
  }
  vi.stubGlobal("CanvasRenderingContext2D", Context2D);
  vi.stubGlobal("OffscreenCanvasRenderingContext2D", Offscreen2D);
  vi.stubGlobal("WebGLRenderingContext", GL);
  vi.stubGlobal("WebGL2RenderingContext", GL2);
  vi.stubGlobal("GPUQueue", Queue);
  vi.stubGlobal("GPUDevice", Device);
  vi.stubGlobal("VideoFrame", Frame);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  return {
    Context2D,
    Offscreen2D,
    GL,
    GL2,
    Queue,
    Device,
    draw,
    offscreenDraw,
    image,
    subImage,
    copy,
    imported,
    constructed,
  };
}

async function presented() {
  const session = createPausedVideoFrames();
  sessions.push(session);
  const video = document.createElement("video");
  video.src = "/original.mp4";
  document.body.append(video);
  Object.defineProperties(video, {
    videoWidth: { value: 1920 },
    videoHeight: { value: 1080 },
  });
  const source = document.createElement("canvas");
  source.width = 320;
  source.height = 180;
  session.setProvider({
    decode: async (requests) =>
      requests.map(({ time }) => ({
        source,
        timestamp: time,
        duration: 1 / 30,
        width: 1920,
        height: 1080,
        release: vi.fn(),
      })),
    dispose: vi.fn(),
  });
  const show = async (time: number) => {
    const batch = await session.prepare(
      [{ video, source: video.src, time }],
      new AbortController().signal,
    );
    expect(batch?.present()).toBe(true);
    batch!.refresh();
  };
  await show(3);
  const canvas = getPausedVideoFrame(video)!;
  expect([canvas.width, canvas.height]).toEqual([video.videoWidth, video.videoHeight]);
  return { session, video, canvas, show };
}

it.each([
  ["three arguments", [11, 17]],
  ["five arguments", [11, 17, 640, 360]],
  ["nine arguments", [120, 60, 960, 540, 11, 17, 640, 360]],
])("preserves %s and source coordinates for both canvas surfaces", async (_name, coordinates) => {
  const { Context2D, Offscreen2D, draw, offscreenDraw } = surfaces();
  const { session, video, canvas } = await presented();
  patchCanvasVideoFrameCompat();
  patchCanvasVideoFrameCompat();
  const context = new Context2D();
  const offscreen = new Offscreen2D();
  context.drawImage(video, ...coordinates);
  offscreen.drawImage(video, ...coordinates);
  expect(draw).toHaveBeenCalledExactlyOnceWith(canvas, ...coordinates);
  expect(offscreenDraw).toHaveBeenCalledExactlyOnceWith(canvas, ...coordinates);
  expect(draw.mock.contexts[0]).toBe(context);
  expect(offscreenDraw.mock.contexts[0]).toBe(offscreen);
  session.clear();
  context.drawImage(video, ...coordinates);
  expect(draw).toHaveBeenLastCalledWith(video, ...coordinates);
  const image = document.createElement("img");
  offscreen.drawImage(image, ...coordinates);
  expect(offscreenDraw).toHaveBeenLastCalledWith(image, ...coordinates);
});

it("uploads paused pixels through both WebGL versions without changing crop or upload parameters", async () => {
  const { GL, GL2, image, subImage } = surfaces();
  const { session, video, canvas } = await presented();
  patchWebGLVideoTextureCompat();
  for (const Context of [GL, GL2]) {
    const gl = new Context();
    const imageArgs = [0x0de1, 2, 0x1908, 0x1908, 0x1401];
    const subArgs = [0x0de1, 2, 13, 29, 0x1908, 0x1401];
    gl.texImage2D(...imageArgs, video);
    gl.texSubImage2D(...subArgs, video);
    expect(image).toHaveBeenLastCalledWith(...imageArgs, canvas);
    expect(subImage).toHaveBeenLastCalledWith(...subArgs, canvas);
    expect(image.mock.contexts.at(-1)).toBe(gl);
    const pixels = new Uint8Array([10, 20, 30, 255]);
    gl.texImage2D(0x0de1, 0, 0x1908, 1, 1, 0, 0x1908, 0x1401, pixels);
    expect(image).toHaveBeenLastCalledWith(0x0de1, 0, 0x1908, 1, 1, 0, 0x1908, 0x1401, pixels);
  }
  session.clear();
  new GL().texImage2D(0x0de1, 0, 0x1908, 0x1908, 0x1401, video);
  expect(image.mock.lastCall?.at(-1)).toBe(video);
});

it("preserves WebGPU crop, orientation, destination and full intrinsic copy extent", async () => {
  const { Queue, copy } = surfaces();
  const { session, video, canvas } = await presented();
  patchVideoTextureCompat();
  const queue = new Queue();
  const source = { source: video, origin: { x: 37, y: 41 }, flipY: true };
  const destination = { texture: {}, origin: [5, 7], mipLevel: 1, premultipliedAlpha: true };
  const extent = {
    width: video.videoWidth - 37,
    height: video.videoHeight - 41,
    depthOrArrayLayers: 1,
  };
  queue.copyExternalImageToTexture(source, destination, extent);
  expect(copy).toHaveBeenCalledExactlyOnceWith({ ...source, source: canvas }, destination, extent);
  expect(copy.mock.contexts[0]).toBe(queue);
  expect(source.source).toBe(video);
  expect(copy.mock.calls[0]?.[1]).toBe(destination);
  expect(copy.mock.calls[0]?.[2]).toBe(extent);
  session.clear();
  queue.copyExternalImageToTexture(source, destination, extent);
  expect(copy).toHaveBeenLastCalledWith(source, destination, extent);
  expect(copy.mock.lastCall?.[0]).toBe(source);
});

it("reuses an external VideoFrame until presentation changes, then closes it on replacement and clear", async () => {
  const { Device, imported, constructed } = surfaces();
  const { session, video, canvas, show } = await presented();
  patchExternalVideoTextureCompat();
  const once = Device.prototype.importExternalTexture;
  patchExternalVideoTextureCompat();
  expect(Device.prototype.importExternalTexture).toBe(once);
  const device = new Device();
  const descriptor = { source: video, colorSpace: "srgb", label: "authored texture" };
  const texture = device.importExternalTexture(descriptor);
  const first = imported.mock.lastCall?.[0] as {
    source: { close: ReturnType<typeof vi.fn> };
    colorSpace: string;
    label: string;
  };
  expect(texture).toEqual({ texture: true });
  expect(constructed).toHaveBeenCalledExactlyOnceWith(canvas, { timestamp: 3_000_000 });
  expect(first).toEqual({ ...descriptor, source: first.source });
  expect(first.source).not.toBe(video);
  expect(imported.mock.contexts[0]).toBe(device);
  expect(descriptor.source).toBe(video);
  device.importExternalTexture(descriptor);
  expect(imported.mock.lastCall?.[0]).toEqual(first);
  expect(constructed).toHaveBeenCalledTimes(1);
  expect(first.source.close).not.toHaveBeenCalled();
  await show(4);
  expect(first.source.close).toHaveBeenCalledTimes(1);
  device.importExternalTexture(descriptor);
  const second = imported.mock.lastCall?.[0] as typeof first;
  expect(second.source).not.toBe(first.source);
  expect(constructed).toHaveBeenLastCalledWith(getPausedVideoFrame(video), {
    timestamp: 4_000_000,
  });
  session.clear();
  expect(second.source.close).toHaveBeenCalledTimes(1);
  device.importExternalTexture(descriptor);
  expect(imported).toHaveBeenLastCalledWith(descriptor);
  expect(imported.mock.lastCall?.[0]).toBe(descriptor);
  expect(constructed).toHaveBeenCalledTimes(2);
});
