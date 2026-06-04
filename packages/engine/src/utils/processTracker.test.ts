import { describe, it, expect, beforeEach } from "vitest";
import { spawn } from "node:child_process";
import { trackChildProcess, killTrackedProcesses, killWithEscalation } from "./processTracker.js";

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

  it("removes the process on spawn error", async () => {
    const proc = spawn("/nonexistent-binary-that-does-not-exist", { stdio: "ignore" });
    trackChildProcess(proc);

    await new Promise<void>((resolve) => proc.on("error", () => resolve()));

    killTrackedProcesses();
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

// On Windows, kill("SIGTERM") maps to TerminateProcess and is unconditional,
// so a trap-based shim can't ignore it and the SIGKILL escalation is never
// reached. The whole block exercises POSIX-only signal semantics; skip it
// there, same as the runFfmpeg kill-escalation suite.
describe.skipIf(process.platform === "win32")("killWithEscalation", () => {
  it("kills a SIGTERM-compliant process", async () => {
    const proc = spawn("sleep", ["60"], { stdio: "ignore" });

    const exitPromise = new Promise<void>((resolve) => proc.on("close", () => resolve()));
    const cancel = killWithEscalation(proc);

    await exitPromise;
    cancel();
    expect(proc.signalCode).toBe("SIGTERM");
  });

  it("escalates to SIGKILL when the process ignores SIGTERM", async () => {
    // Block on the bash builtin `read` (stdin held open by the pipe) instead
    // of spawning `sleep`: a SIGKILLed bash reparents the sleep child, which
    // then lingers for 60s and accumulates orphans in watch/parallel runs.
    const proc = spawn("bash", ["-c", "trap '' TERM; read -t 60 _"], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    // Give bash a beat to install the trap; killing before that races the
    // trap setup and SIGTERM would win legitimately.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const exitPromise = new Promise<void>((resolve) => proc.on("close", () => resolve()));
    const cancel = killWithEscalation(proc, 100);

    await exitPromise;
    cancel();
    expect(proc.signalCode).toBe("SIGKILL");
  }, 5000);

  it("cancel clears the pending escalation", async () => {
    const proc = spawn("bash", ["-c", "trap '' TERM; read -t 60 _"], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    await new Promise((resolve) => setTimeout(resolve, 200));

    const cancel = killWithEscalation(proc, 100);
    cancel();

    // Past the grace period the process must still be alive: SIGTERM was
    // trapped and the SIGKILL escalation was cancelled.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(proc.exitCode).toBeNull();
    expect(proc.signalCode).toBeNull();

    proc.kill("SIGKILL");
    await new Promise<void>((resolve) => proc.on("close", () => resolve()));
  }, 5000);

  it("does not throw on an already-exited process", async () => {
    const proc = spawn("true", { stdio: "ignore" });
    await new Promise<void>((resolve) => proc.on("close", () => resolve()));

    const cancel = killWithEscalation(proc);
    cancel();
  });
});
