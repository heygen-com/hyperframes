// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  beginTrackedProcessDrain,
  findOwnedOrphanedFfmpegProcesses,
  type OwnedFfmpegProcess,
  trackChildProcess,
  killTrackedProcesses,
} from "./processTracker.js";

// Reset tracked set between tests by killing everything
beforeEach(() => {
  killTrackedProcesses();
});

describe("trackChildProcess", () => {
  it("tracks a spawned process and removes it after exit", async () => {
    const proc = spawn("echo", ["hello"], { stdio: "ignore" });
    trackChildProcess(proc);

    await new Promise<void>((resolve) => proc.on("close", resolve));

    // After exit, killTrackedProcesses should be a no-op (nothing to kill)
    killTrackedProcesses();
  });

  it("removes an exited process before its stdio closes", async () => {
    const proc = spawn("sleep", ["60"], { stdio: "ignore" });
    const closePromise = new Promise<void>((resolve) => proc.on("close", resolve));
    const kill = vi.spyOn(proc, "kill");
    trackChildProcess(proc);

    try {
      proc.emit("exit", 0, null);
      killTrackedProcesses();

      expect(kill).not.toHaveBeenCalled();
    } finally {
      kill.mockRestore();
      proc.kill("SIGKILL");
      await closePromise;
    }
  });

  it("removes the process on spawn error", async () => {
    const proc = spawn("/nonexistent-binary-that-does-not-exist", { stdio: "ignore" });
    proc.on("error", () => undefined);
    trackChildProcess(proc);

    await new Promise<void>((resolve) => proc.on("close", () => resolve()));

    killTrackedProcesses();
  });

  it("keeps a process tracked after a post-spawn error", () => {
    const proc = spawn("sleep", ["60"], { stdio: "ignore" });
    const kill = vi.spyOn(proc, "kill");
    proc.on("error", () => undefined);
    trackChildProcess(proc);

    proc.emit("error", new Error("kill EPERM"));
    killTrackedProcesses();

    expect(kill).toHaveBeenCalledWith("SIGTERM");
  });
});

describe("killTrackedProcesses", () => {
  it("kills a running process", async () => {
    const proc = spawn("sleep", ["60"], { stdio: "ignore" });
    trackChildProcess(proc);

    const exitPromise = new Promise<number | null>((resolve) => proc.on("close", resolve));
    killTrackedProcesses();

    const code = await exitPromise;
    // SIGTERM exit: code is null (killed by signal)
    expect(code).toBeNull();
  });

  it("handles already-exited processes gracefully", async () => {
    const proc = spawn("true", { stdio: "ignore" });
    trackChildProcess(proc);

    await new Promise<void>((resolve) => proc.on("close", resolve));

    // Should not throw even though process already exited
    killTrackedProcesses();
  });

  it("escalates to SIGKILL for processes that ignore SIGTERM", async () => {
    // Spawn a process that traps SIGTERM (bash ignoring it)
    const proc = spawn("bash", ["-c", "trap '' TERM; sleep 60"], { stdio: "ignore" });
    trackChildProcess(proc);

    const exitPromise = new Promise<void>((resolve) => proc.on("close", resolve));
    killTrackedProcesses();

    // The 500ms SIGKILL escalation should kill it
    await exitPromise;
    expect(proc.killed).toBe(true);
  }, 5000);

  it("is idempotent — second call is a no-op", () => {
    const proc = spawn("sleep", ["60"], { stdio: "ignore" });
    trackChildProcess(proc);

    killTrackedProcesses();
    killTrackedProcesses();
  });
});

