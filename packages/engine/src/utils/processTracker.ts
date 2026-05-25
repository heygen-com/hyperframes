import type { ChildProcess } from "node:child_process";

const tracked = new Set<ChildProcess>();

export function trackChildProcess(proc: ChildProcess): void {
  tracked.add(proc);
  const remove = () => tracked.delete(proc);
  proc.once("exit", remove);
  proc.once("error", remove);
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
