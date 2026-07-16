import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory fake filesystem so these tests exercise the REAL config.ts
// module (parsing, caching, readConfigFresh's cache-bypass) without ever
// touching the developer/CI machine's actual ~/.hyperframes/config.json —
// homedir() is resolved once at config.ts's module-load time, so faking
// HOME via env var would only work in a fresh process, not inside a shared
// vitest worker.
const fsState = vi.hoisted(() => ({
  files: new Map<string, string>(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn((path: string) => fsState.files.has(path)),
  mkdirSync: vi.fn(() => undefined),
  readFileSync: vi.fn((path: string) => {
    const content = fsState.files.get(path);
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  }),
  writeFileSync: vi.fn((path: string, content: string) => {
    fsState.files.set(path, content);
  }),
  // writeConfig writes atomically: temp file + rename over the target.
  renameSync: vi.fn((from: string, to: string) => {
    const content = fsState.files.get(from);
    if (content === undefined) throw new Error(`ENOENT: ${from}`);
    fsState.files.set(to, content);
    fsState.files.delete(from);
  }),
}));

describe("config.ts — readConfig / readConfigFresh / writeConfig (real module, faked fs)", () => {
  let readConfig: typeof import("./config.js").readConfig;
  let readConfigFresh: typeof import("./config.js").readConfigFresh;
  let writeConfig: typeof import("./config.js").writeConfig;
  let CONFIG_PATH: typeof import("./config.js").CONFIG_PATH;

  beforeEach(async () => {
    fsState.files.clear();
    // Fresh module instance per test — config.ts's `cachedConfig` is
    // module-scoped, so without this, a later test would silently inherit
    // an earlier test's cached read.
    vi.resetModules();
    ({ readConfig, readConfigFresh, writeConfig, CONFIG_PATH } = await import("./config.js"));
  });

  it("creates a default config with a fresh anonymousId when no file exists", () => {
    const config = readConfig();
    expect(config.telemetryEnabled).toBe(true);
    expect(config.anonymousId).toBeTruthy();
    expect(fsState.files.has(CONFIG_PATH)).toBe(true);
  });

  it("caches the read — a second readConfig() call does not see a file mutated out from under it", () => {
    const first = readConfig();
    fsState.files.set(CONFIG_PATH, JSON.stringify({ ...first, deParallelRouterTrialFired: true }));
    const second = readConfig();
    expect(second.deParallelRouterTrialFired).toBeUndefined();
  });

  it("readConfigFresh bypasses the cache and picks up a file written by another process", () => {
    const first = readConfig();
    fsState.files.set(CONFIG_PATH, JSON.stringify({ ...first, deParallelRouterTrialFired: true }));
    const fresh = readConfigFresh();
    expect(fresh.deParallelRouterTrialFired).toBe(true);
  });

  it("writeConfig updates the in-process cache so a subsequent readConfig() sees the write immediately", () => {
    const config = readConfig();
    config.deParallelRouterTrialRenderCount = 5;
    writeConfig(config);
    const reread = readConfig();
    expect(reread.deParallelRouterTrialRenderCount).toBe(5);
  });

  it('treats a non-boolean deParallelRouterTrialFired (e.g. the JSON string "false") as unset, not truthy', () => {
    const base = readConfig();
    fsState.files.set(
      CONFIG_PATH,
      JSON.stringify({ ...base, deParallelRouterTrialFired: "false" }),
    );
    const fresh = readConfigFresh();
    expect(fresh.deParallelRouterTrialFired).toBeUndefined();
  });

  it("treats a non-number deParallelRouterTrialRenderCount as unset", () => {
    const base = readConfig();
    fsState.files.set(
      CONFIG_PATH,
      JSON.stringify({ ...base, deParallelRouterTrialRenderCount: "5" }),
    );
    const fresh = readConfigFresh();
    expect(fresh.deParallelRouterTrialRenderCount).toBeUndefined();
  });

  it("resets to defaults with a fresh anonymousId when the file is corrupted JSON", () => {
    fsState.files.set(CONFIG_PATH, "{not valid json");
    const config = readConfig();
    expect(config.telemetryEnabled).toBe(true);
    expect(config.anonymousId).toBeTruthy();
  });

  it("writeConfig reports success, leaves no temp file behind, and reports failure when the fs throws", async () => {
    const config = readConfig();
    expect(writeConfig(config)).toBe(true);
    // Atomic write: the pid-suffixed temp file must have been renamed away.
    for (const path of fsState.files.keys()) {
      expect(path.endsWith(".tmp")).toBe(false);
    }

    const fs = await import("node:fs");
    vi.mocked(fs.writeFileSync).mockImplementationOnce(() => {
      throw new Error("EACCES: permission denied");
    });
    expect(writeConfig(config)).toBe(false);
  });
});
