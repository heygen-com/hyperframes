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
 * The threads read must be the ones running libx265 for this encode, so
 * `watchEncoder` proves the spawned process is that encoder before any
 * frame is paced on it, and declines (`EncoderPacingError`) on anything it
 * cannot prove. A name proves nothing: a wrapper named `ffmpeg` can start
 * the real encoder outside its own process tree (a delayed double fork, a
 * daemon, `setsid`), and then every frame reads the wrapper's idle threads.
 * What is proven instead:
 *
 * - the executable the process runs (`/proc/<pid>/exe`, opened, not looked
 *   up by name) is an ELF file, reports `--enable-libx265` when run with
 *   `-buildconf` (the same file: device and inode match), and holds
 *   libx265's own code: its banner in the file (a static build) or a
 *   mapped `libx265` library (a shared one). A script runs its
 *   interpreter, a wrapper binary holds no libx265; both decline. A
 *   symlink to ffmpeg, a renamed copy and a wrapper that execs ffmpeg in
 *   place run ffmpeg itself and pass;
 * - the process is still this one's child, in this process's group and
 *   session, and has started no process (`/proc/<pid>/task/*\/children`,
 *   at any depth);
 * - after the first frame, and before that frame's idle wait can finish,
 *   the process holds ffmpeg's libx265 encoder thread (`enc0:0:libx265`;
 *   ffmpeg 7.0 and later name it), and from then on that thread and every
 *   thread present when the first frame went idle (x265's pool) are still
 *   there on every poll.
 *
 * Each frame checks the process again (`EncoderPacer.check`), and a poll
 * that finds no thread states fails rather than counting as idle. A GPU
 * encoder, whose work does not show as thread states, declines at
 * eligibility.
 */

import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { basename } from "node:path";

/** The encoder cannot be paced as the layered path's is; the passthrough declines with `ffmpeg_unsupported`. */
export class EncoderPacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncoderPacingError";
  }
}

/** One thread of a process, from `/proc/<pid>/task/<tid>/stat`. */
export interface ThreadState {
  tid: number;
  /** Its name (`comm`, 15 characters at most). */
  name: string;
  /** `R`, `S`, `D`, ... */
  state: string;
}

/** Every thread of a process: none when they cannot be read, null once it is gone. */
export type ThreadStates = () => readonly ThreadState[] | null;

/** Whether this host exposes per-thread states (`/proc/<pid>/task`). */
export function canPaceEncoder(): boolean {
  return existsSync("/proc/self/task");
}

/** `pid (comm) state ppid pgrp session ...`: comm may hold spaces and parentheses. */
function parseStat(stat: string): { name: string; fields: string[] } | null {
  const open = stat.indexOf("(");
  const close = stat.lastIndexOf(")");
  if (open < 0 || close < open) return null;
  return { name: stat.slice(open + 1, close), fields: stat.slice(close + 2).split(" ") };
}

/** Every thread of `pid`, from `/proc`: none when the task list cannot be read, null once the process is gone. */
export function procThreadStates(pid: number): readonly ThreadState[] | null {
  let tasks: string[];
  try {
    tasks = readdirSync(`/proc/${pid}/task`);
  } catch (error) {
    // Gone (exited and reaped) is null; a listing this process may not read is no states at all.
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? null : [];
  }
  const threads: ThreadState[] = [];
  for (const tid of tasks) {
    try {
      const parsed = parseStat(readFileSync(`/proc/${pid}/task/${tid}/stat`, "latin1"));
      const state = parsed?.fields[0];
      if (parsed && state) threads.push({ tid: Number(tid), name: parsed.name, state });
    } catch {
      // A thread that exited between the listing and the read is not running.
    }
  }
  return threads;
}

/** What `/proc` says about a process; null where it cannot be read. */
export interface EncoderProcessFacts {
  /** `/proc/<pid>/exe`: the path of the executable the process runs. */
  exe: string | null;
  /** The device and inode of that executable (`stat /proc/<pid>/exe`). */
  exeId: string | null;
  /** Its parent, process group and session (`/proc/<pid>/stat`). */
  lineage: { ppid: number; pgrp: number; session: number } | null;
  /** Processes it started that are still its descendants, at any depth. */
  descendants: number | null;
}

const read = <T>(get: () => T): T | null => {
  try {
    return get();
  } catch {
    return null;
  }
};

/** Processes started by any thread of `pid`. */
function childrenOf(pid: number): number[] {
  const children: number[] = [];
  for (const tid of readdirSync(`/proc/${pid}/task`)) {
    const list = readFileSync(`/proc/${pid}/task/${tid}/children`, "latin1").trim();
    if (list) children.push(...list.split(/\s+/).map(Number));
  }
  return children;
}

