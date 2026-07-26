import { createWriteStream, renameSync, unlinkSync } from "node:fs";
import { get as httpsGet } from "node:https";
import { pipeline } from "node:stream/promises";

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;

export interface DownloadOptions {
  /** Abort after this many milliseconds without network activity. */
  timeoutMs?: number;
}

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
 */
export function downloadFile(
  url: string,
  dest: string,
  options: DownloadOptions = {},
): Promise<void> {
  const tmp = `${dest}.tmp`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const follow = (u: string) => {
      // Set once the 200 branch hands the response to pipeline(). From that
      // point the pipeline's catch owns BOTH cleanup and rejection: it settles
      // only after the write stream has closed, so the `.tmp` file provably
      // exists (or never will) when it unlinks. The request "error" handler
      // must NOT clean up or reject in that window — createWriteStream opens
      // asynchronously, so an early unlink+reject races the open and can leave
      // a stray `.tmp` created AFTER cleanup ran (flaked in CI as
      // download.test.ts "removes the partial file"; in the wild it strands
      // partials in the cache dir).
      let pipelineOwnsCleanup = false;
      // The request's error (e.g. the timeout message) is more precise than
      // what the pipeline surfaces for the same failure (destroying the
      // request can reject the pipeline with a generic premature-close).
      let requestError: Error | undefined;
      const request = httpsGet(u, (res) => {
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
        pipelineOwnsCleanup = true;
        const file = createWriteStream(tmp);
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
        if (pipelineOwnsCleanup) {
          requestError = err;
          return;
        }
        removePartialFile(tmp);
        reject(err);
      });
    };
    follow(url);
  });
}
