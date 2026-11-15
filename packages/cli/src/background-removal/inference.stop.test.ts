import { beforeEach, describe, expect, it, vi } from "vitest";

const cleanups = vi.hoisted(() => new Set<() => Promise<void>>());
const native = vi.hoisted(() => ({
  frames: [] as (() => void)[],
  released: 0,
  releasedDuringFrame: 0,
  inFrame: false,
}));

vi.mock("../browser/launch.js", () => ({
  registerBrowserSessionCleanup: (cleanup: () => Promise<void>) => {
    cleanups.add(cleanup);
    return () => cleanups.delete(cleanup);
  },
}));
vi.mock("./manager.js", () => ({
  ensureModel: async () => "model.onnx",
  selectProviders: () => ({ providers: ["coreml", "cpu"], label: "CoreML" }),
}));
vi.mock("./coremlTemp.js", () => ({
  trackCoreMlTemp: () => ({ record: () => undefined, forget: () => undefined }),
}));
// A frame inside the native session ends when the test says so; releasing the session meanwhile is what aborts
// the process on a Mac ("mutex lock failed").
vi.mock("../utils/optionalPackages.js", () => {
  const chain: Record<string, unknown> = {};
  for (const step of ["resize", "raw", "toColourspace"]) chain[step] = () => chain;
  chain.toBuffer = async () => Buffer.alloc(320 * 320 * 3);
  return {
    loadSharp: async () => () => chain,
    loadOptionalPackage: async () => ({
      Tensor: class {},
      InferenceSession: {
        create: async () => ({
          inputNames: ["in"],
          outputNames: ["out"],
          run: () =>
            new Promise((resolve) => {
              native.inFrame = true;
              native.frames.push(() => {
                native.inFrame = false;
                resolve({ out: { data: new Float32Array(320 * 320) } });
              });
            }),
          release: async () => {
            native.released++;
            if (native.inFrame) native.releasedDuringFrame++;
          },
        }),
      },
    }),
  };
});

import { createSession } from "./inference.js";

const frame = (session: Awaited<ReturnType<typeof createSession>>) =>
  session.process(Buffer.alloc(48), 4, 4);
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

beforeEach(() => {
  cleanups.clear();
  Object.assign(native, { frames: [], released: 0, releasedDuringFrame: 0, inFrame: false });
});

describe("a stop signal while a frame is inside the session", () => {
  it("releases the session only after that frame has ended", async () => {
    const session = await createSession();
    const running = frame(session);
    await settle();
    const [stop] = [...cleanups];

    const stopped = stop!();
    await settle();
    expect(native.released).toBe(0);

    native.frames.shift()!();
    await running.catch(() => undefined);
    await stopped;

    expect(native.released).toBe(1);
    expect(native.releasedDuringFrame).toBe(0);
  });

  it("starts no frame after the stop, and closing afterwards does not release a second time", async () => {
    const session = await createSession();
    const [stop] = [...cleanups];
    await stop!();

    await expect(frame(session)).rejects.toThrow(/stopped/i);
    await session.close();

    expect(native.released).toBe(1);
  });
});
