import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createRetryingModuleLoader,
  ensureProducerDist,
  resolveProducerDistEntry,
  resolveWorkspaceRoot,
} from "./vite.producer";

describe("ensureProducerDist", () => {
  it("does nothing when the producer dist entry already exists", () => {
    const exec = vi.fn();
    const result = ensureProducerDist({
      studioDir: "/repo/packages/studio",
      existsSyncImpl: () => true,
      execFileSyncImpl: exec as never,
    });

    expect(result).toEqual({
      built: false,
      producerDistEntry: resolve("/repo/packages/producer/dist/index.js"),
    });
    expect(exec).not.toHaveBeenCalled();
  });

  it("builds producer when the dist entry is missing", () => {
    const exec = vi.fn();
    const env = { TEST: "1" } as NodeJS.ProcessEnv;

    const result = ensureProducerDist({
      studioDir: "/repo/packages/studio",
      existsSyncImpl: () => false,
      execFileSyncImpl: exec as never,
      env,
    });

    expect(result).toEqual({
      built: true,
      producerDistEntry: resolve("/repo/packages/producer/dist/index.js"),
    });
    expect(exec).toHaveBeenCalledWith(
      "bun",
      ["run", "--filter", "@hyperframes/producer", "build"],
      {
        cwd: resolve("/repo"),
        stdio: "pipe",
        env,
      },
    );
  });
});

describe("producer path helpers", () => {
  it("resolves the producer dist entry relative to studio", () => {
    expect(resolveProducerDistEntry("/repo/packages/studio")).toBe(
      resolve("/repo/packages/producer/dist/index.js"),
    );
  });

  it("resolves the workspace root relative to studio", () => {
    expect(resolveWorkspaceRoot("/repo/packages/studio")).toBe(resolve("/repo"));
  });
});

describe("createRetryingModuleLoader", () => {
  it("retries after an initial load failure instead of caching the rejection", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("ok");
    const getModule = createRetryingModuleLoader(load);

    await expect(getModule()).rejects.toThrow("boom");
    await expect(getModule()).resolves.toBe("ok");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("reuses the same promise after a successful load", async () => {
    const load = vi.fn<() => Promise<string>>().mockResolvedValue("ok");
    const getModule = createRetryingModuleLoader(load);

    await expect(getModule()).resolves.toBe("ok");
    await expect(getModule()).resolves.toBe("ok");
    expect(load).toHaveBeenCalledTimes(1);
  });
});
