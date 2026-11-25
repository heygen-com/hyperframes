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
 * - it reads the frames: its stdin (`/proc/<pid>/fd/0`) is the pipe it was
 *   spawned with, a pipe or socket that stays the same on every frame, and
 *   no other process of this user holds that pipe (every `/proc/<n>/fd`),
 *   read when it is proven, once its first frame has gone idle and after
 *   the last frame, before the pipe is closed. A process of this user whose
 *   descriptors cannot be read declines, unless it started before the
 *   encoder did, when it cannot have been handed the encoder's pipe at
 *   spawn. A wrapper that leaves the pipe to an ffmpeg it started outside
 *   its process tree shares it, or gives it up, and declines;
 * - after the first frame, and before that frame's idle wait can finish,
 *   the process holds ffmpeg's libx265 encoder thread (`enc0:0:libx265`;
 *   ffmpeg 7.0 and later name it; idle polls before it exists do not count,
 *   and 10 s of them decline), and from then on that thread and every
 *   thread present when the first frame went idle (x265's pool) are still
 *   there on every poll; after the last frame, that thread has run since
 *   the first frame went idle (its CPU time, `/proc/<pid>/task/<tid>/schedstat`
 *   or `stat`, grew): ffmpeg hands every frame to libx265 on it, so a thread
 *   that only bears the name stays at its CPU time.
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
  /** What its stdin is (`/proc/<pid>/fd/0`), e.g. `pipe:[123]` or `socket:[123]`. */
  stdin: string | null;
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
    stdin: read(() => readlinkSync(`/proc/${pid}/fd/0`)),
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
  if (facts.stdin === null) return "the encoder's stdin cannot be read";
  if (!SPAWNED_STDIN.test(facts.stdin)) {
    return `the encoder's stdin is ${facts.stdin}, not the pipe it was spawned with`;
  }
  return null;
}

/** The stdin `spawn` hands the encoder: a pipe or a socket pair, by inode. */
const SPAWNED_STDIN = /^(?:pipe|socket):\[\d+\]$/;

/** Who else holds the encoder's stdin (`stdinHolders`), or why that cannot be read. */
export type StdinHolders = { holders: number[] } | { unreadable: string };

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code;
/** A process or descriptor that went away while it was read. */
const isGone = (error: unknown) => errorCode(error) === "ENOENT" || errorCode(error) === "ESRCH";

/** `/proc/<pid>/stat`'s start time (clock ticks since boot). */
function startTimeOf(pid: number): number {
  const start = Number(parseStat(readFileSync(`/proc/${pid}/stat`, "latin1"))?.fields[19]);
  if (!Number.isFinite(start)) throw new Error(`unreadable stat of ${pid}`);
  return start;
}

/** The real and effective uid of `pid` (`/proc/<pid>/status`). */
function uidsOf(pid: number): number[] {
  const line = /^Uid:\s+(\d+)\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, "latin1"));
  if (!line) throw new Error(`unreadable status of ${pid}`);
  return [Number(line[1]), Number(line[2])];
}

/** Why `pid`'s descriptors could not be listed matters, or not ("gone", or false: it is older). */
function unlistedDescriptors(
  pid: number,
  error: unknown,
  encoderStart: number,
): false | "gone" | string {
  if (isGone(error)) return "gone";
  // A process older than the encoder was not handed its stdin at spawn (a non-dumpable one,
  // e.g. an ssh session's, keeps its descriptors from this user).
  if (read(() => startTimeOf(pid) < encoderStart)) return false;
  const name = read(() => /^Name:\s*(.*)$/m.exec(readFileSync(`/proc/${pid}/status`, "latin1")));
  return `process ${pid}${name ? ` (${name[1]})` : ""}'s descriptors`;
}

/** What a descriptor link names: null once it was closed while read, undefined when it cannot be read. */
function descriptorTarget(path: string): string | null | undefined {
  try {
    return readlinkSync(path);
  } catch (error) {
    return isGone(error) ? null : undefined;
  }
}

