import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { hostname, uptime } from "node:os";
import { basename, dirname, join, win32 } from "node:path";
import { RENDER_TEMP_DIR } from "@hyperframes/core/project-folders";
import { createStagingDir, toWin32LongPath } from "@hyperframes/core/atomic-file";

const OWNER_FILE = "owner.json";
/** Where a staging dir parks the previous output while swapping in the new one. */
export const TRANSACTION_BACKUP = "backup";
/** A `--debug` render's work dir, named by its job id. */
export const RENDER_JOB_DIR = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

let machineIdRead: { platform: string; id: string | undefined } | undefined;

/** This machine's own id where there is no /proc boot id, from the system's own tool at its fixed path. */
function machineId(): string | undefined {
  const read = (file: string, args: string[], pattern: RegExp) => {
    try {
      const out = execFileSync(file, args, {
        encoding: "utf-8",
        timeout: 2_000,
        windowsHide: true,
      });
      return pattern.exec(out)?.[1];
    } catch {
      return undefined;
    }
  };
  if (machineIdRead?.platform === process.platform) return machineIdRead.id;
  const systemRoot = process.env.SystemRoot;
  machineIdRead = {
    platform: process.platform,
    id:
      process.platform === "darwin"
        ? read(
            "/usr/sbin/ioreg",
            ["-rd1", "-c", "IOPlatformExpertDevice"],
            /"IOPlatformUUID" = "([^"]+)"/,
          )
        : process.platform === "win32" && systemRoot && /^[A-Za-z]:\\/.test(systemRoot)
          ? read(
              win32.join(systemRoot, "System32", "reg.exe"),
              ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
              /MachineGuid\s+REG_SZ\s+(\S+)/,
            )
          : undefined,
  };
  return machineIdRead.id;
}

/**
 * Where a pid means this process: host and boot, plus the Linux pid namespace. Containers and machines on a shared
 * folder can share a hostname, and every normal Linux host has the same root pid namespace id.
 */
function pidScope(): { host: string; boot?: string; pidns?: string; machine?: string } {
  const attempt = (read: () => string) => {
    try {
      return read();
    } catch {
      return undefined;
    }
  };
  const bootId = attempt(() => readFileSync("/proc/sys/kernel/random/boot_id", "utf-8").trim());
  return {
    host: hostname(),
    // Without /proc (macOS, Windows) the boot time in seconds stands in for the boot id, on this machine's own id.
    boot: bootId ?? attempt(() => `s:${Math.round(Date.now() / 1000 - uptime())}`),
    pidns: attempt(() => readlinkSync("/proc/self/ns/pid")),
    machine: bootId === undefined ? machineId() : undefined,
  };
}

/** A render's private temp dir, stamped with the process that owns it so a later sweep can tell it was abandoned. */
export function createOwnedRenderDir(prefix: string): string {
  const dir = createStagingDir(dirname(prefix), basename(prefix));
  const owner = { pid: process.pid, ...pidScope() };
  writeFileSync(toWin32LongPath(join(dir, OWNER_FILE)), JSON.stringify(owner));
  return dir;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

type OwnerRecord = {
  pid?: unknown;
  host?: unknown;
  boot?: unknown;
  pidns?: unknown;
  machine?: unknown;
};

function knownPidScope(): ReturnType<typeof pidScope> | undefined {
  const scope = pidScope();
  const unknown =
    scope.boot === undefined ||
    (process.platform === "linux" && scope.pidns === undefined) ||
    (scope.boot.startsWith("s:") && scope.machine === undefined);
  return unknown ? undefined : scope;
}

/** A boot id matches exactly; a boot estimate in seconds moves with uptime's whole-second tick, so within 2 s. */
function sameBoot(stamped: unknown, current: string | undefined): boolean {
  if (stamped === current) return true;
  const seconds = (boot: unknown) =>
    typeof boot === "string" ? /^s:(\d+)$/.exec(boot)?.[1] : undefined;
  const [a, b] = [seconds(stamped), seconds(current)];
  return a !== undefined && b !== undefined && Math.abs(Number(a) - Number(b)) <= 2;
}

function inThisPidScope(owner: OwnerRecord): boolean {
  const scope = knownPidScope();
  return (
    scope !== undefined &&
    owner.host === scope.host &&
    sameBoot(owner.boot, scope.boot) &&
    owner.pidns === scope.pidns &&
    owner.machine === scope.machine
  );
}

/** "gone" only for an owner in this pid scope that has exited; "none" when there is no owner file, else "unknown". */
function ownerState(dir: string): "gone" | "live" | "unknown" | "none" {
  let owner: OwnerRecord;
  try {
    owner = JSON.parse(readFileSync(join(dir, OWNER_FILE), "utf-8"));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "none" : "unknown";
  }
  const { pid } = owner;
  if (!inThisPidScope(owner) || typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    return "unknown";
  }
  return alive(pid) ? "live" : "gone";
}

function newestWriteMs(path: string): number {
  const stat = lstatSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return readdirSync(path).reduce(
    (newest, name) => Math.max(newest, newestWriteMs(join(path, name))),
    stat.mtimeMs,
  );
}

function isAbandoned(dir: string, ownerlessIdleMs: number | undefined, now: number): boolean {
  try {
    if (!lstatSync(dir).isDirectory() || existsSync(join(dir, TRANSACTION_BACKUP))) return false;
    const owner = ownerState(dir);
    if (owner === "gone") return true;
    return (
      owner === "none" &&
      ownerlessIdleMs !== undefined &&
      now - newestWriteMs(dir) >= ownerlessIdleMs
    );
  } catch {
    // Vanished or unreadable mid-scan: not provably abandoned.
    return false;
  }
}

export interface AbandonedRenderDirOptions {
  /** Also count dirs with no owner record once nothing in them has been written for this long. */
  ownerlessIdleMs?: number;
  /** Names to consider instead of render temp dir names. */
  names?: RegExp;
}

/** Render temp dirs under `parent` no running render owns; never a staging dir holding {@link TRANSACTION_BACKUP}. */
export function listAbandonedRenderDirs(
  parent: string,
  options: AbandonedRenderDirOptions = {},
): string[] {
  let names: string[];
  try {
    names = readdirSync(parent);
  } catch {
    return [];
  }
  const now = Date.now();
  return names
    .filter((name) => (options.names ?? RENDER_TEMP_DIR).test(name))
    .map((name) => join(parent, name))
    .filter((dir) => isAbandoned(dir, options.ownerlessIdleMs, now));
}

/** Creates a render's work dir after reclaiming dirs of renders that were killed outright (no cleanup ran). */
export function createRenderWorkDir(prefix: string, outputDir: string): string {
  const workParent = dirname(prefix);
  mkdirSync(toWin32LongPath(workParent), { recursive: true });
  for (const parent of new Set([outputDir, workParent])) {
    for (const dir of listAbandonedRenderDirs(parent)) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch {
        // Reclaiming a dead render's dir is best-effort; it must never fail the render that found it.
      }
    }
  }
  return createOwnedRenderDir(prefix);
}
