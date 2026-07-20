import { randomUUID } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { get as httpsGet } from "node:https";
import { pipeline } from "node:stream/promises";

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;
const LOCK_STALE_MS = 120_000;
const LOCK_POLL_MS = 200;
const LOCK_HEARTBEAT_MS = 15_000;

export interface DownloadOptions {
  /** Abort after this many milliseconds without network activity. */
  timeoutMs?: number;
}

function isErrno(err: unknown, code: string): boolean {
  return (err as NodeJS.ErrnoException).code === code;
}

function removePartialFile(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Missing/locked partial files are handled by the next atomic download.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readLockOwner(lockDir: string): string | null {
  try {
    return readFileSync(`${lockDir}/owner`, "utf8");
  } catch (err) {
    if (!isErrno(err, "ENOENT")) throw err;
    return null;
  }
}

function tryAcquireLock(lockDir: string, owner: string): boolean {
  try {
    mkdirSync(lockDir, { recursive: false });
  } catch (err) {
    if (!isErrno(err, "EEXIST")) throw err;
    return false;
  }

  try {
    writeFileSync(`${lockDir}/owner`, owner);
    return true;
  } catch (err) {
    rmSync(lockDir, { recursive: true, force: true });
    throw err;
  }
}

function reclaimStaleLock(lockDir: string): void {
  const staleDir = `${lockDir}.stale.${randomUUID()}`;
  try {
    if (Date.now() - statSync(lockDir).mtimeMs > LOCK_STALE_MS) {
      renameSync(lockDir, staleDir);
      rmSync(staleDir, { recursive: true, force: true });
    }
  } catch (err) {
    if (!isErrno(err, "ENOENT")) throw err;
  }
}

async function withDownloadLock<T>(dest: string, fn: (waited: boolean) => Promise<T>): Promise<T> {
  const lockDir = `${dest}.download.lock`;
  const owner = `${process.pid}:${randomUUID()}`;
  let waited = false;

  for (;;) {
    if (tryAcquireLock(lockDir, owner)) break;
    waited = true;
    try {
      if (Date.now() - statSync(lockDir).mtimeMs > LOCK_STALE_MS) {
        reclaimStaleLock(lockDir);
        continue;
      }
    } catch (err) {
      if (!isErrno(err, "ENOENT")) throw err;
    }
    await sleep(LOCK_POLL_MS);
  }

  const heartbeat = setInterval(() => {
    try {
      if (readLockOwner(lockDir) !== owner) return;
      const now = new Date();
      utimesSync(lockDir, now, now);
    } catch {
      // Best effort. A stale lock is still recoverable if this process dies.
    }
  }, LOCK_HEARTBEAT_MS);
  heartbeat.unref();

  try {
    return await fn(waited);
  } finally {
    clearInterval(heartbeat);
    // A stale owner can resume after its directory was reclaimed. Only the
    // current owner may release this path, otherwise it could delete the
    // successor's live lock and reintroduce concurrent writes.
    if (readLockOwner(lockDir) === owner) {
      rmSync(lockDir, { recursive: true, force: true });
    }
  }
}

/**
 * Download a file from a URL, following redirects.
 * Uses an owned cross-process lock plus atomic temp-file rename so concurrent
 * model warmups cannot corrupt a shared cache entry.
 */
export function downloadFile(
  url: string,
  dest: string,
  options: DownloadOptions = {},
): Promise<void> {
  return withDownloadLock(dest, async (waited) => {
    // Another process may have completed the same cache download while this
    // caller waited for the lock.
    if (waited && existsSync(dest)) return;

    const tmp = `${dest}.${process.pid}.${randomUUID()}.tmp`;
    const timeoutMs = options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
    await new Promise<void>((resolve, reject) => {
      const follow = (currentUrl: string) => {
        const request = httpsGet(currentUrl, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            const location = res.headers.location;
            if (location) {
              res.resume();
              follow(location);
              return;
            }
          }
          if (res.statusCode !== 200) {
            res.resume();
            removePartialFile(tmp);
            reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            return;
          }
          const file = createWriteStream(tmp);
          pipeline(res, file)
            .then(() => {
              renameSync(tmp, dest);
              resolve();
            })
            .catch((err) => {
              removePartialFile(tmp);
              reject(err);
            });
        });
        request.setTimeout(timeoutMs, () => {
          request.destroy(new Error(`Download timed out after ${timeoutMs}ms`));
        });
        request.on("error", (err) => {
          removePartialFile(tmp);
          reject(err);
        });
      };
      follow(url);
    });
  });
}
