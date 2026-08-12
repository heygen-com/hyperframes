import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cachedLocalVectorRevision, fetchLocalVectors } from "./localSemantic.js";
import { LOCAL_MODEL_DIMENSIONS } from "./localModel.js";

describe("fetchLocalVectors", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-vec-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  /** A metadata/matrix pair that agrees: one name, one row of the real width. */
  const servePair = (names: string[], dimensions: number, floats: number, revision?: string) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        arrayBuffer: async () =>
          url.endsWith(".json")
            ? new TextEncoder().encode(JSON.stringify({ names, dimensions, revision })).buffer
            : new Float32Array(floats).buffer,
      })),
    );

  it("writes both files into the cache directory", async () => {
    servePair(["whip-pan"], LOCAL_MODEL_DIMENSIONS, LOCAL_MODEL_DIMENSIONS);
    expect(await fetchLocalVectors("http://registry.test/", { directory: dir })).toBe(true);
    expect(fetch).toHaveBeenCalledWith(expect.any(String), {
      signal: expect.any(AbortSignal),
    });
    expect(existsSync(join(dir, "local-vectors.bin"))).toBe(true);
    expect(existsSync(join(dir, "local-vectors.json"))).toBe(true);
  });

  it("caches nothing when the matrix is short of the names it claims", async () => {
    // Half a download is the case worth refusing: written, it loads as an
    // error on every later search until someone clears the cache by hand.
    servePair(["whip-pan", "rack-focus"], LOCAL_MODEL_DIMENSIONS, LOCAL_MODEL_DIMENSIONS);
    expect(await fetchLocalVectors("http://registry.test/", { directory: dir })).toBe(false);
    expect(existsSync(join(dir, "local-vectors.bin"))).toBe(false);
    expect(existsSync(join(dir, "local-vectors.json"))).toBe(false);
  });

  it("caches nothing when the vectors came from a different model", async () => {
    servePair(["whip-pan"], 1536, 1536);
    expect(await fetchLocalVectors("http://registry.test/", { directory: dir })).toBe(false);
    expect(existsSync(join(dir, "local-vectors.json"))).toBe(false);
  });

  it("reports failure instead of throwing, so the command survives", async () => {
    // A tier the user switched on that silently never runs is the failure
    // being guarded: the caller needs a false to be able to say so.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) })),
    );
    expect(await fetchLocalVectors("http://registry.test", { directory: dir })).toBe(false);
  });

  it("reports failure when the network throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await fetchLocalVectors("http://registry.test", { directory: dir })).toBe(false);
  });

  it("refuses an unexpected revision without replacing the previous pair", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "local-vectors.json"),
      JSON.stringify({ names: ["old"], dimensions: LOCAL_MODEL_DIMENSIONS, revision: "old" }),
    );
    writeFileSync(join(dir, "local-vectors.bin"), new Float32Array(LOCAL_MODEL_DIMENSIONS));
    servePair(["new"], LOCAL_MODEL_DIMENSIONS, LOCAL_MODEL_DIMENSIONS, "old");

    expect(
      await fetchLocalVectors("http://registry.test", {
        directory: dir,
        expectedRevision: "new",
      }),
    ).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, "local-vectors.json"), "utf-8"))).toEqual({
      names: ["old"],
      dimensions: LOCAL_MODEL_DIMENSIONS,
      revision: "old",
    });
  });

  it("reads the revision only from a complete cached pair", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "local-vectors.json"),
      JSON.stringify({ names: ["whip-pan"], dimensions: LOCAL_MODEL_DIMENSIONS, revision: "r1" }),
    );
    expect(cachedLocalVectorRevision(dir)).toBeUndefined();

    writeFileSync(join(dir, "local-vectors.bin"), new Float32Array(LOCAL_MODEL_DIMENSIONS));
    expect(cachedLocalVectorRevision(dir)).toBe("r1");
  });
});