/**
 * Whether `pid` holds `stdin` among its descriptors: "gone" when it exited
 * while read, "other" when it is not this user's, or the part of it that
 * cannot be read.
 */
function holdsStdin(
  pid: number,
  uid: number,
  stdin: string,
  encoderStart: number,
): boolean | "gone" | "other" | string {
  let fds: string[];
  try {
    if (!uidsOf(pid).includes(uid)) return "other";
    fds = readdirSync(`/proc/${pid}/fd`);
  } catch (error) {
    return unlistedDescriptors(pid, error, encoderStart);
  }
  for (const fd of fds) {
    const target = descriptorTarget(`/proc/${pid}/fd/${fd}`);
    if (target === stdin) return true;
    if (target === undefined) return `process ${pid}'s descriptor ${fd}`;
  }
  return false;
}

/**
 * How long a process whose descriptors could not be read is read again
 * (first after 5 ms, then twice as long each time, up to 200 ms apart): a
 * process starting up (a browser's helper, a shell running a command)
 * cannot be read until its `execve` is done, which takes a few hundred
 * milliseconds on a loaded host.
 */
const UNREADABLE_WAIT_MS = 5_000;
const UNREADABLE_FIRST_REREAD_MS = 5;
const UNREADABLE_MAX_REREAD_MS = 200;

/**
 * The processes of this user, other than the encoder `pid` and this one,
 * that hold `stdin` (the encoder's), from every `/proc/<n>/fd`; or what
 * could not be read.
 */
export async function stdinHolders(
  pid: number,
  stdin: string,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<StdinHolders> {
  const uid = process.getuid?.();
  if (uid === undefined) return { unreadable: "this process's user" };
  const encoderStart = read(() => startTimeOf(pid));
  if (encoderStart === null) return { unreadable: "the encoder's start time" };
  const entries = read(() => readdirSync("/proc"));
  if (entries === null) return { unreadable: "/proc" };
  const holders: number[] = [];
  let unread = new Map<number, string>();
  const scan = (other: number) => {
    const holds = holdsStdin(other, uid, stdin, encoderStart);
    if (holds === true) holders.push(other);
    else if (typeof holds === "string" && holds !== "gone" && holds !== "other") {
      unread.set(other, holds);
    }
  };
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const other = Number(entry);
    if (other !== pid && other !== process.pid) scan(other);
  }
  for (
    let delay = UNREADABLE_FIRST_REREAD_MS, waited = 0;
    unread.size > 0 && waited < UNREADABLE_WAIT_MS;
    waited += delay, delay = Math.min(delay * 2, UNREADABLE_MAX_REREAD_MS)
  ) {
    await sleep(delay);
    const pending = [...unread.keys()];
    unread = new Map();
    for (const other of pending) scan(other);
  }
  const [unreadable] = unread.values();
  return unreadable === undefined ? { holders } : { unreadable };
}

/** Why `scan` (of the encoder's stdin) does not leave it the encoder's alone, or null. */
function stdinHoldersProblem(scan: StdinHolders): string | null {
  if ("unreadable" in scan) {
    return `who holds the encoder's stdin cannot be read (${scan.unreadable})`;
  }
  if (scan.holders.length === 0) return null;
  return `process(es) ${scan.holders.join(", ")} also hold the encoder's stdin`;
}

/**
 * The CPU time thread `tid` of `pid` has run, in ns: `schedstat`'s, or
 * `stat`'s utime + stime (clock ticks of 10 ms); null when neither can be read.
 */