// The registry is never written or read on win32 (no PPID=1 reparenting to
// key orphan detection on), so these exercise the POSIX-only half.
describe.skipIf(process.platform === "win32")("FFmpeg ownership registry", () => {
  it("registers owned FFmpeg identity and removes it on clean exit", async () => {
    const registryDir = mkdtempSync(join(tmpdir(), "hf-owned-ffmpeg-"));
    const proc = spawn("sleep", ["60"], { stdio: "ignore" });
    const exitPromise = new Promise<void>((resolve) => proc.on("close", () => resolve()));
    try {
      trackChildProcess(proc, { kind: "ffmpeg", registryDir });
      expect(readdirSync(registryDir)).toHaveLength(1);

      proc.kill("SIGTERM");
      await exitPromise;
      expect(readdirSync(registryDir)).toHaveLength(0);
    } finally {
      proc.kill("SIGKILL");
      await exitPromise;
      rmSync(registryDir, { recursive: true, force: true });
    }
  });

  it("leaves a record on exit when another owner has since claimed the PID", async () => {
    const registryDir = mkdtempSync(join(tmpdir(), "hf-owned-ffmpeg-reclaimed-"));
    const proc = spawn("sleep", ["60"], { stdio: "ignore" });
    const exitPromise = new Promise<void>((resolve) => proc.on("close", () => resolve()));
    try {
      trackChildProcess(proc, { kind: "ffmpeg", registryDir });
      const path = join(registryDir, `${proc.pid}.json`);
      // Another process was handed this PID and wrote its own record before
      // our exit listener ran; the record is not ours to remove.
      const foreign = JSON.stringify({
        version: 1,
        kind: "ffmpeg",
        pid: proc.pid,
        identity: "linux:someone-else",
      });
      writeFileSync(path, foreign);

      proc.kill("SIGTERM");
      await exitPromise;
      expect(readFileSync(path, "utf8")).toBe(foreign);
    } finally {
      proc.kill("SIGKILL");
      await exitPromise;
      rmSync(registryDir, { recursive: true, force: true });
    }
  });

  it("recovers only identity-matched FFmpeg records reparented to init", () => {
    const registryDir = mkdtempSync(join(tmpdir(), "hf-owned-ffmpeg-scan-"));
    try {
      for (const [pid, identity] of [
        [101, "linux:one"],
        [102, "linux:two"],
        [103, "linux:stale"],
      ] as const) {
        writeFileSync(
          join(registryDir, `${pid}.json`),
          JSON.stringify({ version: 1, kind: "ffmpeg", pid, identity }),
        );
      }

      expect(
        findOwnedOrphanedFfmpegProcesses({
          registryDir,
          identityForPid: (pid) =>
            ({ 101: "linux:one", 102: "linux:two", 103: "linux:reused" })[pid] ?? null,
          parentPidForPid: (pid) => (pid === 101 ? 1 : 77),
        }),
      ).toEqual([{ pid: 101, identity: "linux:one" }]);
      expect(readdirSync(registryDir)).not.toContain("103.json");
      expect(readdirSync(registryDir)).toContain("102.json");
    } finally {
      rmSync(registryDir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(process.platform === "win32")("registry directory trust", () => {
  function record(pid: number): string {
    return JSON.stringify({ version: 1, kind: "ffmpeg", pid, identity: "linux:one" });
  }
  function scan(registryDir: string): OwnedFfmpegProcess[] {
    return findOwnedOrphanedFfmpegProcesses({
      registryDir,
      identityForPid: () => "linux:one",
      parentPidForPid: () => 1,
    });
  }

  it("names the path and the failing property when either side rejects the directory", async () => {
    // Fail-closed is right, but silent fail-closed leaves a stale loose
    // directory disabling recovery forever with nothing to grep for. Two
    // directories so the reader and the writer each produce their own line.
    const readerDir = mkdtempSync(join(tmpdir(), "hf-owned-ffmpeg-warn-read-"));
    const writerDir = mkdtempSync(join(tmpdir(), "hf-owned-ffmpeg-warn-write-"));
    chmodSync(readerDir, 0o750);
    chmodSync(writerDir, 0o705);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const proc = spawn("sleep", ["60"], { stdio: "ignore" });
    const closed = new Promise<void>((resolve) => proc.on("close", () => resolve()));
    try {
      // The usual reader-side state: nothing was ever registered. Silent.
      expect(scan(join(readerDir, "never-created"))).toEqual([]);
      expect(warn).not.toHaveBeenCalled();

      expect(scan(readerDir)).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(readerDir);
      expect(warn.mock.calls[0][0]).toContain("mode 750");

      trackChildProcess(proc, { kind: "ffmpeg", registryDir: writerDir });
      expect(readdirSync(writerDir)).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[1][0]).toContain(writerDir);
      expect(warn.mock.calls[1][0]).toContain("mode 705");

      // Once per path per process: a second rejection of the same path is quiet.
      expect(scan(readerDir)).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
      proc.kill("SIGKILL");
      await closed;
      rmSync(readerDir, { recursive: true, force: true });
      rmSync(writerDir, { recursive: true, force: true });
    }
  });

  it("neither writes to nor trusts a registry path that is a symlink", async () => {
    const real = mkdtempSync(join(tmpdir(), "hf-owned-ffmpeg-real-"));
    const holder = mkdtempSync(join(tmpdir(), "hf-owned-ffmpeg-link-"));
    const link = join(holder, "registry");
    symlinkSync(real, link);
    writeFileSync(join(real, "101.json"), record(101));
    const proc = spawn("sleep", ["60"], { stdio: "ignore" });
    const closed = new Promise<void>((resolve) => proc.on("close", () => resolve()));
    try {
      expect(scan(real)).toEqual([{ pid: 101, identity: "linux:one" }]);
      expect(scan(link)).toEqual([]);

      trackChildProcess(proc, { kind: "ffmpeg", registryDir: link });
      expect(readdirSync(real)).toEqual(["101.json"]);
    } finally {
      proc.kill("SIGKILL");
      await closed;
      rmSync(holder, { recursive: true, force: true });
      rmSync(real, { recursive: true, force: true });
    }
  });

  it("neither writes to nor trusts a registry directory open to other users", async () => {
    const registryDir = mkdtempSync(join(tmpdir(), "hf-owned-ffmpeg-loose-"));
    writeFileSync(join(registryDir, "101.json"), record(101));
    const proc = spawn("sleep", ["60"], { stdio: "ignore" });
    const closed = new Promise<void>((resolve) => proc.on("close", () => resolve()));
    try {
      expect(scan(registryDir)).toEqual([{ pid: 101, identity: "linux:one" }]);
      chmodSync(registryDir, 0o755);
      expect(scan(registryDir)).toEqual([]);

      trackChildProcess(proc, { kind: "ffmpeg", registryDir });
      expect(readdirSync(registryDir)).toEqual(["101.json"]);
    } finally {
      proc.kill("SIGKILL");
      await closed;
      rmSync(registryDir, { recursive: true, force: true });
    }
  });
});

// Last on purpose: the drain flag is module-level and never resets, so every
// child tracked after this point is terminated on registration.
describe("beginTrackedProcessDrain", () => {
  it("kills a child registered after the terminal drain begins", async () => {
    beginTrackedProcessDrain();
    const proc = spawn("sleep", ["60"], { stdio: "ignore" });
    const exitPromise = new Promise<number | null>((resolve) => proc.on("close", resolve));

    trackChildProcess(proc);

    expect(await exitPromise).toBeNull();
  });
});
