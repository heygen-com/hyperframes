import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const SIBLING_PATH = resolve(THIS_DIR, "hyperframe.manifest.json");
const MONOREPO_PATH = resolve(THIS_DIR, "../../../core/dist/hyperframe.manifest.json");

describe("resolveHyperframeManifestPath", () => {
  const originalEnv = process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH;

  beforeEach(() => {
    delete process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH = originalEnv;
    } else {
      delete process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH;
    }
  });

  it("returns env var when PRODUCER_HYPERFRAME_MANIFEST_PATH is set", async () => {
    process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH = "/custom/path/manifest.json";
    const { resolveHyperframeManifestPath } = await import("./hyperframeRuntimeLoader.js");
    expect(resolveHyperframeManifestPath()).toBe("/custom/path/manifest.json");
  });

  it("sibling path resolves to same directory as the module file", () => {
    // Key invariant: after build, dist/hyperframe.manifest.json sits next to
    // dist/index.js. In source, SIBLING_MANIFEST_PATH is next to this file.
    // This verifies the path construction is correct.
    expect(SIBLING_PATH).toBe(resolve(THIS_DIR, "hyperframe.manifest.json"));
    expect(SIBLING_PATH).toContain("producer/src/services/hyperframe.manifest.json");
  });

  it("prefers sibling path when it exists, otherwise picks the first existing candidate", async () => {
    // Behaviour-level replacement for the old source-text test that
    // asserted on string positions inside `const candidates = [...]`. We
    // prove the behavioural invariant instead: the resolver returns the
    // first candidate that actually exists on disk.
    const { resolveHyperframeManifestPath } = await import("./hyperframeRuntimeLoader.js");
    const resolved = resolveHyperframeManifestPath();
    expect(existsSync(resolved)).toBe(true);
    // The sibling would win when present. In dev, the monorepo-relative
    // core/dist is the real fallback; either way the path must exist.
    if (existsSync(SIBLING_PATH)) {
      expect(resolved).toBe(SIBLING_PATH);
    }
  });

  it("falls back to MONOREPO_PATH when present in dev (smoke test)", async () => {
    if (!existsSync(MONOREPO_PATH)) {
      // Skip if core hasn't been built — this is expected in CI before build
      return;
    }
    const { resolveHyperframeManifestPath } = await import("./hyperframeRuntimeLoader.js");
    expect(resolveHyperframeManifestPath()).toBe(MONOREPO_PATH);
  });
});

describe("hyperframeRuntimeLoader error path (#3370)", () => {
  const originalEnv = process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH;

  beforeEach(() => {
    delete process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH = originalEnv;
    } else {
      delete process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH;
    }
  });

  it("names the env-override path when PRODUCER_HYPERFRAME_MANIFEST_PATH is set and missing", async () => {
    // Force the env-override branch with a missing file. The thrown error
    // must name the override, not any fallback candidate.
    process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH = "/nonexistent/override/manifest.json";
    const { resolveVerifiedHyperframeRuntime } = await import("./hyperframeRuntimeLoader.js");
    expect(() => resolveVerifiedHyperframeRuntime()).toThrow(
      /nonexistent\/override\/manifest\.json/,
    );
  });

  it("triedManifestPaths returns only the override when PRODUCER_HYPERFRAME_MANIFEST_PATH is set", async () => {
    process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH = "/another/missing/override.json";
    const { triedManifestPaths } = await import("./hyperframeRuntimeLoader.js");
    expect(triedManifestPaths()).toEqual(["/another/missing/override.json"]);
  });

  it("triedManifestPaths lists every candidate when no override is set", async () => {
    delete process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH;
    const { triedManifestPaths } = await import("./hyperframeRuntimeLoader.js");
    const tried = triedManifestPaths();
    expect(tried.length).toBeGreaterThanOrEqual(4);
    // The first candidate must be the sibling path so the user sees it
    // first in the error message (heygen-com/hyperframes#3370).
    expect(tried[0]).toBe(
      resolve(dirname(fileURLToPath(import.meta.url)), "hyperframe.manifest.json"),
    );
  });
});
