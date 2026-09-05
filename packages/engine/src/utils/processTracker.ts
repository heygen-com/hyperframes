import { execFileSync, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tracked = new Set<ChildProcess>();
let draining = false;

export interface TrackChildProcessOptions {
  kind?: "ffmpeg";
  registryDir?: string;
}

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
      const startTicks = fields[19];
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

export function ownedProcessRegistryDir(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  return join(tmpdir(), `hyperframes-owned-processes-${uid}`);
}

export function processParentPid(pid: number): number | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
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
    const parent = Number(output.trim());
    return Number.isInteger(parent) && parent > 0 ? parent : null;
  } catch {
    return null;
  }
}

export interface OwnedFfmpegProcess {
  pid: number;
  identity: string;
}

export function findOwnedOrphanedFfmpegProcesses(
  options: {
    registryDir?: string;
    identityForPid?: (pid: number) => string | null;
    parentPidForPid?: (pid: number) => number | null;
  } = {},
): OwnedFfmpegProcess[] {
  if (process.platform === "win32") return [];
  const registryDir = options.registryDir ?? ownedProcessRegistryDir();
  const identityForPid = options.identityForPid ?? processIdentity;
  const parentPidForPid = options.parentPidForPid ?? processParentPid;
  let files: string[];
  try {
    files = readdirSync(registryDir).filter((file) => file.endsWith(".json"));
  } catch {
    return [];
  }

  const orphans: OwnedFfmpegProcess[] = [];
  for (const file of files) {
    const path = join(registryDir, file);
    try {
      const record = JSON.parse(readFileSync(path, "utf8")) as {
        version?: unknown;
        kind?: unknown;
        pid?: unknown;
        identity?: unknown;
      };
      if (
        record.version !== 1 ||
        record.kind !== "ffmpeg" ||
        !Number.isInteger(record.pid) ||
        (record.pid as number) <= 0 ||
        typeof record.identity !== "string"
      ) {
        unlinkSync(path);
        continue;
      }
      const pid = record.pid as number;
      if (identityForPid(pid) !== record.identity) {
        unlinkSync(path);
        continue;
      }
      if (parentPidForPid(pid) === 1) orphans.push({ pid, identity: record.identity });
    } catch {
      try {
        unlinkSync(path);
      } catch {
        // Stale record already removed.
      }
    }
  }
  return orphans.sort((a, b) => a.pid - b.pid);
}

function registerOwnedFfmpeg(
  proc: ChildProcess,
  registryDir = ownedProcessRegistryDir(),
): string | null {
  if (!proc.pid || process.platform === "win32") return null;
  const identity = processIdentity(proc.pid);
  if (!identity) return null;
  try {
    mkdirSync(registryDir, { recursive: true, mode: 0o700 });
    const path = join(registryDir, `${proc.pid}.json`);
    try {
      unlinkSync(path);
    } catch {
      // No stale record for this reused PID.
    }
    writeFileSync(path, JSON.stringify({ version: 1, kind: "ffmpeg", pid: proc.pid, identity }), {
      flag: "wx",
      mode: 0o600,
    });
    return path;
  } catch {
    return null;
  }
}

export function trackChildProcess(
  proc: ChildProcess,
  options: TrackChildProcessOptions = {},
): void {
  let ownershipPath =
    options.kind === "ffmpeg" ? registerOwnedFfmpeg(proc, options.registryDir) : null;
  const remove = () => {
    tracked.delete(proc);
    const path = ownershipPath;
    ownershipPath = null;
    if (path) {
      try {
        unlinkSync(path);
      } catch {
        // Already removed or unavailable.
      }
    }
  };
  proc.once("exit", remove);
  proc.once("close", remove);
  if (draining) {
    terminateProcesses([proc]);
    return;
  }
  tracked.add(proc);
}

/**
 * SIGTERM all tracked child processes, then SIGKILL any that survive
 * after a short grace period.
 */
export function killTrackedProcesses(): void {
  const processes = [...tracked];
  tracked.clear();
  terminateProcesses(processes);
}

/** Permanently close this process's child-registration boundary during shutdown. */
export function beginTrackedProcessDrain(): void {
  draining = true;
  killTrackedProcesses();
}

function terminateProcesses(processes: ChildProcess[]): void {
  const alive: ChildProcess[] = [];
  for (const proc of processes) {
    if (!proc.killed) {
      try {
        proc.kill("SIGTERM");
        alive.push(proc);
      } catch {
        // Already exited between the check and the kill.
      }
    }
  }
  if (alive.length === 0) return;

  setTimeout(() => {
    for (const proc of alive) {
      try {
        proc.kill("SIGKILL");
      } catch {
        // Already exited.
      }
    }
  }, 500).unref();
}
