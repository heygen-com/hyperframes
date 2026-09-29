import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname, uptime } from "node:os";
import { dirname, join } from "node:path";

const OWNER_FILE = "owner.json";
/** Where a staging dir parks the previous output while swapping in the new one. */
export const TRANSACTION_BACKUP = "backup";
// The names mkdtemp gives a render's temp dirs: work-<job uuid>-, hf-render- (Windows) and .<output>.hf-transaction-.
const RENDER_TEMP_DIR =
  /^(work-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}|hf-render|\..+\.hf-transaction)-[A-Za-z0-9]{6}$/;
/** A `--debug` render's work dir, named by its job id. */
export const RENDER_JOB_DIR = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

/**
 * Where a pid means this process: host and boot, plus the Linux pid namespace. Containers and machines on a shared
 * folder can share a hostname, and every normal Linux host has the same root pid namespace id.
 */
function pidScope(): { host: string; boot?: string; pidns?: string } {
  const attempt = (read: () => string) => {
    try {
      return read();
    } catch {
      return undefined;
    }
  };
  return {
    host: hostname(),
    // Without /proc (macOS, Windows) the boot time, to the minute, stands in for the boot id.
    boot:
      attempt(() => readFileSync("/proc/sys/kernel/random/boot_id", "utf-8").trim()) ??
      String(Math.round(Date.now() / 60_000 - uptime() / 60)),
    pidns: attempt(() => readlinkSync("/proc/self/ns/pid")),
  };
}

/** A render's private temp dir, stamped with the process that owns it so a later sweep can tell it was abandoned. */
export function createOwnedRenderDir(prefix: string): string {
  const dir = mkdtempSync(prefix);
  const owner = { pid: process.pid, ...pidScope() };
  writeFileSync(join(dir, OWNER_FILE), JSON.stringify(owner));
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

type OwnerRecord = { pid?: unknown; host?: unknown; boot?: unknown; pidns?: unknown };

function inThisPidScope(owner: OwnerRecord): boolean {
  const scope = pidScope();
  return owner.host === scope.host && owner.boot === scope.boot && owner.pidns === scope.pidns;
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
  for (const parent of new Set([outputDir, dirname(prefix)])) {
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