export function threadCpuNs(pid: number, tid: number): number | null {
  const scheduled = read(() =>
    Number(readFileSync(`/proc/${pid}/task/${tid}/schedstat`, "latin1").split(" ")[0]),
  );
  if (scheduled !== null && Number.isFinite(scheduled)) return scheduled;
  const fields = read(() => parseStat(readFileSync(`/proc/${pid}/task/${tid}/stat`, "latin1")));
  const ticks = Number(fields?.fields[11]) + Number(fields?.fields[12]);
  return Number.isFinite(ticks) ? ticks * 10_000_000 : null;
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
  /**
   * After the last frame's idle wait, before the encoder's stdin is closed:
   * throws `EncoderPacingError` unless the process is still the one proven,
   * holds its stdin alone and ran libx265 after the first frame.
   */
  finish(): Promise<void>;
}

/** What `watchEncoder` reads; injectable for tests. */
export interface EncoderWatchDeps {
  readProcess: (pid: number) => EncoderProcessFacts;
  readExecutable: (pid: number, exe: string, exeId: string) => Promise<ExecutableFacts | null>;
  threads: (pid: number) => readonly ThreadState[] | null;
  mapsLibx265: (pid: number) => boolean | null;
  stdinHolders: (pid: number, stdin: string) => Promise<StdinHolders>;
  threadCpuNs: (pid: number, tid: number) => number | null;
  self: () => { pid: number; pgrp: number; session: number; exeId: string | null };
  sleep: (ms: number) => Promise<void>;
  now: () => number;
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
  stdinHolders,
  threadCpuNs,
  self: readSelf,
  sleep: defaultSleep,
  now: Date.now,
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
  const libx265Issue = libx265Problem(exe, staticLibx265, staticLibx265 || deps.mapsLibx265(pid));
  if (libx265Issue) return libx265Issue;
  return stdinHoldersProblem(await deps.stdinHolders(pid, facts.stdin as string));
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
    if (!problem) return pacerFor(pid, facts as ProvenFacts, self, deps);
    if (waited >= EXEC_WAIT_MS) throw new EncoderPacingError(problem);
    await deps.sleep(EXEC_POLL_MS);
  }
}

/**
 * How long the first frame's idle wait goes on finding the process idle with
 * no libx265 thread before it declines: on a loaded host ffmpeg can sit idle
 * between its first threads and the encoder thread it starts once the first
 * frame reaches the encoder, and an idle count there would hold the threads
 * of a pipeline still starting up.
 */
const LIBX265_THREAD_WAIT_MS = 10_000;

const NO_LIBX265_THREAD =
  "the encoder process runs no thread named for libx265 (ffmpeg 7.0 or later names it)";

/** The held threads (and the libx265 thread) `threads` lacks, as "tid (name)"; empty when none. */
function missingThreads(
  threads: readonly ThreadState[],
  held: ReadonlyMap<number, string>,
  encoderThread: number | undefined,
): string[] {
  const present = new Set(threads.map((thread) => thread.tid));
  const missing = [...held].filter(([tid]) => !present.has(tid));
  if (encoderThread !== undefined && !held.has(encoderThread) && !present.has(encoderThread)) {
    missing.push([encoderThread, "libx265"]);
  }
  return missing.map(([tid, name]) => `${tid} (${name})`);
}

/**
 * A poll that misses a held thread reads the threads again this many times
 * before the thread counts as gone: a `/proc` read that fails for another
 * reason than the thread exiting (on a loaded host) leaves it out of one
 * listing without its being gone.
 */
const GONE_REREADS = 3;

/**
 * `threads`, or a re-read (`read`, up to `GONE_REREADS` times) once it
 * misses a held thread; throws `EncoderPacingError` naming the threads every
 * read missed. A re-read with no states is returned as it is, for the idle
 * wait to judge.
 */
function stillHeld(
  threads: readonly ThreadState[],
  read: () => readonly ThreadState[] | null,
  held: ReadonlyMap<number, string>,
  encoderThread: number | undefined,
): readonly ThreadState[] | null {
  let current: readonly ThreadState[] | null = threads;
  for (let reread = 0; reread <= GONE_REREADS; reread++) {
    if (reread > 0) current = read();
    if (!current || current.length === 0) return current;
    const missing = missingThreads(current, held, encoderThread);
    if (missing.length === 0) return current;
    if (reread === GONE_REREADS) {
      throw new EncoderPacingError(`the encoder's thread ${missing.join(", ")} is gone`);
    }
  }
  return current;
}

