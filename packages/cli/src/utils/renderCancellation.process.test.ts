import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { testProcessIsAlive, waitForTestCondition } from "./processTestUtils.js";

const IS_POSIX = process.platform !== "win32";
const WRITE_DELAY_MS = 750;
const children = new Set<ChildProcess>();
const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "renderCancellation.fixture.ts");

function checksum(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function spawnWrapper(outputPath: string, readyPath: string): ChildProcess {
  const wrapperSource = [
    'import { spawn } from "node:child_process";',
    "const [fixturePath, outputPath, readyPath, writeDelay] = process.argv.slice(1);",
    'spawn("sh", ["-c", \'"$1" --import tsx "$2" "$3" "$4" "$5" & wait\', "render-shell", process.execPath, fixturePath, outputPath, readyPath, writeDelay], { stdio: "ignore" });',
    "setInterval(() => undefined, 1000);",
  ].join("\n");
  const wrapper = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      wrapperSource,
      fixturePath,
      outputPath,
      readyPath,
      String(WRITE_DELAY_MS),
    ],
    { cwd: process.cwd(), stdio: "ignore" },
  );
  children.add(wrapper);
  wrapper.once("exit", () => children.delete(wrapper));
  return wrapper;
}

afterEach(() => {
  for (const child of children) child.kill("SIGKILL");
  children.clear();
});

describe.skipIf(!IS_POSIX)("render cancellation process lifecycle", () => {
  it.each(["SIGINT", "SIGTERM", "SIGHUP"] as const)(
    "cancels the Node worker after its background wrapper exits from %s",
    async (signal) => {
      const testDir = mkdtempSync(join(tmpdir(), "hyperframes-render-cancel-"));
      const outputPath = join(testDir, "output.mp4");
      const readyPath = join(testDir, "ready.json");
      writeFileSync(outputPath, "existing render sentinel");
      const fixedMtime = new Date("2020-01-02T03:04:05.000Z");
      utimesSync(outputPath, fixedMtime, fixedMtime);
      const initialChecksum = checksum(outputPath);
      const initialMtime = statSync(outputPath).mtimeMs;

      let workerPid: number | undefined;
      let shellPid: number | undefined;
      let setupPid: number | undefined;
      try {
        const wrapper = spawnWrapper(outputPath, readyPath);
        const wrapperExit = new Promise<void>((resolve) => wrapper.once("exit", () => resolve()));
        await waitForTestCondition(() => {
          try {
            const ready = JSON.parse(readFileSync(readyPath, "utf8")) as {
              pid: number;
              parentPid: number;
              setupPid: number;
            };
            workerPid = ready.pid;
            shellPid = ready.parentPid;
            setupPid = ready.setupPid;
            return testProcessIsAlive(ready.pid) && testProcessIsAlive(ready.setupPid);
          } catch {
            return false;
          }
        }, 5_000);

        expect(wrapper.kill(signal)).toBe(true);
        await Promise.race([
          wrapperExit,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Wrapper did not exit")), 2_000),
          ),
        ]);
        await waitForTestCondition(
          () => workerPid !== undefined && !testProcessIsAlive(workerPid),
          3_000,
        );
        await waitForTestCondition(
          () => setupPid !== undefined && !testProcessIsAlive(setupPid),
          3_000,
        );
        await new Promise((resolve) => setTimeout(resolve, WRITE_DELAY_MS + 100));

        expect(checksum(outputPath)).toBe(initialChecksum);
        expect(statSync(outputPath).mtimeMs).toBe(initialMtime);
      } finally {
        if (workerPid !== undefined && testProcessIsAlive(workerPid))
          process.kill(workerPid, "SIGKILL");
        if (setupPid !== undefined && testProcessIsAlive(setupPid))
          process.kill(setupPid, "SIGKILL");
        if (shellPid !== undefined && testProcessIsAlive(shellPid))
          process.kill(shellPid, "SIGKILL");
        rmSync(testDir, { recursive: true, force: true });
      }
    },
    10_000,
  );
});

describe("render cancellation process keepalive", () => {
  it("keeps detached renders alive while their awaited work only uses unrefed handles", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "hyperframes-render-keepalive-"));
    const outputPath = join(testDir, "completed");
    const modulePath = join(dirname(fixturePath), "renderCancellation.ts");
    const source = [
      'import { writeFileSync } from "node:fs";',
      'import { createRenderCancellationScope } from "' + pathToFileURL(modulePath).href + '";',
      "const [outputPath] = process.argv.slice(1);",
      "const cancellation = createRenderCancellationScope({ detached: true, parentPollIntervalMs: 25 });",
      "await new Promise((resolve) => {",
      '  const timer = setTimeout(() => { writeFileSync(outputPath, "completed"); cancellation.dispose(); resolve(); }, 250);',
      "  timer.unref();",
      "});",
    ].join("\n");

    try {
      const fixture = spawn(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "--eval", source, outputPath],
        { cwd: process.cwd(), stdio: "pipe" },
      );
      const exited = new Promise<{ code: number | null; stderr: string }>((resolve) => {
        let stderr = "";
        fixture.stderr?.on("data", (chunk) => (stderr += chunk.toString()));
        fixture.once("exit", (code) => resolve({ code, stderr }));
      });

      const result = await exited;
      expect(result, result.stderr).toMatchObject({ code: 0 });
      expect(readFileSync(outputPath, "utf8")).toBe("completed");
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 5_000);
});
