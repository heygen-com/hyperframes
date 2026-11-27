import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { uptime } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { cannotHardLink, replaceFileAtomicallyAsync } from "@hyperframes/core/atomic-file";

const run = promisify(execFile);

export class HistoryBusyError extends Error {
  constructor(
    readonly pid: number,
    readonly url?: string,
  ) {
    super(`This project's history is open in another process (pid ${pid}).`);
    this.name = "HistoryBusyError";
  }
}

const WINDOWS_BUSY = new Set(["EPERM", "EBUSY", "EACCES"]);
const TAKING_MS = 2_000;
const BOOT_SLACK_MS = 60_000;
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const NON_BLOCK = constants.O_NONBLOCK ?? 0;
const LINKED = new Set(["ELOOP", "EMLINK"]);
const WRITE_REFUSED = new Set(["EPERM", "EACCES", "EROFS"]);

function busyOnWindows(error: unknown): boolean {
  return (
    process.platform === "win32" && WINDOWS_BUSY.has((error as NodeJS.ErrnoException).code ?? "")
  );
}

function mayOnlyRead(error: unknown): boolean {
  return !busyOnWindows(error) && WRITE_REFUSED.has((error as NodeJS.ErrnoException).code ?? "");
}

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** What identifies `pid`'s process among those that ever had the number: its start time. Null where unreadable. */
export async function processStart(pid: number): Promise<string | null> {
  try {
    if (process.platform === "linux") {
      const fields = await readFile(`/proc/${pid}/stat`, "utf-8");
      return fields.slice(fields.lastIndexOf(")") + 2).split(" ")[19] ?? null;
    }
    if (process.platform === "win32") return null;
    const ps = await run("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf-8",
      env: { ...process.env, LC_ALL: "C" },
    });
    return ps.stdout.trim() || null;
  } catch {
    return null;
  }
}

/** The text of `path` when it names a regular file, else null; a link is never followed, a FIFO never waited on. */
export async function readPlainFile(path: string): Promise<string | null> {
  const handle = await open(path, constants.O_RDONLY | NO_FOLLOW | NON_BLOCK);
  try {
    return (await handle.stat()).isFile() ? await handle.readFile("utf-8") : null;
  } finally {
    await handle.close();
  }
}

async function recordedStart(file: string, pid: number): Promise<string | null> {
  try {
    const [owner, ...start] = ((await readPlainFile(`${file}.start`)) ?? "").split("\n");
    return Number(owner) === pid && start.length > 0 ? start.join("\n") : null;
  } catch {
    return null;
  }
}

export async function replaceOwnFile(path: string, content: string): Promise<void> {
  await rm(path, { force: true });
  await replaceFileAtomicallyAsync(path, content);
}

async function recordStart(file: string): Promise<void> {
  const start = await processStart(process.pid);
  if (start) await replaceOwnFile(`${file}.start`, `${process.pid}\n${start}`);
}

/** Whether `pid` still runs the process that took `file`: its recorded start matches, else the lock postdates boot. */
async function holdsLock(file: string, pid: number): Promise<boolean> {
  if (!alive(pid)) return false;
  const recorded = await recordedStart(file, pid);
  if (recorded !== null) {
    const now = await processStart(pid);
    return now === null || now === recorded;
  }
  try {
    return (await stat(file)).mtimeMs > Date.now() - uptime() * 1000 - BOOT_SLACK_MS;
  } catch {
    return true;
  }
}

/** The pid in `file`; null when there is no file, NaN when it holds no pid or is no plain file (so it reads as dead). */
async function ownerOf(file: string): Promise<number | null> {
  try {
    const text = await readPlainFile(file);
    return text !== null && /^\d+$/.test(text) ? Number(text) : Number.NaN;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    if (code === "ENOENT") return null;
    if (LINKED.has(code)) return Number.NaN;
    throw error;
  }
}

/** An empty lock younger than TAKING_MS is a claim between create and write, not a dead owner's. */
async function beingTaken(file: string): Promise<boolean> {
  try {
    const { size, mtimeMs } = await stat(file);
    return size === 0 && Date.now() - mtimeMs < TAKING_MS;
  } catch {
    return false;
  }
}

async function deadHolder(file: string, pid: number): Promise<boolean> {
  return !(await holdsLock(file, pid)) && !(await beingTaken(file));
}