/** The facts of a proven encoder process: its executable and stdin as they were proven. */
type ProvenFacts = EncoderProcessFacts & { exeId: string; stdin: string };

/**
 * The pacer of a proven encoder process: each frame re-checks the process;
 * the first frame's idle wait counts only once the process runs more than
 * one thread (ffmpeg starts its pipeline on its first frame) and ffmpeg's
 * libx265 thread among them (declining once it has been idle without one
 * for `LIBX265_THREAD_WAIT_MS`), and that thread and every thread
 * present once the first frame went idle must be there on every later
 * poll. Once the first frame has gone idle and at `finish`, no other process
 * may hold the encoder's stdin; at `finish`, the libx265 thread must have
 * run since that first idle.
 */
function pacerFor(
  pid: number,
  proven: ProvenFacts,
  self: { pid: number; pgrp: number; session: number },
  deps: EncoderWatchDeps,
): EncoderPacer {
  let held: ReadonlyMap<number, string> | undefined;
  let encoderThread: number | undefined;
  let firstIdleCpuNs: number | undefined;
  const stdinAlone = async () => {
    const problem = stdinHoldersProblem(await deps.stdinHolders(pid, proven.stdin));
    if (problem) throw new EncoderPacingError(problem);
  };
  const encoderCpuNs = (): number => {
    const cpu = encoderThread === undefined ? null : deps.threadCpuNs(pid, encoderThread);
    if (cpu === null) throw new EncoderPacingError("the libx265 thread's CPU time cannot be read");
    return cpu;
  };
  const holding = (): readonly ThreadState[] | null => {
    const threads = deps.threads(pid);
    if (!threads || threads.length === 0) return threads;
    encoderThread ??= threads.find((thread) => LIBX265_THREAD.test(thread.name))?.tid;
    return held ? stillHeld(threads, () => deps.threads(pid), held, encoderThread) : threads;
  };
  const check = () => {
    const now = deps.readProcess(pid);
    const problem = encoderProcessProblem(now, self);
    if (problem) throw new EncoderPacingError(problem);
    if (now.exeId !== proven.exeId) {
      throw new EncoderPacingError("the encoder process runs another executable than it did");
    }
    if (now.stdin !== proven.stdin) {
      throw new EncoderPacingError(
        `the encoder's stdin is ${now.stdin}, not the pipe it was spawned with (${proven.stdin})`,
      );
    }
  };
  return {
    check,
    async waitUntilIdle(options) {
      if (held) return waitUntilIdle(holding, options);
      let idleSince: number | undefined;
      await waitUntilIdle(holding, options, (threads) => {
        if (threads.length <= 1) return false;
        if (encoderThread !== undefined) return true;
        // Idle with no libx265 thread: ffmpeg has yet to start it, or encodes with something else.
        idleSince ??= deps.now();
        if (deps.now() - idleSince > LIBX265_THREAD_WAIT_MS) {
          throw new EncoderPacingError(NO_LIBX265_THREAD);
        }
        return false;
      });
      if (encoderThread === undefined) throw new EncoderPacingError(NO_LIBX265_THREAD);
      const threads = deps.threads(pid);
      if (!threads?.some((thread) => thread.tid === encoderThread)) {
        throw new EncoderPacingError("the encoder's libx265 thread is gone");
      }
      held = new Map(threads.map((thread) => [thread.tid, thread.name]));
      await stdinAlone();
      firstIdleCpuNs = encoderCpuNs();
    },
    async finish() {
      if (firstIdleCpuNs === undefined) throw new EncoderPacingError("no frame was paced");
      check();
      await stdinAlone();
      if (!(encoderCpuNs() > firstIdleCpuNs)) {
        throw new EncoderPacingError("the libx265 thread has not run since the first frame");
      }
    },
  };
}
