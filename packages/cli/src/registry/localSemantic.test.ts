import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fetchLocalVectors } from "./localSemantic.js";
import { LOCAL_MODEL_DIMENSIONS } from "./localModel.js";

describe("fetchLocalVectors", () => {
  const dir = join(tmpdir(), `hf-vec-${process.pid}`);
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  /** A metadata/matrix pair that agrees: one name, one row of the real width. */
  const servePair = (names: string[], dimensions: number, floats: number) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        arrayBuffer: async () =>
          url.endsWith(".json")
            ? new TextEncoder().encode(JSON.stringify({ names, dimensions })).buffer
            : new Float32Array(floats).buffer,
      })),
    );

  it("writes both files into the cache directory", async () => {
    servePair(["whip-pan"], LOCAL_MODEL_DIMENSIONS, LOCAL_MODEL_DIMENSIONS);
    expect(await fetchLocalVectors("http://registry.test/", dir)).toBe(true);
    expect(existsSync(join(dir, "local-vectors.bin"))).toBe(true);
    expect(existsSync(join(dir, "local-vectors.json"))).toBe(true);
  });

  it("caches nothing when the matrix is short of the names it claims", async () => {
    // Half a download is the case worth refusing: written, it loads as an
    // error on every later search until someone clears the cache by hand.
    servePair(["whip-pan", "rack-focus"], LOCAL_MODEL_DIMENSIONS, LOCAL_MODEL_DIMENSIONS);
    expect(await fetchLocalVectors("http://registry.test/", dir)).toBe(false);
    expect(existsSync(join(dir, "local-vectors.bin"))).toBe(false);
    expect(existsSync(join(dir, "local-vectors.json"))).toBe(false);
  });

  it("caches nothing when the vectors came from a different model", async () => {
    servePair(["whip-pan"], 1536, 1536);
    expect(await fetchLocalVectors("http://registry.test/", dir)).toBe(false);
    expect(existsSync(join(dir, "local-vectors.json"))).toBe(false);
  });

  it("reports failure instead of throwing, so the command survives", async () => {
    // A tier the user switched on that silently never runs is the failure
    // being guarded: the caller needs a false to be able to say so.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) })),
    );
    expect(await fetchLocalVectors("http://registry.test", dir)).toBe(false);
  });

  it("reports failure when the network throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await fetchLocalVectors("http://registry.test", dir)).toBe(false);
  });
});
