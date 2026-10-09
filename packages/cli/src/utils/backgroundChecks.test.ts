import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ dev: false }));
vi.mock("./env.js", () => ({ isDevMode: () => env.dev }));
const disk = vi.hoisted(() => ({ config: {} as Record<string, unknown> }));
vi.mock("../telemetry/config.js", () => ({
  readConfig: () => ({ ...disk.config }),
  readConfigFresh: () => ({ ...disk.config }),
  writeConfig: (next: Record<string, unknown>) => {
    disk.config = { ...next };
    return true;
  },
}));
const child = vi.hoisted(() => ({ on: vi.fn(), unref: vi.fn() }));
const spawn = vi.hoisted(() => vi.fn(() => child));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn,
}));

const { launchBackgroundChecks } = await import("./backgroundChecks.js");

/** The checks handed to the child, or null when none was spawned. */
function spawnedChecks(): string[] | null {
  const call = spawn.mock.calls[0] as unknown as [string, string[]] | undefined;
  return call ? call[1].slice(1) : null;
}

/** tsup entry name -> source file, as the package build declares them. */
function buildEntries(): Map<string, string> {
  const config = readFileSync(new URL("../../tsup.config.ts", import.meta.url), "utf8");
  const block = config.slice(config.indexOf("entry: {"));
  const entries = block.slice(0, block.indexOf("},"));
  return new Map([...entries.matchAll(/"?([\w/]+)"?: "([^"]+)"/g)].map((m) => [m[1]!, m[2]!]));
}

describe("launchBackgroundChecks", () => {
  let origTTY: boolean | undefined;
  beforeEach(() => {
    spawn.mockClear();
    disk.config = {};
    env.dev = false;
    for (const name of ["CI", "HYPERFRAMES_NO_UPDATE_CHECK", "HYPERFRAMES_SKIP_SKILLS"]) {
      vi.stubEnv(name, "");
    }
    origTTY = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    Object.defineProperty(process.stderr, "isTTY", { value: origTTY, configurable: true });
  });

  it("runs both stale checks in one detached child the parent does not wait for", () => {
    launchBackgroundChecks();
    expect(spawn).toHaveBeenCalledTimes(1);
    const [execPath, , opts] = spawn.mock.calls[0] as unknown as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(execPath).toBe(process.execPath);
    expect(spawnedChecks()).toEqual(["update", "skills"]);
    expect(opts).toMatchObject({ detached: true, stdio: "ignore", windowsHide: true });
    expect(child.unref).toHaveBeenCalled();
    expect(child.on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("spawns the file the package build emits", () => {
    launchBackgroundChecks();
    const worker = (spawn.mock.calls[0] as unknown as [string, string[]])[1][0]!;
    const source = buildEntries().get(basename(worker, ".js"));
    expect(source, `${basename(worker)} is not a tsup entry`).toBeDefined();
    expect(existsSync(fileURLToPath(new URL(`../../${source}`, import.meta.url)))).toBe(true);
  });

  it("retries a check that did not refresh its cache at most once an hour", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    launchBackgroundChecks();
    expect(spawnedChecks()).toEqual(["update", "skills"]);

    // The child failed (offline): no cache written. The next command within the hour starts nothing.
    spawn.mockClear();
    vi.advanceTimersByTime(59 * 60 * 1000);
    launchBackgroundChecks();
    expect(spawn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2 * 60 * 1000);
    launchBackgroundChecks();
    expect(spawnedChecks()).toEqual(["update", "skills"]);
  });

  it("ignores an attempt stamp dated in the future, as after a clock correction", () => {
    const later = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    disk.config = { lastUpdateAttemptAt: later, lastSkillsAttemptAt: later };
    launchBackgroundChecks();
    expect(spawnedChecks()).toEqual(["update", "skills"]);
  });

  it("does not start a second skills check while one started this hour", () => {
    disk.config = { lastUpdateCheck: new Date().toISOString(), latestVersion: "1.0.0" };
    launchBackgroundChecks();
    expect(spawnedChecks()).toEqual(["skills"]);
    spawn.mockClear();
    launchBackgroundChecks();
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    ["dev mode", () => (env.dev = true), null],
    ["CI=1", () => vi.stubEnv("CI", "1"), null],
    ["CI=true", () => vi.stubEnv("CI", "true"), null],
    ["HYPERFRAMES_NO_UPDATE_CHECK=1", () => vi.stubEnv("HYPERFRAMES_NO_UPDATE_CHECK", "1"), null],
    ["HYPERFRAMES_SKIP_SKILLS=1", () => vi.stubEnv("HYPERFRAMES_SKIP_SKILLS", "1"), ["update"]],
    [
      "no terminal",
      () => Object.defineProperty(process.stderr, "isTTY", { value: false, configurable: true }),
      ["update"],
    ],
  ])("with %s, hands the child only what the parent used to check", (_, arrange, checks) => {
    arrange();
    launchBackgroundChecks();
    expect(spawnedChecks()).toEqual(checks);
  });
});
