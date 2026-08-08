import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fetchLocalVectors } from "./localSemantic.js";

describe("fetchLocalVectors", () => {
  const dir = join(tmpdir(), `hf-vec-${process.pid}`);
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("writes both files into the cache directory", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        arrayBuffer: async () =>
          url.endsWith(".json")
            ? new TextEncoder().encode(JSON.stringify({ names: [], dimensions: 1 })).buffer
            : new Uint8Array([1, 2, 3, 4]).buffer,
      })),
    );
    expect(await fetchLocalVectors("http://registry.test/", dir)).toBe(true);
    expect(existsSync(join(dir, "local-vectors.bin"))).toBe(true);
    expect(existsSync(join(dir, "local-vectors.json"))).toBe(true);
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
