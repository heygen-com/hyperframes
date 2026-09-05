import { execFileSync, execSync } from "node:child_process";
import {
  findOwnedOrphanedFfmpegProcesses,
  type OwnedFfmpegProcess,
  processIdentity,
  processParentPid,
} from "@hyperframes/engine/process-tracker";

export { processIdentity };

/**
 * Find and kill orphaned Chrome and HyperFrames-owned FFmpeg processes from
 * previous crashed sessions.
 * Targets both chrome-headless-shell (production/CI) and Google Chrome
 * launched by Puppeteer (dev mode). Puppeteer Chrome is identified by the
 * `puppeteer_dev_chrome_profile` marker in its user-data-dir argument.
 *
 * FFmpeg recovery additionally requires a private process-tracker record with
 * a matching birth identity, so an unrelated same-user encoder is never
 * selected by name. An orphan is a process whose PPID=1 (reparented to init/launchd after
 * its parent died). We kill the orphan's entire subtree so child helper
 * processes (GPU, renderer, network, etc.) are also cleaned up.
 *
 * Scoped to the current user via `pgrep -u` to avoid touching other
 * users' processes on shared machines.
 *
 * Returns the count of killed process trees.
 */
export function killOrphanedProcesses(): number {
  if (process.platform === "win32") return 0;

  let killed = 0;

  for (const name of ["chrome-headless-shell", "chrome_headless_shell"]) {
    killed += killOrphansByName(name);
  }

  killed += killOrphansByName("puppeteer_dev_chrome_profile");
  killed += killOwnedOrphanedFfmpegProcesses();

  return killed;
}

export function killOwnedOrphanedFfmpegProcesses(
  records: OwnedFfmpegProcess[] = findOwnedOrphanedFfmpegProcesses(),
  kill: (
    pid: number,
    signal?: NodeJS.Signals,
    stillOwned?: () => boolean,
  ) => void = killProcessTree,
  identityForPid: (pid: number) => string | null = processIdentity,
): number {
  let killed = 0;
  for (const record of records) {
    const stillOwned = () => identityForPid(record.pid) === record.identity;
    if (!stillOwned()) continue;
    kill(record.pid, "SIGTERM", stillOwned);
    killed++;
  }
  return killed;
}

/**
 * Kill an entire process tree rooted at `pid`. Walks descendants
 * depth-first so children are killed before parents, preventing
 * re-adoption races.
 *
 * Windows uses taskkill's tree mode because pgrep/ps are unavailable there.
 *
 * `signal` is honoured on POSIX only. The Windows path always passes `/F`, so a
 * caller asking for SIGTERM gets a forced tree kill with no grace period, while
 * the same call on POSIX gets 500 ms to flush and exit. That is deliberate —
 * `taskkill` without `/F` posts WM_CLOSE, which a console process is free to
 * ignore, and leaving a preview server alive is the worse failure here. Do not
 * pass SIGTERM expecting a clean shutdown on Windows.
 */
export function killProcessTree(
  pid: number,
  signal: NodeJS.Signals = "SIGTERM",
  stillOwned: () => boolean = () => true,
): void {
  if (!stillOwned()) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", windowsProcessTreeKillArgs(pid), {
        stdio: "ignore",
        timeout: 5000,
        windowsHide: true,
      });
    } catch {
      // Process already exited or taskkill could not inspect it.
    }
    return;
  }

  const descendants = getDescendants(pid);
  const allPids = [...descendants.reverse(), pid];
  const identities = new Map(allPids.map((candidate) => [candidate, processIdentity(candidate)]));

  for (const p of allPids) {
    if (!stillOwned()) return;
    try {
      process.kill(p, signal);
    } catch {
      // Already exited.
    }
  }

  // Escalate to SIGKILL after a short grace period for any survivors.
  if (signal !== "SIGKILL") {
    setTimeout(() => {
      if (!stillOwned()) return;
      for (const p of allPids) {
        const identity = identities.get(p);
        if (!identity || processIdentity(p) !== identity) continue;
        try {
          process.kill(p, "SIGKILL");
        } catch {
          // Already exited.
        }
      }
    }, 500).unref();
  }
}

export function windowsProcessTreeKillArgs(pid: number): string[] {
  return ["/PID", String(pid), "/T", "/F"];
}

type ParentPidLookup = (pid: number) => number | null;

/**
 * Prove that `childPid` currently belongs to the process tree rooted at
 * `ancestorPid`. The walk fails closed on missing, invalid, or cyclic process
 * metadata so a stale saved PID can never authorize terminating a new process.
 */
export function isProcessDescendant(
  childPid: number,
  ancestorPid: number,
  parentPid: ParentPidLookup = processParentPid,
): boolean {
  if (childPid <= 0 || ancestorPid <= 0 || childPid === ancestorPid) return false;

  const visited = new Set<number>();
  let current = childPid;
  for (let depth = 0; depth < 64; depth++) {
    if (visited.has(current)) return false;
    visited.add(current);
    const parent = parentPid(current);
    if (parent === ancestorPid) return true;
    if (parent === null || parent <= 1) return false;
    current = parent;
  }
  return false;
}

function getDescendants(pid: number): number[] {
  let children: number[];
  try {
    const raw = execSync(`pgrep -P ${pid}`, {
      encoding: "utf-8",
      timeout: 2000,
    }).trim();
    if (!raw) return [];
    children = raw
      .split("\n")
      .map((s) => parseInt(s, 10))
      .filter((n) => !isNaN(n) && n > 0);
  } catch {
    return [];
  }
  const all: number[] = [];
  for (const child of children) {
    all.push(child);
    all.push(...getDescendants(child));
  }
  return all;
}

function killOrphansByName(processName: string): number {
  const uid = getUid();
  const userFlag = uid !== null ? `-u ${uid} ` : "";
  let pids: number[];
  try {
    const raw = execSync(`pgrep ${userFlag}-f ${processName}`, {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    if (!raw) return 0;
    pids = raw
      .split("\n")
      .map((s) => parseInt(s, 10))
      .filter((n) => !isNaN(n) && n > 0);
  } catch {
    return 0;
  }

  let killed = 0;
  for (const pid of pids) {
    if (!isOrphan(pid)) continue;
    killProcessTree(pid);
    killed++;
  }
  return killed;
}

let _cachedUid: string | null | undefined;

function getUid(): string | null {
  if (_cachedUid !== undefined) return _cachedUid;
  try {
    _cachedUid = execSync("id -u", { encoding: "utf-8", timeout: 1000 }).trim();
  } catch {
    _cachedUid = null;
  }
  return _cachedUid;
}

function isOrphan(pid: number): boolean {
  return processParentPid(pid) === 1;
}