/** Takes `file` if nobody holds it: linked in whole, or created in place where links fail. */
async function claim(file: string): Promise<boolean> {
  const draft = `${file}-${process.pid}-${randomUUID()}.tmp`;
  await writeFile(draft, String(process.pid));
  try {
    try {
      await link(draft, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      if (!cannotHardLink(error)) throw error;
      return createExclusively(file);
    }
    return await recordOwnership(file);
  } finally {
    await rm(draft, { force: true });
  }
}

async function createExclusively(file: string): Promise<boolean> {
  try {
    await writeFile(file, String(process.pid), { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return false;
  }
  return recordOwnership(file);
}

async function recordOwnership(file: string): Promise<true> {
  try {
    await recordStart(file);
    return true;
  } catch (error) {
    await releaseOwn(file);
    throw error;
  }
}

/** Removes `file` only while it names this process, so a release never takes a later owner's lock. */
async function releaseOwn(file: string): Promise<void> {
  if ((await ownerOf(file)) !== process.pid) return;
  await rm(`${file}.start`, { force: true });
  await rm(file, { force: true });
}

/**
 * Removes a dead owner's lock under an evict lock, re-reading the owner, so a live owner's lock survives. False when
 * another evictor holds it. ponytail: a crashed evictor's lock is cleared unguarded; racing that can give two owners.
 */
async function evictDeadOwner(file: string): Promise<boolean> {
  const evictor = `${file}.evict`;
  if (!(await claim(evictor))) {
    const holder = await ownerOf(evictor);
    if (holder !== null && (await deadHolder(evictor, holder))) await rm(evictor, { force: true });
    return false;
  }
  try {
    const pid = await ownerOf(file);
    if (pid !== null && (await deadHolder(file, pid))) {
      await rm(`${file}.start`, { force: true });
      await rm(file, { force: true });
    }
    return true;
  } finally {
    await releaseOwn(evictor);
  }
}

/** The owner's url sits beside owner.pid, so readers of owner.pid from older versions see no change. */
async function advertise(urlFile: string, url: string | undefined): Promise<void> {
  if (!url) return rm(urlFile, { force: true });
  await replaceFileAtomicallyAsync(urlFile, JSON.stringify({ pid: process.pid, url }));
}

/** The url `pid` advertised, only while `pid` is alive and still holds `file`. */
async function servedBy(file: string, urlFile: string, pid: number): Promise<string | undefined> {
  try {
    const said = JSON.parse((await readPlainFile(urlFile)) ?? "") as {
      pid?: unknown;
      url?: unknown;
    };
    const live = said.pid === pid && (await holdsLock(file, pid)) && (await ownerOf(file)) === pid;
    return live && typeof said.url === "string" ? said.url : undefined;
  } catch {
    return undefined;
  }
}

type Attempt = "claimed" | "retry" | "wait";

async function claimOrBusy(file: string, urlFile: string): Promise<boolean> {
  try {
    return await claim(file);
  } catch (error) {
    const pid = mayOnlyRead(error) ? await ownerOf(file) : null;
    if (pid === null || (await deadHolder(file, pid))) throw error;
    throw new HistoryBusyError(pid, await servedBy(file, urlFile, pid));
  }
}

async function attemptClaim(file: string, urlFile: string, deadline: number): Promise<Attempt> {
  if (await claimOrBusy(file, urlFile)) return "claimed";
  const pid = await ownerOf(file);
  if (pid === null) return "retry";
  if ((await deadHolder(file, pid)) && (await evictDeadOwner(file))) return "retry";
  if (Date.now() >= deadline) throw new HistoryBusyError(pid, await servedBy(file, urlFile, pid));
  return "wait";
}

/**
 * One process at a time keeps a project's history open (a second opener would fork the log). Waits up to `waitMs`
 * for the owner to close, takes over a dead owner's lock. `url` is where this process serves the history's routes.
 */
export async function takeHistoryOwnership(
  home: string,
  waitMs: number,
  url?: string,
): Promise<() => Promise<void>> {
  const file = join(home, "owner.pid");
  const urlFile = join(home, "owner-url.json");
  const deadline = Date.now() + waitMs;
  await mkdir(home, { recursive: true });
  for (;;) {
    let next: Attempt = "wait";
    try {
      next = await attemptClaim(file, urlFile, deadline);
    } catch (error) {
      if (!busyOnWindows(error) || Date.now() >= deadline) throw error;
    }
    if (next === "claimed") break;
    if (next === "wait") await new Promise((settle) => setTimeout(settle, 50));
  }
  try {
    await advertise(urlFile, url);
  } catch (error) {
    await releaseOwn(file);
    throw error;
  }
  const release = async () => {
    if (await servedBy(file, urlFile, process.pid)) await rm(urlFile, { force: true });
    await releaseOwn(file);
  };
  let released: Promise<void> | undefined;
  return () =>
    (released ??= release().catch((error: unknown) => {
      released = undefined;
      throw error;
    }));
}
