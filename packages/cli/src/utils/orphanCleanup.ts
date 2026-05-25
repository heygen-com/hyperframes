import { execSync } from "node:child_process";

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

/**
 * Kill an entire process tree rooted at `pid`. Walks descendants
 * depth-first so children are killed before parents, preventing
 * re-adoption races.
 *
 * No-op on Windows — process groups are managed differently and
 * the pgrep/ps utilities are not available.
 */
export function killProcessTree(pid: number, signal: NodeJS.Signals = "SIGTERM"): void {
  if (process.platform === "win32") return;

  const descendants = getDescendants(pid);
  const allPids = [...descendants.reverse(), pid];

  for (const p of allPids) {
    try {
      process.kill(p, signal);
    } catch {
      // Already exited.
    }
  }

  // Escalate to SIGKILL after a short grace period for any survivors.
  if (signal !== "SIGKILL") {
    setTimeout(() => {
      for (const p of allPids) {
        try {
          process.kill(p, "SIGKILL");
        } catch {
          // Already exited.
        }
      }
    }, 500).unref();
  }
}

function getDescendants(pid: number): number[] {
  let children: number[];
  try {
    const raw = execSync(`pgrep -P ${pid}`, { encoding: "utf-8", timeout: 2000 }).trim();
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
