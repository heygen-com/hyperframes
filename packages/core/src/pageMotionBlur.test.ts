// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceleratedCanvasTrackerSource,
  installAcceleratedCanvasTracker,
  isAcceleratedCanvas,
} from "./pageMotionBlur";

type Proto = Record<string, unknown>;
const proto = HTMLCanvasElement.prototype as unknown as Proto;
const saved: Proto = {};

beforeEach(() => {
  for (const name of ["getContext", "transferControlToOffscreen"]) saved[name] = proto[name];
  proto.getContext = vi.fn(() => ({}));
  proto.transferControlToOffscreen = vi.fn(() => ({}));
});

afterEach(() => {
  for (const name of Object.keys(saved)) proto[name] = saved[name];
  Reflect.deleteProperty(window, "__hfAcceleratedCanvases");
});

describe("accelerated canvas tracker", () => {
  it("remembers WebGL and WebGPU canvases, not 2D ones", () => {
    installAcceleratedCanvasTracker();
    const [gl, gpu, flat] = [1, 2, 3].map(() => document.createElement("canvas"));
    gl?.getContext("webgl2");
    gpu?.getContext("webgpu");
    flat?.getContext("2d");
    expect([gl, gpu, flat].map((c) => c !== undefined && isAcceleratedCanvas(c))).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("treats a canvas handed to an OffscreenCanvas as accelerated", () => {
    installAcceleratedCanvasTracker();
    const canvas = document.createElement("canvas");
    canvas.transferControlToOffscreen();
    expect(isAcceleratedCanvas(canvas)).toBe(true);
  });

  it("installs once however many times it runs", () => {
    const original = proto.getContext as ReturnType<typeof vi.fn>;
    installAcceleratedCanvasTracker();
    installAcceleratedCanvasTracker();
    document.createElement("canvas").getContext("2d");
    expect(original).toHaveBeenCalledTimes(1);
  });

  it("works from its source text, as the engine and the preview inline it", () => {
    (0, eval)(acceleratedCanvasTrackerSource());
    const canvas = document.createElement("canvas");
    canvas.getContext("webgl");
    expect(isAcceleratedCanvas(canvas)).toBe(true);
  });

  it("tracks a scene canvas that has the host page's prototype", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    try {
      const scene = frame.contentWindow as (Window & typeof globalThis) | null;
      if (!scene) throw new Error("no iframe window");
      const sceneProto = scene.HTMLCanvasElement.prototype as unknown as Proto;
      expect(sceneProto === proto).toBe(false);
      sceneProto.getContext = vi.fn(() => ({}));
      // The host installs in its own window, as Studio does; the scene runs its own copy.
      installAcceleratedCanvasTracker();
      scene.eval(acceleratedCanvasTrackerSource());
      const canvas = scene.document.createElement("canvas");
      // Chrome gives a canvas the host's prototype when the host page reaches it first.
      Object.setPrototypeOf(canvas, HTMLCanvasElement.prototype);
      canvas.getContext("webgl2");
      const tracked: unknown = Reflect.get(scene, "__hfAcceleratedCanvases");
      expect((tracked as WeakSet<object>).has(canvas)).toBe(true);
    } finally {
      frame.remove();
    }
  });

  it("leaves the page that embeds the scene alone", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    try {
      const scene = frame.contentWindow as (Window & typeof globalThis) | null;
      if (!scene) throw new Error("no iframe window");
      const hostGetContext = proto.getContext;
      const hostSet = Object.getOwnPropertyDescriptor(window, "__hfAcceleratedCanvases");
      scene.eval(acceleratedCanvasTrackerSource());
      expect(Reflect.get(scene, "__hfAcceleratedCanvases")).toBeDefined();
      expect(proto.getContext).toBe(hostGetContext);
      expect(Object.getOwnPropertyDescriptor(window, "__hfAcceleratedCanvases")).toEqual(hostSet);
    } finally {
      frame.remove();
    }
  });
});