/** Descendants of `pid`, at any depth; a child that exits while it is read still counts. */
function countDescendants(pid: number): number {
  let count = 0;
  const pending = childrenOf(pid);
  while (pending.length > 0) {
    const child = pending.pop() as number;
    count++;
    pending.push(...(read(() => childrenOf(child)) ?? []));
  }
  return count;
}

/** Reads `pid`'s facts from `/proc`. */
export function readEncoderProcess(pid: number): EncoderProcessFacts {
  return {
    exe: read(() => readlinkSync(`/proc/${pid}/exe`)),
    exeId: read(() => {
      const stat = statSync(`/proc/${pid}/exe`);
      return `${stat.dev}:${stat.ino}`;
    }),
    lineage: read(() => {
      const fields = parseStat(readFileSync(`/proc/${pid}/stat`, "latin1"))?.fields;
      if (!fields) throw new Error("unreadable stat");
      return { ppid: Number(fields[1]), pgrp: Number(fields[2]), session: Number(fields[3]) };
    }),
    descendants: read(() => countDescendants(pid)),
  };
}

/**
 * Why the encoder process cannot be paced as it stands, or null: it must be
 * readable, still `self`'s child in `self`'s group and session (as spawn
 * left it), with no process of its own.
 */
export function encoderProcessProblem(
  facts: EncoderProcessFacts,
  self: { pid: number; pgrp: number; session: number },
): string | null {
  if (facts.exe === null || facts.exeId === null || facts.lineage === null) {
    return "the encoder's process cannot be read from /proc";
  }
  if (facts.descendants === null) return "the encoder's child processes cannot be read";
  const { ppid, pgrp, session } = facts.lineage;
  if (ppid !== self.pid) return `the encoder process is no longer this process's child`;
  if (pgrp !== self.pgrp || session !== self.session) {
    return "the encoder process left this process's process group or session";
  }
  if (facts.descendants > 0) {
    return `the encoder process started ${facts.descendants} process(es) of its own`;
  }
  return null;
}

/** What an executable holds, for the proof (see the module comment). */
export interface ExecutableFacts {
  /** The file starts with the ELF magic. */
  elf: boolean;
  /** libx265's banner is in the file: libx265 is linked in. */
  staticLibx265: boolean;
  /** Run with `-buildconf`, it reports `--enable-libx265`. */
  reportsLibx265: boolean;
}

const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
/** Part of the banner libx265 itself writes into every stream (`x265 (build N) - ...`). */
export const LIBX265_BANNER = Buffer.from(
  "H.265/HEVC codec - Copyright 2013-2018 (c) Multicoreware, Inc",
);
const SCAN_CHUNK = 4 << 20;

/** Whether the file at `path` starts with the ELF magic and whether it holds `marker`. */
export async function scanExecutable(
  path: string,
  marker: Buffer,
): Promise<{ elf: boolean; holds: boolean }> {
  const handle = await open(path, "r");
  try {
    const head = Buffer.alloc(ELF_MAGIC.length);
    await handle.read(head, 0, head.length, 0);
    if (!head.equals(ELF_MAGIC)) return { elf: false, holds: false };
    const chunk = Buffer.alloc(SCAN_CHUNK);
    let carry = Buffer.alloc(0);
    for (let position = 0; ; ) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) return { elf: true, holds: false };
      const window = Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
      if (window.includes(marker)) return { elf: true, holds: true };
      carry = window.subarray(Math.max(0, window.length - marker.length + 1));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
}

/** `path -hide_banner -buildconf`'s output, or "" when it fails. */
function buildconf(path: string): Promise<string> {
  return new Promise((done) => {
    execFile(
      path,
      ["-hide_banner", "-buildconf"],
      { timeout: 60_000, maxBuffer: 1 << 20, windowsHide: true },
      (error, stdout) => done(error ? "" : String(stdout)),
    );
  });
}

/** Proven executables, by device, inode, size and modification time. */
const provenExecutables = new Map<string, ExecutableFacts>();

/**
 * Reads the executable `pid` runs (see `ExecutableFacts`), or null when it
 * cannot be opened or its path no longer names it. Cached per file.
 */
