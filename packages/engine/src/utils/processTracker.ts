import type { ChildProcess } from "node:child_process";

const tracked = new Set<ChildProcess>();

export function trackChildProcess(proc: ChildProcess): void {
  tracked.add(proc);
  const remove = () => tracked.delete(proc);
  proc.once("exit", remove);
  proc.once("error", remove);
}

const KILL_ESCALATION_GRACE_MS = 500;

/**
 * Kill a single child process with SIGTERM, escalating to SIGKILL if it has
 * not exited after a short grace period. Same policy as
 * killTrackedProcesses(), but for timeout/abort kills of one process whose
 * caller is awaiting its `close` event — without the escalation, a process
 * that ignores SIGTERM (stuck I/O, frozen pipe) never emits `close` and the
 * awaiting promise hangs forever.
 *
 * Returns a cancel function; call it once the process exits so the
 * escalation timer doesn't outlive it.
 */
export function killWithEscalation(
  proc: ChildProcess,
  graceMs: number = KILL_ESCALATION_GRACE_MS,
): () => void {
  try {
    proc.kill("SIGTERM");
  } catch {
    // Already exited.
  }
  const timer = setTimeout(() => {
    if (proc.exitCode === null && proc.signalCode === null) {
      try {
        proc.kill("SIGKILL");
      } catch {
        // Already exited.
      }
    }
  }, graceMs);
  timer.unref();
  return () => clearTimeout(timer);
}

/**
 * SIGTERM all tracked child processes, then SIGKILL any that survive
 * after a short grace period.
 */
export function killTrackedProcesses(): void {
  const alive: ChildProcess[] = [];
  for (const proc of tracked) {
    if (!proc.killed) {
      try {
        proc.kill("SIGTERM");
        alive.push(proc);
      } catch {
        // Already exited between the check and the kill.
      }
    }
  }
  tracked.clear();

  if (alive.length === 0) return;

  setTimeout(() => {
    for (const proc of alive) {
      try {
        proc.kill("SIGKILL");
      } catch {
        // Already exited.
      }
    }
  }, 500).unref();
}
