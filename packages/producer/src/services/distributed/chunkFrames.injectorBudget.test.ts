import { describe, expect, it } from "bun:test";
import { createFrameLookupTable } from "@hyperframes/engine";
import {
  chunkFrameInjectorDependencies,
  createChunkVideoFrameInjectorFactory,
} from "./chunkFrames.js";

const budget = { frameDataUriCacheLimit: 256, frameDataUriCacheBytesLimitMb: 375 };

describe("chunk video frame injector budget", () => {
  it("hands the shared cache budget to every injector it builds", async () => {
    const created: unknown[] = [];
    const real = chunkFrameInjectorDependencies.createVideoFrameInjector;
    chunkFrameInjectorDependencies.createVideoFrameInjector = (_lookup, options) => {
      created.push(options);
      return async () => {};
    };
    try {
      const lookup = createFrameLookupTable([], []);
      createChunkVideoFrameInjectorFactory(lookup, budget)();
      await createChunkVideoFrameInjectorFactory(Promise.resolve(lookup), budget)()?.(
        {} as never,
        0,
      );
    } finally {
      chunkFrameInjectorDependencies.createVideoFrameInjector = real;
    }
    expect(created).toEqual([budget, budget]);
  });

  it("leaves the engine's own injector in place for every later test", () => {
    expect(createChunkVideoFrameInjectorFactory(null)()).toBeNull();
  });
});
