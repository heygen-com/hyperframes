import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCancellableProcess, runRenderSetupWorker } from "./cancellableProcess.js";
import { testProcessIsAlive, waitForTestCondition } from "./processTestUtils.js";

const IS_POSIX = process.platform !== "win32";

describe.skipIf(!IS_POSIX)("cancellable process tree teardown", () => {
  it("reaps a SIGTERM-resistant grandchild after the setup root exits", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "hyperframes-cancellable-process-"));
    const readyPath = join(testDir, "ready");
    const completionPath = join(testDir, "completed");
    const completionDelayMs = 750;
    const grandchildSource = [
      'import { writeFileSync } from "node:fs";',
      "const [readyPath, completionPath, completionDelay] = process.argv.slice(1);",
      'process.on("SIGTERM", () => undefined);',
      "writeFileSync(readyPath, String(process.pid));",
      'setTimeout(() => writeFileSync(completionPath, "completed"), Number(completionDelay));',
      "setInterval(() => undefined, 1000);",
    ].join("\n");
    const rootSource = [
      'import { spawn } from "node:child_process";',
      "const [grandchildSource, readyPath, completionPath, completionDelay] = process.argv.slice(1);",
      'spawn(process.execPath, ["--input-type=module", "--eval", grandchildSource, readyPath, completionPath, completionDelay], { stdio: "ignore" });',
      'process.on("SIGTERM", () => process.exit(0));',
      "setInterval(() => undefined, 1000);",
    ].join("\n");
    const controller = new AbortController();
    const abortReason = new Error("cancel setup");
    let rootPid: number | undefined;
    let grandchildPid: number | undefined;

    try {
      const setup = runCancellableProcess(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          rootSource,
          grandchildSource,
          readyPath,
          completionPath,
          String(completionDelayMs),
        ],
        {
          signal: controller.signal,
          onSpawn: (pid) => {
            rootPid = pid;
          },
        },
      );
      // existsSync goes true as soon as the write opens (and truncates) the
      // file, before its content lands — read must retry, not just exist-check.
      await waitForTestCondition(() => {
        if (!existsSync(readyPath)) return false;
        const pid = Number(readFileSync(readyPath, "utf8"));
        if (!Number.isInteger(pid) || pid <= 0) return false;
        grandchildPid = pid;
        return true;
      }, 2_000);

      controller.abort(abortReason);
      await expect(setup).rejects.toBe(abortReason);

      expect(rootPid).toBeDefined();
      expect(grandchildPid).toBeGreaterThan(0);
      expect(testProcessIsAlive(rootPid!)).toBe(false);
      expect(testProcessIsAlive(grandchildPid!)).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, completionDelayMs + 100));
      expect(existsSync(completionPath)).toBe(false);
    } finally {
      if (rootPid && testProcessIsAlive(rootPid)) process.kill(rootPid, "SIGKILL");
      if (grandchildPid && testProcessIsAlive(grandchildPid))
        process.kill(grandchildPid, "SIGKILL");
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 5_000);
});

describe("render setup worker failure", () => {
  it("rejects with only the worker's reason, not its crash output", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const failure = runRenderSetupWorker("bogus" as "lint", {}, {});

      await expect(failure).rejects.toThrow(/^Unknown render setup mode: bogus$/);
    } finally {
      stderr.mockRestore();
    }
  });
});
