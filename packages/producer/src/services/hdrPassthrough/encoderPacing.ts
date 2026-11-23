/**
 * HDR passthrough: feeding the encoder the way the layered path does.
 *
 * libx265 encodes several frames at once (`frame-threads`, 16 here) and its
 * lookahead and rate control run beside those frame encoders on one thread
 * pool. Given the same frames and the same options its bitstream still
 * depends on when the frames arrive: fed faster than it encodes, so that
 * input queues up while earlier frames are in flight, 4 of 30 encodes of
 * identical raw frames with the layered encoder's exact command line came
 * out different under load (from a referenced B-frame whose QP moved, e.g.
 * 22.8 to 5.7), while with `frame-threads=1`, or with each frame arriving
 * once the encoder has gone quiet, every encode was the same. The layered
 * path is the second case: capture hands the encoder one frame at a time,
 * far slower than it encodes, so it always finds the encoder idle.
 *
 * So the passthrough hands its frames to the layered encoder the same way:
 * after each frame it waits until none of the encoder's threads is running
 * or in uninterruptible wait, several polls in a row, read from
 * `/proc/<pid>/task/<tid>/stat`. Where that cannot be read the passthrough
 * declines before it starts (`canPaceEncoder`).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";

/** One state letter per thread of a process (`R`, `S`, `D`, ...), or null once it is gone. */
export type ThreadStates = () => readonly string[] | null;

/** Whether this host exposes per-thread states (`/proc/<pid>/task`). */
export function canPaceEncoder(): boolean {
  return existsSync("/proc/self/task");
}

/** The state letter of every thread of `pid`, from `/proc`; null once the process is gone. */
export function procThreadStates(pid: number): readonly string[] | null {
  let tasks: string[];
  try {
    tasks = readdirSync(`/proc/${pid}/task`);
  } catch {
    return null;
  }
  const states: string[] = [];
  for (const tid of tasks) {
    try {
      const stat = readFileSync(`/proc/${pid}/task/${tid}/stat`, "latin1");
      // `pid (comm) state ...`: comm may hold spaces and parentheses, the state follows the last ")".
      const state = stat[stat.lastIndexOf(")") + 2];
      if (state) states.push(state);
    } catch {
      // A thread that exited between the listing and the read is not running.
    }
  }
  return states;
}

const BUSY_STATES = new Set(["R", "D"]);

export interface IdleWaitOptions {
  /** Delay between polls. */
  pollMs: number;
  /** Consecutive idle polls that count as idle. */
  calmPolls: number;
  /** Throws when the process has not gone idle by then. */
  timeoutMs: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export const ENCODER_IDLE: Readonly<IdleWaitOptions> = {
  pollMs: 2,
  calmPolls: 3,
  timeoutMs: 120_000,
};

const defaultSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * Resolves once no thread `states` reports is running (`R`) or in
 * uninterruptible wait (`D`) on `calmPolls` polls in a row, or once the
 * process is gone. Rejects on timeout or abort.
 */
export async function waitUntilIdle(states: ThreadStates, options: IdleWaitOptions): Promise<void> {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const deadline = now() + options.timeoutMs;
  let calm = 0;
  while (calm < options.calmPolls) {
    options.signal?.throwIfAborted();
    if (now() > deadline) {
      throw new Error(`hdrPassthrough: the encoder did not go idle within ${options.timeoutMs} ms`);
    }
    await sleep(options.pollMs);
    const current = states();
    if (current === null) return;
    calm = current.some((state) => BUSY_STATES.has(state)) ? 0 : calm + 1;
  }
}
