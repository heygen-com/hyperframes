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
});
