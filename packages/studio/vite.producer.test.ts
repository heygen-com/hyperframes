import { describe, expect, it, vi } from "vitest";
import {
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
      producerDistEntry: "/repo/packages/producer/dist/index.js",
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
      producerDistEntry: "/repo/packages/producer/dist/index.js",
    });
    expect(exec).toHaveBeenCalledWith(
      "bun",
      ["run", "--filter", "@hyperframes/producer", "build"],
      {
        cwd: "/repo",
        stdio: "pipe",
        env,
      },
    );
  });
});

describe("producer path helpers", () => {
  it("resolves the producer dist entry relative to studio", () => {
    expect(resolveProducerDistEntry("/repo/packages/studio")).toBe(
      "/repo/packages/producer/dist/index.js",
    );
  });

  it("resolves the workspace root relative to studio", () => {
    expect(resolveWorkspaceRoot("/repo/packages/studio")).toBe("/repo");
  });
});
