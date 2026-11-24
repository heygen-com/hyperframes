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
 *
 * The threads read must be the encoder's own. The spawned process is
 * checked before every frame (`encoderProcessProblem`): it must run an
 * executable named `ffmpeg` under that name, and must have started no
 * process of its own (a wrapper that forks its ffmpeg is idle while its
 * child encodes); and a read of its thread states that finds none fails
 * rather than counting as idle. Each of those, and a GPU encoder, whose
 * work does not show as thread states, declines (`EncoderPacingError`).
 */

import { existsSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { basename } from "node:path";

/** The encoder cannot be paced as the layered path's is; the passthrough declines with `ffmpeg_unsupported`. */
export class EncoderPacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncoderPacingError";
  }
}

/** One state letter per thread of a process (`R`, `S`, `D`, ...): none when they cannot be read, null once it is gone. */
export type ThreadStates = () => readonly string[] | null;

/** Whether this host exposes per-thread states (`/proc/<pid>/task`). */
export function canPaceEncoder(): boolean {
  return existsSync("/proc/self/task");
}

/** The state letter of every thread of `pid`, from `/proc`: none when the task list cannot be read, null once the process is gone. */
export function procThreadStates(pid: number): readonly string[] | null {
  let tasks: string[];
  try {
    tasks = readdirSync(`/proc/${pid}/task`);
  } catch (error) {
    // Gone (exited and reaped) is null; a listing this process may not read is no states at all.
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? null : [];
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

/** What `/proc` says about a process; null where it cannot be read. */
export interface EncoderProcessFacts {
  /** `/proc/<pid>/comm`: the name the executable was started under (15 characters at most). */
  comm: string | null;
  /** `/proc/<pid>/exe`: the executable the process runs. */
  exe: string | null;
  /** Processes started by any of its threads (`/proc/<pid>/task/<tid>/children`). */
  children: number | null;
}

/** Reads `pid`'s facts from `/proc`. */
export function readEncoderProcess(pid: number): EncoderProcessFacts {
  const read = <T>(get: () => T): T | null => {
    try {
      return get();
    } catch {
      return null;
    }
  };
  const children = read(() =>
    readdirSync(`/proc/${pid}/task`).reduce((count, tid) => {
      const list = readFileSync(`/proc/${pid}/task/${tid}/children`, "latin1").trim();
      return count + (list ? list.split(/\s+/).length : 0);
    }, 0),
  );
  return {
    comm: read(() => readFileSync(`/proc/${pid}/comm`, "latin1").trim()),
    exe: read(() => readlinkSync(`/proc/${pid}/exe`)),
    children,
  };
}

/** Why the encoder process cannot be paced, or null when it is an ffmpeg with no child process. */
export function encoderProcessProblem(facts: EncoderProcessFacts): string | null {
  if (facts.comm === null || facts.exe === null || facts.children === null) {
    return "the encoder's process cannot be read from /proc";
  }
  if (facts.comm !== "ffmpeg") return `the encoder process is ${facts.comm}, not ffmpeg`;
  const exe = basename(facts.exe.replace(/ \(deleted\)$/, ""));
  if (exe !== "ffmpeg") return `the encoder process runs ${facts.exe}, not ffmpeg`;
  if (facts.children > 0) {
    return `the encoder process started ${facts.children} process(es) of its own`;
  }
  return null;
}

/** How long a just-spawned encoder may still be this process's fork, before it runs ffmpeg. */
const EXEC_WAIT_MS = 2_000;
const EXEC_POLL_MS = 5;

/** Whether `facts` are of a fork of this process that has not run its executable yet. */
function notExecutedYet(facts: EncoderProcessFacts, self: EncoderProcessFacts): boolean {
  return facts.exe !== null && facts.exe === self.exe;
}

/**
 * Resolves unless `pid` is an ffmpeg the encode can be paced by
 * (`encoderProcessProblem`), and rejects with `EncoderPacingError`
 * otherwise. A process still running this one's executable (spawned, not
 * yet executed) is read again for a moment first.
 */
export async function assertPaceableEncoder(
  pid: number | undefined,
  read: (pid: number) => EncoderProcessFacts = readEncoderProcess,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<void> {
  if (pid === undefined) throw new EncoderPacingError("the encoder has no process id");
  const self = read(process.pid);
  let facts = read(pid);
  for (
    let waited = 0;
    notExecutedYet(facts, self) && waited < EXEC_WAIT_MS;
    waited += EXEC_POLL_MS
  ) {
    await sleep(EXEC_POLL_MS);
    facts = read(pid);
  }
  const problem = encoderProcessProblem(facts);
  if (problem) throw new EncoderPacingError(problem);
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
 * uninterruptible wait (`D`) on `calmPolls` polls in a row. Rejects on
 * timeout or abort, with `EncoderPacingError` when the states cannot be
 * read (none): an unread encoder is not an idle one; and with a plain error
 * once the process is gone (null): an encoder that exited is a failure.
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
    if (current === null) throw new Error("hdrPassthrough: the encoder exited mid-encode");
    if (current.length === 0) {
      throw new EncoderPacingError("the encoder's thread states cannot be read");
    }
    calm = current.some((state) => BUSY_STATES.has(state)) ? 0 : calm + 1;
  }
}
