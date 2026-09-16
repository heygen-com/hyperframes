// fallow-ignore-file code-duplication
import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runRenderSetupWorker } from "./cancellableProcess.js";
import { terminateProcessTree, windowsProcessTreeKillArgs } from "./processTree.js";

export { windowsProcessTreeKillArgs };

/**
 * Find and kill orphaned Chrome processes from previous crashed sessions.
 * Targets both chrome-headless-shell (production/CI) and Google Chrome
 * launched by Puppeteer (dev mode). Puppeteer Chrome is identified by the
 * `puppeteer_dev_chrome_profile` marker in its user-data-dir argument.
 *
 * An orphan is a process whose PPID=1 (reparented to init/launchd after
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

  return killed;
}

export async function killOrphanedProcessesForRender(signal: AbortSignal): Promise<number> {
  return runRenderSetupWorker<number>("orphan-cleanup", {}, { signal, timeoutMs: 15_000 });
}

export function killProcessTree(pid: number, signal: NodeJS.Signals = "SIGTERM"): void {
  void terminateProcessTree(pid, { signal }).catch(() => undefined);
}

/**
 * Return a process birth token suitable for detecting PID reuse. The token is
 * diagnostic state only: callers must still prove the live server is a
 * descendant before treating a saved wrapper as the owned process-tree root.
 */
export function processIdentity(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === "win32") {
      const created = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' -ErrorAction SilentlyContinue; if ($p) { $p.CreationDate.ToFileTimeUtc() }`,
        ],
        {
          encoding: "utf8",
          timeout: 2000,
          stdio: ["pipe", "pipe", "ignore"],
          windowsHide: true,
        },
      ).trim();
      return created ? `windows:${created}` : null;
    }

    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat
        .slice(stat.lastIndexOf(") ") + 2)
        .trim()
        .split(/\s+/);
      const startTicks = fields[19]; // field 22 overall; fields starts at process state (3)
      return startTicks ? `linux:${startTicks}` : null;
    }

    const started = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
    return started ? `posix:${started}` : null;
  } catch {
    return null;
  }
}

type ParentPidLookup = (pid: number) => number | null;

export interface ProcessAncestor {
  pid: number;
  identity: string;
}

interface ProcessRecord extends ProcessAncestor {
  parentPid: number;
}

function recordsToAncestors(pid: number, records: readonly ProcessRecord[]): ProcessAncestor[] {
  const byPid = new Map(records.map((record) => [record.pid, record]));
  const ancestors: ProcessAncestor[] = [];
  const visited = new Set<number>([pid]);
  let current = pid;

  for (let depth = 0; depth < 64; depth++) {
    const parent = byPid.get(current)?.parentPid;
    if (parent === undefined || parent <= 1 || visited.has(parent)) break;
    visited.add(parent);
    const ancestor = byPid.get(parent);
    if (!ancestor) break;
    ancestors.push({ pid: ancestor.pid, identity: ancestor.identity });
    current = parent;
  }

  return ancestors;
}

/**
 * Capture an off-Linux ancestor chain in one process-table lookup. This keeps
 * the birth token attached to every tracked PID without a PowerShell/ps spawn
 * for each ancestor.
 */
export function processAncestorSnapshot(pid: number): ProcessAncestor[] {
  if (!Number.isInteger(pid) || pid <= 0 || process.platform === "linux") return [];
  try {
    if (process.platform === "win32") {
      const output = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.CreationDate.ToFileTimeUtc())" }',
        ],
        { encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
      );
      const records = output
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/))
        .map(([processId, parentProcessId, creationDate]) => ({
          pid: Number(processId),
          parentPid: Number(parentProcessId),
          identity: creationDate ? `windows:${creationDate}` : "",
        }))
        .filter(
          (record): record is ProcessRecord =>
            Number.isInteger(record.pid) &&
            record.pid > 0 &&
            Number.isInteger(record.parentPid) &&
            record.parentPid > 0 &&
            record.identity !== "",
        );
      return recordsToAncestors(pid, records);
    }

    const output = execFileSync("ps", ["-axo", "pid=,ppid=,lstart="], {
      encoding: "utf8",
      timeout: 2000,
    });
    const records = output
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map(([, processId, parentProcessId, started]) => ({
        pid: Number(processId),
        parentPid: Number(parentProcessId),
        identity: `posix:${started?.trim() ?? ""}`,
      }));
    return recordsToAncestors(pid, records);
  } catch {
    return [];
  }
}

export function processParentPid(pid: number): number | null {
  try {
    const output =
      process.platform === "win32"
        ? execFileSync(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' -ErrorAction SilentlyContinue; if ($p) { $p.ParentProcessId }`,
            ],
            {
              encoding: "utf8",
              timeout: 2000,
              stdio: ["pipe", "pipe", "ignore"],
              windowsHide: true,
            },
          )
        : execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], {
            encoding: "utf8",
            timeout: 2000,
          });
    const parentPid = Number(output.trim());
    return Number.isInteger(parentPid) && parentPid > 0 ? parentPid : null;
  } catch {
    return null;
  }
}

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
  try {
    const ppid = execSync(`ps -p ${pid} -o ppid=`, {
      encoding: "utf-8",
      timeout: 2000,
    }).trim();
    return ppid === "1";
  } catch {
    return false;
  }
}
