import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { hideChildConsoles } from "./hideChildConsoles.js";

function fakeModule() {
  const calls: unknown[][] = [];
  const record = (name: string) => vi.fn((...args: unknown[]) => calls.push([name, ...args]));
  const module: Record<string, unknown> = {};
  for (const name of [
    "spawn",
    "spawnSync",
    "exec",
    "execSync",
    "execFile",
    "execFileSync",
    "fork",
  ]) {
    module[name] = record(name);
  }
  const execFile = module.execFile as Record<symbol, unknown>;
  execFile[promisify.custom] = vi.fn((...args: unknown[]) =>
    calls.push(["execFile.promisified", ...args]),
  );
  return { module, calls };
}

type Entry = "spawn" | "spawnSync" | "exec" | "execSync" | "execFile" | "execFileSync" | "fork";
type Calls = Record<Entry, (...args: unknown[]) => unknown>;

const run = (platform: NodeJS.Platform, use: (m: Calls) => void) => {
  const { module, calls } = fakeModule();
  hideChildConsoles(module, platform);
  use(module as Calls);
  return calls;
};

describe("hideChildConsoles", () => {
  it("hides a console on every way of passing the options", () => {
    const callback = () => {};
    const calls = run("win32", (m) => {
      m.spawn("a");
      m.spawn("a", ["x"]);
      m.spawnSync("a", ["x"], { cwd: "." });
      m.execFile("a", ["x"], callback);
      m.exec("a", callback);
      m.execSync("a", { timeout: 1 });
      m.execFileSync("a", { timeout: 1 });
      m.fork("a", ["x"], {});
    });
    expect(
      calls.map(([name, , ...rest]) => [
        name,
        rest.find((a) => a && typeof a === "object" && !Array.isArray(a)),
      ]),
    ).toEqual([
      ["spawn", { windowsHide: true }],
      ["spawn", { windowsHide: true }],
      ["spawnSync", { windowsHide: true, cwd: "." }],
      ["execFile", { windowsHide: true }],
      ["exec", { windowsHide: true }],
      ["execSync", { windowsHide: true, timeout: 1 }],
      ["execFileSync", { windowsHide: true, timeout: 1 }],
      ["fork", { windowsHide: true }],
    ]);
    expect(calls[3]?.at(-1)).toBe(callback);
  });

  it("silences taskkill's stderr when its target is already gone", () => {
    const calls = run("win32", (m) => {
      m.execSync("taskkill /pid 1 /T /F");
      m.execSync("echo hi");
    });
    expect(calls[0]?.[2]).toEqual({ windowsHide: true, stdio: "ignore" });
    expect(calls[1]?.[2]).toEqual({ windowsHide: true });
  });

  it("leaves a caller that wants the window alone", () => {
    const calls = run("win32", (m) =>
      m.spawn("browser", [], { windowsHide: false, detached: true }),
    );
    expect(calls[0]?.[3]).toEqual({ windowsHide: false, detached: true });
  });

  it("hides the promisified execFile too", async () => {
    const { module, calls } = fakeModule();
    hideChildConsoles(module, "win32");
    await promisify(module.execFile as never)("a", ["x"]);
    expect(calls[0]).toEqual(["execFile.promisified", "a", ["x"], { windowsHide: true }]);
  });

  it("does nothing off Windows", () => {
    const { module } = fakeModule();
    const before = { ...module };
    hideChildConsoles(module, "linux");
    expect(module).toEqual(before);
  });
});
