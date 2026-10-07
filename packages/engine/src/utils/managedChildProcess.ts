import type { ChildProcess } from "node:child_process";

export type ManagedProcessTerminationReason =
  | "exit"
  | "abort"
  | "deadline"
  | "inactivity"
  | "spawn_error";

export interface ManagedChildProcessOutcome {
  reason: ManagedProcessTerminationReason;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  durationMs: number;
  error?: Error;
}

export interface ManagedChildProcessOptions {
  signal?: AbortSignal;
  deadlineAtMs?: number;
  inactivityTimeoutMs?: number;
  terminationGraceMs?: number;
  stderrMaxBytes?: number;
  onStderr?: (chunk: string) => void;
  now?: () => number;
}

const DEFAULT_TERMINATION_GRACE_MS = 2_000;
const DEFAULT_STDERR_MAX_BYTES = 64 * 1024;

/** Owns cancellation, escalation, stderr and reaping for one child process. */
export class ManagedChildProcess {
  private readonly startedAtMs: number;
  private readonly now: () => number;
  private readonly outcomePromise: Promise<ManagedChildProcessOutcome>;
  private resolveOutcome!: (outcome: ManagedChildProcessOutcome) => void;
  private requestedReason: Exclude<ManagedProcessTerminationReason, "exit" | "spawn_error"> | null =
    null;
  private stderrTail = Buffer.alloc(0);
  private spawned = false;
  private settled = false;
  private deadlineTimer: NodeJS.Timeout | null = null;
  private inactivityTimer: NodeJS.Timeout | null = null;
  private escalationTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly child: ChildProcess,
    private readonly options: ManagedChildProcessOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.startedAtMs = this.now();
    this.outcomePromise = new Promise((resolve) => {
      this.resolveOutcome = resolve;
    });

    child.stderr?.on("data", this.onStderr);
    child.once("spawn", this.onSpawn);
    child.once("close", this.onClose);
    child.on("error", this.onError);
    this.installAbort();
    this.installDeadline();
    this.markActivity();
  }

  wait(): Promise<ManagedChildProcessOutcome> {
    return this.outcomePromise;
  }

  get isSettled(): boolean {
    return this.settled;
  }

  markActivity(): void {
    if (this.settled || this.options.inactivityTimeoutMs === undefined) return;
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    this.inactivityTimer = setTimeout(
      () => this.requestTermination("inactivity"),
      Math.max(0, this.options.inactivityTimeoutMs),
    );
    this.inactivityTimer.unref?.();
  }

  private readonly onStderr = (data: Buffer | string): void => {
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const maxBytes = this.options.stderrMaxBytes ?? DEFAULT_STDERR_MAX_BYTES;
    this.stderrTail = Buffer.concat([this.stderrTail, chunk]);
    if (this.stderrTail.byteLength > maxBytes) {
      this.stderrTail = this.stderrTail.subarray(this.stderrTail.byteLength - maxBytes);
    }
    this.options.onStderr?.(chunk.toString());
  };

  private readonly onSpawn = (): void => {
    this.spawned = true;
  };

  private readonly onClose = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
    this.settle({
      reason: this.requestedReason ?? "exit",
      exitCode,
      signal,
      stderr: this.stderrTail.toString(),
      durationMs: this.now() - this.startedAtMs,
    });
  };

  private readonly onError = (error: Error): void => {
    if (this.spawned) return;
    this.settle({
      reason: "spawn_error",
      exitCode: null,
      signal: null,
      stderr: this.stderrTail.length > 0 ? this.stderrTail.toString() : error.message,
      durationMs: this.now() - this.startedAtMs,
      error,
    });
  };

  private installAbort(): void {
    const signal = this.options.signal;
    if (!signal) return;
    if (signal.aborted) {
      this.requestTermination("abort");
      return;
    }
    signal.addEventListener("abort", this.onAbort, { once: true });
  }

  private readonly onAbort = (): void => {
    this.requestTermination("abort");
  };

  private installDeadline(): void {
    if (this.options.deadlineAtMs === undefined) return;
    const remainingMs = Math.max(0, this.options.deadlineAtMs - this.now());
    this.deadlineTimer = setTimeout(() => this.requestTermination("deadline"), remainingMs);
    this.deadlineTimer.unref?.();
  }

  private requestTermination(
    reason: Exclude<ManagedProcessTerminationReason, "exit" | "spawn_error">,
  ): void {
    if (this.settled || this.requestedReason) return;
    this.requestedReason = reason;
    try {
      this.child.kill("SIGTERM");
    } catch {
      // A close/error event owns settlement; escalation remains the backstop.
    }
    const graceMs = this.options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
    this.escalationTimer = setTimeout(
      () => {
        if (this.settled) return;
        try {
          this.child.kill("SIGKILL");
        } catch {
          // The child may have exited between the settled check and kill.
        }
      },
      Math.max(0, graceMs),
    );
    this.escalationTimer.unref?.();
  }

  private settle(outcome: ManagedChildProcessOutcome): void {
    if (this.settled) return;
    this.settled = true;
    this.clearTimers();
    this.options.signal?.removeEventListener("abort", this.onAbort);
    this.child.stderr?.off("data", this.onStderr);
    this.child.off("spawn", this.onSpawn);
    this.child.off("close", this.onClose);
    this.child.off("error", this.onError);
    this.resolveOutcome(outcome);
  }

  private clearTimers(): void {
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    if (this.escalationTimer) clearTimeout(this.escalationTimer);
    this.deadlineTimer = null;
    this.inactivityTimer = null;
    this.escalationTimer = null;
  }
}
