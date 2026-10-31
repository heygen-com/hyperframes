import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { uptime } from "node:os";
import { join } from "node:path";
import { replaceFileAtomically } from "@hyperframes/core/atomic-file";

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
const NO_HARD_LINKS = new Set(["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EPERM"]);
const TAKING_MS = 2_000;
const BOOT_SLACK_MS = 60_000;

function busyOnWindows(error: unknown): boolean {
  return (
    process.platform === "win32" && WINDOWS_BUSY.has((error as NodeJS.ErrnoException).code ?? "")
  );
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
export function processStart(pid: number): string | null {
  try {
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
      return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
    }
    if (process.platform === "win32") return null;
    const ps = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf-8",
      env: { ...process.env, LC_ALL: "C" },
    });
    return ps.status === 0 ? ps.stdout.trim() || null : null;
  } catch {
    return null;
  }
}

function recordedStart(file: string, pid: number): string | null {
  try {
    const [owner, ...start] = readFileSync(`${file}.start`, "utf-8").split("\n");
    return Number(owner) === pid && start.length > 0 ? start.join("\n") : null;
  } catch {
    return null;
  }
}

function recordStart(file: string): void {
  const start = processStart(process.pid);
  if (start) writeFileSync(`${file}.start`, `${process.pid}\n${start}`);
}

/** Whether `pid` still runs the process that took `file`: its recorded start matches, else the lock postdates boot. */
function holdsLock(file: string, pid: number): boolean {
  if (!alive(pid)) return false;
  const recorded = recordedStart(file, pid);
  if (recorded !== null) {
    const now = processStart(pid);
    return now === null || now === recorded;
  }
  try {
    return statSync(file).mtimeMs > Date.now() - uptime() * 1000 - BOOT_SLACK_MS;
  } catch {
    return true;
  }
}

/** The pid in `file`; null when there is no file, NaN when it holds no pid (so it reads as dead). */
function ownerOf(file: string): number | null {
  try {
    const text = readFileSync(file, "utf-8");
    return /^\d+$/.test(text) ? Number(text) : Number.NaN;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** An empty lock younger than TAKING_MS is a claim between create and write, not a dead owner's. */
function beingTaken(file: string): boolean {
  try {
    const { size, mtimeMs } = statSync(file);
    return size === 0 && Date.now() - mtimeMs < TAKING_MS;
  } catch {
    return false;
  }
}

function deadHolder(file: string, pid: number): boolean {
  return !holdsLock(file, pid) && !beingTaken(file);
}

/** Takes `file` if nobody holds it: linked in whole, or created in place where links fail. */
function claim(file: string): boolean {
  const draft = `${file}-${process.pid}-${randomUUID()}.tmp`;
  writeFileSync(draft, String(process.pid));
  try {
    try {
      linkSync(draft, file);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (code === "EEXIST") return false;
      if (!NO_HARD_LINKS.has(code)) throw error;
      return createExclusively(file);
    }
    return recordOwnership(file);
  } finally {
    rmSync(draft, { force: true });
  }
}

function createExclusively(file: string): boolean {
  try {
    writeFileSync(file, String(process.pid), { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return false;
  }
  return recordOwnership(file);
}

function recordOwnership(file: string): true {
  try {
    recordStart(file);
    return true;
  } catch (error) {
    releaseOwn(file);
    throw error;
  }
}

/** Removes `file` only while it names this process, so a release never takes a later owner's lock. */
function releaseOwn(file: string): void {
  if (ownerOf(file) !== process.pid) return;
  rmSync(file, { force: true });
  rmSync(`${file}.start`, { force: true });
}

/**
 * Removes a dead owner's lock under an evict lock, re-reading the owner, so a live owner's lock survives. False when
 * another evictor holds it. ponytail: a crashed evictor's lock is cleared unguarded; racing that can give two owners.
 */
function evictDeadOwner(file: string): boolean {
  const evictor = `${file}.evict`;
  if (!claim(evictor)) {
    const holder = ownerOf(evictor);
    if (holder !== null && deadHolder(evictor, holder)) rmSync(evictor, { force: true });
    return false;
  }
  try {
    const pid = ownerOf(file);
    if (pid !== null && deadHolder(file, pid)) {
      rmSync(file, { force: true });
      rmSync(`${file}.start`, { force: true });
    }
    return true;
  } finally {
    releaseOwn(evictor);
  }
}

/** The owner's url sits beside owner.pid, so readers of owner.pid from older versions see no change. */
function advertise(urlFile: string, url: string | undefined): void {
  if (!url) return rmSync(urlFile, { force: true });
  replaceFileAtomically(urlFile, JSON.stringify({ pid: process.pid, url }));
}

/** The url `pid` advertised, only while `pid` is alive and still holds `file`. */
function servedBy(file: string, urlFile: string, pid: number): string | undefined {
  try {
    const said = JSON.parse(readFileSync(urlFile, "utf-8")) as { pid?: unknown; url?: unknown };
    const live = said.pid === pid && holdsLock(file, pid) && ownerOf(file) === pid;
    return live && typeof said.url === "string" ? said.url : undefined;
  } catch {
    return undefined;
  }
}

type Attempt = "claimed" | "retry" | "wait";

function attemptClaim(file: string, urlFile: string, deadline: number): Attempt {
  if (claim(file)) return "claimed";
  const pid = ownerOf(file);
  if (pid === null) return "retry";
  if (deadHolder(file, pid) && evictDeadOwner(file)) return "retry";
  if (Date.now() >= deadline) throw new HistoryBusyError(pid, servedBy(file, urlFile, pid));
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
): Promise<() => void> {
  const file = join(home, "owner.pid");
  const urlFile = join(home, "owner-url.json");
  const deadline = Date.now() + waitMs;
  mkdirSync(home, { recursive: true });
  for (;;) {
    let next: Attempt = "wait";
    try {
      next = attemptClaim(file, urlFile, deadline);
    } catch (error) {
      if (!busyOnWindows(error) || Date.now() >= deadline) throw error;
    }
    if (next === "claimed") break;
    if (next === "wait") await new Promise((settle) => setTimeout(settle, 50));
  }
  try {
    advertise(urlFile, url);
  } catch (error) {
    releaseOwn(file);
    throw error;
  }
  let held = true;
  return () => {
    if (held && servedBy(file, urlFile, process.pid)) rmSync(urlFile, { force: true });
    if (held) releaseOwn(file);
    held = false;
  };
}
