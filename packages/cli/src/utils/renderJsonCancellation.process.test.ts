import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { waitForTestCondition } from "./processTestUtils.js";

const IS_POSIX = process.platform !== "win32";
const children = new Set<ChildProcess>();
const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "renderJsonCancellation.fixture.ts",
);

afterEach(() => {
  for (const child of children) child.kill("SIGKILL");
  children.clear();
});

describe.skipIf(!IS_POSIX)("render --json cancellation output", () => {
  function startFixture(json: boolean): {
    child: ChildProcess;
    stdout: () => string;
    stderr: () => string;
  } {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", fixturePath, json ? "json" : "human"],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
    );
    children.add(child);
    child.once("exit", () => children.delete(child));
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => (stdout += chunk));
    child.stderr?.on("data", (chunk: string) => (stderr += chunk));
    return { child, stdout: () => stdout, stderr: () => stderr };
  }

  it.each(["SIGINT", "SIGTERM", "SIGHUP"] as const)(
    "prints exactly one cancel object for %s and exits 1",
    async (signal) => {
      const { child, stdout, stderr } = startFixture(true);
      const exited = new Promise<number | null>((resolve) => child.once("close", resolve));
      await waitForTestCondition(() => stderr().includes("ready"), 20_000);
      expect(child.kill(signal)).toBe(true);
      expect(await exited, stderr()).toBe(1);
      const lines = stdout().split("\n").filter(Boolean);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? "")).toEqual({
        ok: false,
        error: {
          code: "cancelled",
          signal,
          message: `Render cancelled: render_cancelled_by_${signal.toLowerCase()}`,
        },
      });
      expect(stderr()).toContain(`Render cancelled: render_cancelled_by_${signal.toLowerCase()}`);
      expect(stdout()).not.toContain("\u001b");
    },
    40_000,
  );

  it("keeps stdout empty on a cancel without --json", async () => {
    const { child, stdout, stderr } = startFixture(false);
    const exited = new Promise<number | null>((resolve) => child.once("close", resolve));
    await waitForTestCondition(() => stderr().includes("ready"), 20_000);
    expect(child.kill("SIGINT")).toBe(true);
    expect(await exited, stderr()).toBe(1);
    expect(stdout()).toBe("");
    expect(stderr()).toContain("Render cancelled: render_cancelled_by_sigint");
  }, 40_000);
});
