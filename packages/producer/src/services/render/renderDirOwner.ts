import {
  existsSync,
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

/**
 * True only for an owner in this process's pid scope that has exited; no owner file, another scope or an unreadable
 * owner all mean "not provably abandoned".
 */
function ownerIsGone(dir: string): boolean {
  let owner: { pid?: unknown; host?: unknown; boot?: unknown; pidns?: unknown };
  try {
    owner = JSON.parse(readFileSync(join(dir, OWNER_FILE), "utf-8"));
  } catch {
    return false;
  }
  const scope = pidScope();
  const { pid } = owner;
  return (
    owner.host === scope.host &&
    owner.boot === scope.boot &&
    owner.pidns === scope.pidns &&
    typeof pid === "number" &&
    Number.isInteger(pid) &&
    pid > 0 &&
    !alive(pid)
  );
}

/** A staging dir that still holds {@link TRANSACTION_BACKUP} (its render died mid-swap) is left alone. */
function removeAbandonedRenderDirs(parent: string): void {
  let names: string[];
  try {
    names = readdirSync(parent);
  } catch {
    return;
  }
  for (const name of names) {
    const dir = join(parent, name);
    if (
      !RENDER_TEMP_DIR.test(name) ||
      !ownerIsGone(dir) ||
      existsSync(join(dir, TRANSACTION_BACKUP))
    )
      continue;
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // Reclaiming a dead render's dir is best-effort; it must never fail the render that found it.
    }
  }
}

/** Creates a render's work dir after reclaiming dirs of renders that were killed outright (no cleanup ran). */
export function createRenderWorkDir(prefix: string, outputDir: string): string {
  for (const dir of new Set([outputDir, dirname(prefix)])) removeAbandonedRenderDirs(dir);
  return createOwnedRenderDir(prefix);
}
