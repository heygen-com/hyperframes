import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { waitForTestCondition } from "../utils/processTestUtils.js";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "launch.fixture.ts");
const children = new Set<ChildProcess>();

/** Pids of every process whose command line carries this profile dir (Chromium and its helpers). */
function browserPids(profileDir: string): number[] {
  return readdirSync("/proc")
    .filter((name) => /^\d+$/.test(name))
    .filter((name) => {
      try {
        return readFileSync(`/proc/${name}/cmdline`, "utf8").includes(profileDir);
      } catch {
        return false;
      }
    })
    .map(Number);
}

function startFixture(profileDir: string, readyPath: string, mode = "launch"): ChildProcess {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", fixturePath, profileDir, readyPath, mode],
    { stdio: "ignore" },
  );
  children.add(child);
  return child;
}

const exited = (child: ChildProcess) =>
  new Promise<{ code: number | null; signal: string | null }>((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );

afterEach(() => {
  for (const child of children) child.kill("SIGKILL");
  children.clear();
});

describe.skipIf(process.platform !== "linux")("managed browser shutdown", () => {
  it.each([
    ["SIGTERM", "ready", 143],
    ["SIGINT", "ready", 130],
    ["SIGTERM", "launching", 143],
  ] as const)(
    "%s while %s leaves no browser and asks the CLI to exit",
    async (signal, phase, code) => {
      const dir = mkdtempSync(join(tmpdir(), "hf-launch-"));
      const profileDir = join(dir, "profile");
      const readyPath = join(dir, "ready");
      const child = startFixture(profileDir, readyPath);
      const done = exited(child);
      await waitForTestCondition(
        () => existsSync(readyPath) && readFileSync(readyPath, "utf8") === phase,
        30_000,
      );
      if (phase === "ready")
        await waitForTestCondition(() => browserPids(profileDir).length > 0, 30_000);
      child.kill(signal);
      await done;
      expect(readFileSync(`${readyPath}.exit`, "utf8")).toBe(String(code));
      await waitForTestCondition(() => browserPids(profileDir).length === 0, 5_000);
    },
    60_000,
  );

  it("SIGTERM during the GPU probe asks the CLI to exit instead of being swallowed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-launch-"));
    const readyPath = join(dir, "ready");
    const child = startFixture(join(dir, "profile"), readyPath, "probe");
    const done = exited(child);
    await waitForTestCondition(
      () => existsSync(readyPath) && readFileSync(readyPath, "utf8") === "probing",
      30_000,
    );
    child.kill("SIGTERM");
    await done;
    expect(readFileSync(`${readyPath}.exit`, "utf8")).toBe("143");
  }, 60_000);
});