async function readExecutable(
  pid: number,
  exe: string,
  exeId: string,
): Promise<ExecutableFacts | null> {
  const running = read(() => statSync(`/proc/${pid}/exe`));
  if (!running || `${running.dev}:${running.ino}` !== exeId) return null;
  const key = `${exeId}:${running.size}:${running.mtimeMs}`;
  const known = provenExecutables.get(key);
  if (known) return known;
  // The path is run for -buildconf only while it still names the file the encoder runs.
  const named = read(() => statSync(exe));
  if (!named || `${named.dev}:${named.ino}` !== exeId) return null;
  let scanned: { elf: boolean; holds: boolean };
  try {
    scanned = await scanExecutable(`/proc/${pid}/exe`, LIBX265_BANNER);
  } catch {
    return null;
  }
  const reportsLibx265 = scanned.elf && (await buildconf(exe)).includes("--enable-libx265");
  const facts = { elf: scanned.elf, staticLibx265: scanned.holds, reportsLibx265 };
  provenExecutables.set(key, facts);
  return facts;
}

/** Why `exe` is not an ffmpeg with libx265, or null (the libx265 code itself is checked later, `libx265Problem`). */
export function executableProblem(exe: string, facts: ExecutableFacts | null): string | null {
  if (!facts) return `the encoder's executable ${exe} cannot be read`;
  if (!facts.elf) return `the encoder process runs ${exe}, which is not an ELF executable`;
  if (!facts.reportsLibx265) {
    return `the encoder process runs ${exe}, which does not report --enable-libx265`;
  }
  return null;
}

/** Whether `pid` maps a shared libx265 (`/proc/<pid>/maps`); null when it cannot be read. */
function mapsLibx265(pid: number): boolean | null {
  const maps = read(() => readFileSync(`/proc/${pid}/maps`, "latin1"));
  if (maps === null) return null;
  return maps.split("\n").some((line) => {
    const path = line.split(/\s+/).slice(5).join(" ");
    return path.startsWith("/") && basename(path).startsWith("libx265");
  });
}

/** Why the encoder holds no libx265 code, or null. */
export function libx265Problem(exe: string, staticLibx265: boolean, mapped: boolean | null) {
  if (staticLibx265 || mapped) return null;
  if (mapped === null) return "the encoder's memory maps cannot be read";
  return `the encoder process runs ${exe}, which holds no libx265 code`;
}

/** ffmpeg's (7.0 and later) name for the thread that runs a libx265 encoder. */
const LIBX265_THREAD = /^enc\d+:\d+:libx265$/;

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
 * uninterruptible wait (`D`) on `calmPolls` polls in a row, counting only
 * polls whose threads `settled` accepts (all of them by default). Rejects
 * on timeout or abort, with `EncoderPacingError` when the states cannot be
 * read (none): an unread encoder is not an idle one; and with a plain error
 * once the process is gone (null): an encoder that exited is a failure.
 */
export async function waitUntilIdle(
  states: ThreadStates,
  options: IdleWaitOptions,
  settled: (threads: readonly ThreadState[]) => boolean = () => true,
): Promise<void> {
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
    const busy = current.some((thread) => BUSY_STATES.has(thread.state));
    calm = busy || !settled(current) ? 0 : calm + 1;
  }
}

/** The proven encoder process, frame by frame (see the module comment). */
export interface EncoderPacer {
  /** Before each frame: throws `EncoderPacingError` unless the process is still the one proven. */
  check(): void;
  /** After each frame: resolves once the encoder is idle; the first also proves its libx265 thread. */
  waitUntilIdle(options: IdleWaitOptions): Promise<void>;
}

/** What `watchEncoder` reads; injectable for tests. */
export interface EncoderWatchDeps {
  readProcess: (pid: number) => EncoderProcessFacts;
  readExecutable: (pid: number, exe: string, exeId: string) => Promise<ExecutableFacts | null>;
  threads: (pid: number) => readonly ThreadState[] | null;
  mapsLibx265: (pid: number) => boolean | null;
  self: () => { pid: number; pgrp: number; session: number; exeId: string | null };
  sleep: (ms: number) => Promise<void>;
}

function readSelf() {
  const facts = readEncoderProcess(process.pid);
  return {
    pid: process.pid,
    pgrp: facts.lineage?.pgrp ?? -1,
    session: facts.lineage?.session ?? -1,
    exeId: facts.exeId,
  };
}

const DEFAULT_ENCODER_WATCH_DEPS: EncoderWatchDeps = {
  readProcess: readEncoderProcess,
  readExecutable,
  threads: procThreadStates,
  mapsLibx265,
  self: readSelf,
  sleep: defaultSleep,
};

/**
 * How long a just-spawned encoder may take to become a proven ffmpeg: it may
 * still be this process's fork, a script that has yet to exec ffmpeg in
 * place, or an ffmpeg still mapping its libraries.
 */
