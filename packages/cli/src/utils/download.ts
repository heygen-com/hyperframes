import { createWriteStream, renameSync, unlinkSync } from "node:fs";
import { get as httpsGet } from "node:https";
import type { IncomingMessage } from "node:http";
import { pipeline } from "node:stream/promises";

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;

export interface DownloadOptions {
  /** Abort after this many milliseconds without network activity. */
  timeoutMs?: number;
}

/** Every redirect a host may reasonably answer with, not just the two we saw first. */
export const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

/**
 * Where a redirect actually points.
 *
 * Split out because this is the part that was wrong, and it is the part that
 * can be checked without a socket: hosts answer with relative locations
 * (`/api/resolve-cache/...`) far more often than the original code assumed, and
 * handing that string back as a request target fails.
 */
export function redirectTarget(location: string, from: string): string {
  return new URL(location, from).toString();
}

/** Enough hops for a CDN handoff, few enough that a redirect loop still ends. */
const MAX_REDIRECTS = 10;

function removePartialFile(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Missing/locked partial files are handled by the next atomic download.
  }
}

/**
 * Download a file from a URL, following redirects.
 * Uses atomic write (download to .tmp, rename on success) to prevent
 * corrupt partial files from persisting in the cache on interruption.
 *
 * Location headers are resolved against the URL that sent them, because they
 * are frequently relative: a host answering 307 with `/api/resolve-cache/...`
 * is normal, and passing that string back as a request target is not.
 *
 * The timeout is per request, so it re-arms on each hop of a redirect chain
 * rather than budgeting the whole chain. A stalled socket is what it exists to
 * catch, and without it the CLI waits forever.
 */
export function downloadFile(
  url: string,
  dest: string,
  options: DownloadOptions = {},
): Promise<void> {
  const tmp = `${dest}.tmp`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const follow = (u: string, hops = 0) => {
      let activeResponse: IncomingMessage | undefined;
      let responsePipelineStarted = false;
      let requestError: Error | undefined;
      const request = httpsGet(u, (res) => {
        activeResponse = res;
        if (res.statusCode && REDIRECT_CODES.has(res.statusCode)) {
          const location = res.headers.location;
          if (location) {
            if (hops >= MAX_REDIRECTS) {
              res.resume();
              removePartialFile(tmp);
              reject(
                new Error(`Download failed: more than ${MAX_REDIRECTS} redirects from ${url}`),
              );
              return;
            }
            res.resume();
            follow(redirectTarget(location, u), hops + 1);
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
        responsePipelineStarted = true;
        pipeline(res, file)
          .then(() => {
            renameSync(tmp, dest);
            resolve();
          })
          .catch((err) => {
            removePartialFile(tmp);
            reject(requestError ?? err);
          });
      });
      request.setTimeout(timeoutMs, () => {
        request.destroy(new Error(`Download timed out after ${timeoutMs}ms`));
      });
      request.on("error", (err) => {
        if (responsePipelineStarted) {
          requestError = err;
          activeResponse?.destroy(err);
          return;
        }
        removePartialFile(tmp);
        reject(err);
      });
    };
    follow(url);
  });
}
