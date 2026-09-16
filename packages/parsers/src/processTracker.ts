import { execFileSync, type ChildProcess } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  type Stats,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Shared child-process ownership for every package that shells out to
 * FFmpeg/FFprobe (engine, producer, cli, studio-server). Node-only: import via
 * the `@hyperframes/parsers/process-tracker` subpath, never from a browser
 * bundle. Lives here (next to `ff-binaries`) rather than in the engine because
 * studio-server cannot depend on the engine without closing a package cycle,
 * and the drain set below only works when every spawn site shares ONE module
 * instance.
 *
 * Two layers, both process-scoped:
 * - the in-memory drain set: `killTrackedProcesses` / `beginTrackedProcessDrain`
 *   terminate every tracked child from the owning process's own shutdown path.
 *   This is the layer that covers Ctrl+C on every platform, Windows included.
 * - the on-disk ownership registry (`kind: "ffmpeg"` only): a per-user
 *   directory of `<pid>.json` records carrying the child's birth identity, so
 *   a LATER CLI run can recover encoders that survived a crash of their
 *   parent. Recovery is inert on Windows: the registry is never written there
 *   and `findOwnedOrphanedFfmpegProcesses` returns `[]`, because orphan
 *   detection keys on the POSIX "reparented to PID 1" signal, which has no
 *   Windows equivalent — a child of a dead parent keeps its stale parent PID.
 */

const tracked = new Set<ChildProcess>();
let draining = false;

export interface TrackChildProcessOptions {
  /**
   * `"ffmpeg"` additionally records the child in the on-disk ownership
   * registry so a later run can recover it if this process crashes. Reserve it
   * for long-running encoders/transcodes/decodes — the ones worth recovering.
   * Leave probes (ffprobe, `ffmpeg -filters`) untagged: they are bounded by
   * their own deadlines, and registration resolves the child's identity
   * synchronously (a `ps` fork on macOS), which must stay off the per-file
   * probe fan-out path.
   */
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

/**
 * The registry lives at a predictable path under the shared OS temp dir, so
 * another local user can pre-create it. Records are only written to, and only
 * read from, a real directory (not a symlink) that this uid owns with no
 * group/other permission bits — anything else is treated as absent, which
 * fails closed on both sides: no record is written, and no record is trusted
 * as a kill authorization. The writer creates the directory 0o700 when
 * missing and then calls this, because a recursive `mkdirSync` silently
 * accepts an existing entry of any kind — the `lstatSync` below is what
 * rejects a pre-existing impostor.
 */
function isTrustedRegistryDir(registryDir: string): boolean {
  let stat: Stats;
  try {
    stat = lstatSync(registryDir);
  } catch {
    // Absent is the normal reader-side state (nothing was ever registered):
    // untrusted, but nothing to warn about.
    return false;
  }
  const rejection = registryDirTrustRejection(stat);
  if (rejection === null) return true;
  warnUntrustedRegistryDir(registryDir, rejection);
  return false;
}

/** The first failing trust property of an existing entry, or null when it is trusted. */
function registryDirTrustRejection(stat: Stats): string | null {
  if (!stat.isDirectory()) {
    return stat.isSymbolicLink() ? "path is a symlink" : "path is not a directory";
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    return `owned by uid ${stat.uid}, not ${process.getuid()}`;
  }
  if ((stat.mode & 0o077) !== 0) {
    return `mode ${(stat.mode & 0o777).toString(8)} grants group/other access (need 700)`;
  }
  return null;
}

const warnedUntrustedRegistryDirs = new Set<string>();

/**
 * Both halves fail closed on an untrusted directory, and a stale one under the
 * shared temp dir would otherwise disable crash recovery silently for good.
 * Warn once per path per process: the writer runs per encoder spawn.
 */
function warnUntrustedRegistryDir(registryDir: string, rejection: string): void {
  if (warnedUntrustedRegistryDirs.has(registryDir)) return;
  warnedUntrustedRegistryDirs.add(registryDir);
  console.warn(
    `[process-tracker] ignoring ffmpeg ownership registry ${registryDir}: ${rejection}; ` +
      "crash recovery is disabled until it is removed or fixed",
  );
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

/** Parse one registry record; null for anything that is not a well-formed v1 ffmpeg record. */
function readOwnedRecord(path: string): OwnedFfmpegProcess | null {
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
      typeof record.pid !== "number" ||
      !Number.isInteger(record.pid) ||
      record.pid <= 0 ||
      typeof record.identity !== "string"
    ) {
      return null;
    }
    return { pid: record.pid, identity: record.identity };
  } catch {
    return null;
  }
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
  if (!isTrustedRegistryDir(registryDir)) return [];
  let files: string[];
  try {
    files = readdirSync(registryDir).filter((file) => file.endsWith(".json"));
  } catch {
    return [];
  }

  const orphans: OwnedFfmpegProcess[] = [];
  for (const file of files) {
    const path = join(registryDir, file);
    const record = readOwnedRecord(path);
    // A malformed record, or one whose PID now belongs to a different process,
    // is stale: drop it so the next scan does not re-read it.
    if (record === null || identityForPid(record.pid) !== record.identity) {
      try {
        unlinkSync(path);
      } catch {
        // Stale record already removed.
      }
      continue;
    }
    if (parentPidForPid(record.pid) === 1) orphans.push(record);
  }
  return orphans.sort((a, b) => a.pid - b.pid);
}

function registerOwnedFfmpeg(
  proc: ChildProcess,
  registryDir = ownedProcessRegistryDir(),
): { path: string; identity: string } | null {
  if (!proc.pid || process.platform === "win32") return null;
  const identity = processIdentity(proc.pid);
  if (!identity) return null;
  try {
    mkdirSync(registryDir, { recursive: true, mode: 0o700 });
    if (!isTrustedRegistryDir(registryDir)) return null;
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
    return { path, identity };
  } catch {
    return null;
  }
}

export function trackChildProcess(
  proc: ChildProcess,
  options: TrackChildProcessOptions = {},
): void {
  let ownership = options.kind === "ffmpeg" ? registerOwnedFfmpeg(proc, options.registryDir) : null;
  const remove = () => {
    tracked.delete(proc);
    const owned = ownership;
    ownership = null;
    if (owned) {
      try {
        // The file is named by PID. Another HyperFrames process can have been
        // handed this PID and written its own record between the child's
        // reap and this listener running; only remove the record we wrote.
        // The read→unlink pair is not atomic, so a writer landing in between
        // still loses its record — that costs one missed recovery, never a
        // wrong kill, because the scan revalidates identity before acting.
        const record = JSON.parse(readFileSync(owned.path, "utf8")) as { identity?: unknown };
        if (record.identity === owned.identity) unlinkSync(owned.path);
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