const EXEC_WAIT_MS = 2_000;
const EXEC_POLL_MS = 5;

/** Why `pid`, as `facts` read it, is not a proven ffmpeg with libx265 (see the module comment), or null. */
async function unprovenProblem(
  pid: number,
  facts: EncoderProcessFacts,
  self: ReturnType<EncoderWatchDeps["self"]>,
  deps: EncoderWatchDeps,
): Promise<string | null> {
  const processProblem = encoderProcessProblem(facts, self);
  if (processProblem) return processProblem;
  const exe = facts.exe as string;
  const exeId = facts.exeId as string;
  if (exeId === self.exeId) return "the encoder process never ran ffmpeg";
  const executable = await deps.readExecutable(pid, exe, exeId);
  const executableIssue = executableProblem(exe, executable);
  if (executableIssue) return executableIssue;
  const staticLibx265 = executable?.staticLibx265 === true;
  return libx265Problem(exe, staticLibx265, staticLibx265 || deps.mapsLibx265(pid));
}

/**
 * Proves `pid` is an ffmpeg with libx265 that the encode can be paced by
 * (see the module comment) and returns its pacer; rejects with
 * `EncoderPacingError` otherwise. A process not proven yet is read again
 * for up to `EXEC_WAIT_MS`: spawned and not yet executed, or exec-ing ffmpeg
 * in place, it becomes ffmpeg; anything else declines then.
 */
export async function watchEncoder(
  pid: number | undefined,
  deps: EncoderWatchDeps = DEFAULT_ENCODER_WATCH_DEPS,
): Promise<EncoderPacer> {
  if (pid === undefined) throw new EncoderPacingError("the encoder has no process id");
  const self = deps.self();
  for (let waited = 0; ; waited += EXEC_POLL_MS) {
    const facts = deps.readProcess(pid);
    const problem = await unprovenProblem(pid, facts, self, deps);
    if (!problem) return pacerFor(pid, facts.exeId as string, self, deps);
    if (waited >= EXEC_WAIT_MS) throw new EncoderPacingError(problem);
    await deps.sleep(EXEC_POLL_MS);
  }
}

/** Throws `EncoderPacingError` unless `threads` still hold the libx265 thread and every `held` one. */
function assertHeld(
  threads: readonly ThreadState[],
  held: ReadonlySet<number>,
  encoderThread: number | undefined,
): void {
  const present = new Set(threads.map((thread) => thread.tid));
  if (encoderThread === undefined || !present.has(encoderThread)) {
    throw new EncoderPacingError("the encoder's libx265 thread is gone");
  }
  for (const tid of held) {
    if (!present.has(tid)) throw new EncoderPacingError("one of the encoder's threads is gone");
  }
}

/**
 * The pacer of a proven encoder process: each frame re-checks the process;
 * the first frame's idle wait counts only once the process runs more than
 * one thread (ffmpeg starts its pipeline on its first frame) and finds
 * ffmpeg's libx265 thread among them, and that thread and every thread
 * present once the first frame went idle must be there on every later
 * poll.
 */
function pacerFor(
  pid: number,
  exeId: string,
  self: { pid: number; pgrp: number; session: number },
  deps: EncoderWatchDeps,
): EncoderPacer {
  let held: ReadonlySet<number> | undefined;
  let encoderThread: number | undefined;
  const holding = (): readonly ThreadState[] | null => {
    const threads = deps.threads(pid);
    if (!threads || threads.length === 0) return threads;
    encoderThread ??= threads.find((thread) => LIBX265_THREAD.test(thread.name))?.tid;
    if (held) assertHeld(threads, held, encoderThread);
    return threads;
  };
  return {
    check() {
      const now = deps.readProcess(pid);
      const problem = encoderProcessProblem(now, self);
      if (problem) throw new EncoderPacingError(problem);
      if (now.exeId !== exeId) {
        throw new EncoderPacingError("the encoder process runs another executable than it did");
      }
    },
    async waitUntilIdle(options) {
      if (held) return waitUntilIdle(holding, options);
      await waitUntilIdle(holding, options, (threads) => threads.length > 1);
      if (encoderThread === undefined) {
        throw new EncoderPacingError(
          "the encoder process runs no thread named for libx265 (ffmpeg 7.0 or later names it)",
        );
      }
      const threads = deps.threads(pid);
      if (!threads?.some((thread) => thread.tid === encoderThread)) {
        throw new EncoderPacingError("the encoder's libx265 thread is gone");
      }
      held = new Set(threads.map((thread) => thread.tid));
    },
  };
}
