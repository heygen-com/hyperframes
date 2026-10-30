import { afterAll, describe, expect, it, mock } from "bun:test";

const real = await import("@hyperframes/engine");
const created: unknown[] = [];
mock.module("@hyperframes/engine", () => ({
  ...real,
  createVideoFrameInjector: (_lookup: unknown, options: unknown) => {
    created.push(options);
    return async () => {};
  },
}));
afterAll(() => mock.module("@hyperframes/engine", () => real));

const { createChunkVideoFrameInjectorFactory } = await import("./chunkFrames.js");

const budget = { frameDataUriCacheLimit: 256, frameDataUriCacheBytesLimitMb: 375 };

describe("chunk video frame injector budget", () => {
  it("hands the shared cache budget to every injector it builds", async () => {
    const lookup = real.createFrameLookupTable([], []);
    createChunkVideoFrameInjectorFactory(lookup, budget)();
    await createChunkVideoFrameInjectorFactory(Promise.resolve(lookup), budget)()?.({} as never, 0);
    expect(created).toEqual([budget, budget]);
  });
});
