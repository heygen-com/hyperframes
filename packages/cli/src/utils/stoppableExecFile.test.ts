import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stoppableExecFile, type StoppableExecFileOptions } from "./stoppableExecFile.js";

/** The error's own fields, comparable across two runs: no pid, and Buffers as text. */
function fieldsOf(err: unknown): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(err as object)) {
    if (key === "pid") continue;
    const text = (v: unknown) => (Buffer.isBuffer(v) ? `Buffer:${v.toString()}` : v);
    fields[key] = value === err ? "<itself>" : Array.isArray(value) ? value.map(text) : text(value);
  }
  return { message: (err as Error).message, ...fields };
}

function syncFailure(file: string, args: string[], options: ExecFileSyncOptions): unknown {
  try {
    execFileSync(file, args, options);
  } catch (err) {
    return err;
  }
  throw new Error("execFileSync did not fail");
}

const node = process.execPath;

describe("stoppableExecFile", () => {
  it.each<[string, string[], Omit<StoppableExecFileOptions, "signal">]>([
    [
      "a failure with stderr",
      ["-e", "process.stderr.write('boom'); process.exit(3)"],
      { stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 },
    ],
    [
      "a failure with no stderr",
      ["-e", "process.exit(4)"],
      { stdio: ["ignore", "ignore", "pipe"], timeout: 10_000 },
    ],
    [
      "a failure with every stream ignored",
      ["-e", "process.exit(5)"],
      { stdio: "ignore", timeout: 10_000 },
    ],
    [
      "a child its own signal stops",
      ["-e", "process.kill(process.pid, 'SIGTERM'); setTimeout(() => {}, 5000)"],
      { stdio: ["pipe", "pipe", "pipe"], timeout: 10_000 },
    ],
    [
      "a timeout",
      ["-e", "setTimeout(() => {}, 5000)"],
      { stdio: ["ignore", "ignore", "pipe"], timeout: 300 },
    ],
    [
      "output over maxBuffer",
      ["-e", "process.stderr.write('x'.repeat(3000)); setTimeout(() => {}, 5000)"],
      { stdio: ["ignore", "ignore", "pipe"], timeout: 10_000, maxBuffer: 1000 },
    ],
  ])("with a signal, fails %s with the error execFileSync throws", async (_case, args, options) => {
    const expected = syncFailure(node, args, options as ExecFileSyncOptions);
    const { signal } = new AbortController();
    const actual = await stoppableExecFile(node, args, { ...options, signal }).catch((e) => e);
    expect(fieldsOf(actual)).toEqual(fieldsOf(expected));
  });

  it("with a signal, fails a missing program with the error execFileSync throws", async () => {
    const options = { stdio: "ignore", timeout: 10_000 } as const;
    const expected = syncFailure("/no/such/tool", ["a"], options);
    const { signal } = new AbortController();
    const actual = await stoppableExecFile("/no/such/tool", ["a"], { ...options, signal }).catch(
      (e) => e,
    );
    expect(fieldsOf(actual)).toEqual(fieldsOf(expected));
  });

  it("without a signal, runs the child before it returns, as execFileSync does", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-stoppable-exec-"));
    const marker = join(dir, "ran");
    try {
      const script = `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "")`;
      void stoppableExecFile(node, ["-e", script], {
        stdio: "ignore",
        timeout: 10_000,
        signal: undefined,
      });
      expect(existsSync(marker)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe.skipIf(process.platform === "win32")("when the signal aborts", () => {
    let dir: string;
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    async function stopsTheTree() {
      dir = mkdtempSync(join(tmpdir(), "hf-stoppable-exec-"));
      const pids = join(dir, "pids");
      const script = join(dir, "tool.sh");
      writeFileSync(script, `sleep 30 &\necho "$$ $!" > "${pids}"\nwait\n`);
      const controller = new AbortController();
      const reason = new Error("stopped by the caller");
      const poll = setInterval(() => {
        if (existsSync(pids) && readFileSync(pids, "utf8").includes(" ")) controller.abort(reason);
      }, 20);
      const started = Date.now();

      const run = stoppableExecFile("/bin/sh", [script], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000,
        signal: controller.signal,
      }).finally(() => clearInterval(poll));

      await expect(run).rejects.toBe(reason);
      expect(Date.now() - started).toBeLessThan(10_000);
      for (const pid of readFileSync(pids, "utf8").trim().split(" ").map(Number)) {
        expect(() => process.kill(pid, 0), `pid ${pid}`).toThrow();
      }
    }

    it("ends the child and the process it started, then rejects with the reason", stopsTheTree);

    // fails without the fix: a pgrep that failed or ran past its 2 s on a loaded runner found no children, so the
    // orphaned grandchild kept the output pipes open and the stop waited it out (CI: timed out at 20 s).
    it.skipIf(process.platform !== "linux")(
      "finds the process it started on Linux without pgrep",
      async () => {
        const bin = mkdtempSync(join(tmpdir(), "hf-no-pgrep-"));
        writeFileSync(join(bin, "pgrep"), "#!/bin/sh\nexit 2\n", { mode: 0o755 });
        const path = process.env.PATH;
        process.env.PATH = `${bin}:${path}`;
        try {
          await stopsTheTree();
        } finally {
          process.env.PATH = path;
          rmSync(bin, { recursive: true, force: true });
        }
      },
    );

    it("starts nothing for a signal that is already aborted", async () => {
      dir = mkdtempSync(join(tmpdir(), "hf-stoppable-exec-"));
      const marker = join(dir, "ran");
      const reason = new Error("stopped before it began");
      const run = stoppableExecFile("/bin/sh", ["-c", `touch "${marker}"`], {
        stdio: "ignore",
        timeout: 10_000,
        signal: AbortSignal.abort(reason),
      });
      await expect(run).rejects.toBe(reason);
      expect(existsSync(marker)).toBe(false);
    });
  });
});
