import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCancellableProcess } from "./cancellableProcess.js";
import { testProcessIsAlive, waitForTestCondition } from "./processTestUtils.js";

const IS_POSIX = process.platform !== "win32";

const splitOutputSource = [
  "const [output, exitCode, keepAlive] = process.argv.slice(1);",
  "const bytes = Buffer.from(output);",
  "process.stdout.write(bytes.subarray(0, 1));",
  "process.stderr.write(bytes.subarray(0, 1));",
  "setTimeout(() => {",
  "  process.stdout.write(bytes.subarray(1));",
  "  process.stderr.write(bytes.subarray(1));",
  "  process.exitCode = Number(exitCode);",
  "  if (keepAlive === '1') setTimeout(() => {}, 10_000);",
  "}, 50);",
].join("\n");

describe("cancellable process output", () => {
  it.each(["é", "项目/音声.wav", "🎬 render", "ASCII output"])(
    "preserves split output on both streams for %s",
    async (output) => {
      const result = await runCancellableProcess(process.execPath, [
        "--eval",
        splitOutputSource,
        output,
        "0",
      ]);
      expect(result).toEqual({ stdout: output, stderr: output });
    },
  );

  it("preserves split diagnostics when the process fails", async () => {
    const output = "診断: 🎬";
    await expect(
      runCancellableProcess(process.execPath, ["--eval", splitOutputSource, output, "1"]),
    ).rejects.toMatchObject({ status: 1, stdout: output, stderr: output });
  });

  it("counts a split UTF-8 character once at the combined byte limit", async () => {
    const result = await runCancellableProcess(
      process.execPath,
      ["--eval", splitOutputSource, "é", "0"],
      { maxBufferBytes: 4 },
    );
    expect(result).toEqual({ stdout: "é", stderr: "é" });
  });

  it("still rejects output that exceeds the combined raw byte limit", async () => {
    await expect(
      runCancellableProcess(process.execPath, ["--eval", splitOutputSource, "é", "0", "1"], {
        maxBufferBytes: 3,
      }),
    ).rejects.toMatchObject({ code: "ENOBUFS", killed: true });
  });

  it("flushes incomplete trailing UTF-8 bytes when the streams end", async () => {
    const result = await runCancellableProcess(process.execPath, [
      "--eval",
      "process.stdout.write(Buffer.from([0xe2, 0x82])); process.stderr.write(Buffer.from([0xf0, 0x9f]));",
    ]);
    expect(result).toEqual({ stdout: "�", stderr: "�" });
  });
});

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
