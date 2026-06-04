import { createWriteStream, renameSync, unlinkSync, existsSync } from "node:fs";
import { get as httpsGet } from "node:https";
import { pipeline } from "node:stream/promises";

const SOCKET_TIMEOUT_MS = 30_000;
const RESPONSE_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1_000;
const MAX_REDIRECTS = 10;

function attempt(url: string, dest: string): Promise<void> {
  const tmp = `${dest}.tmp`;
  return new Promise((resolve, reject) => {
    let redirects = 0;

    const follow = (u: string) => {
      if (++redirects > MAX_REDIRECTS) {
        reject(new Error("Download failed: too many redirects"));
        return;
      }
      const req = httpsGet(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location;
          if (location) {
            res.resume();
            follow(location);
            return;
          }
        }
        if (res.statusCode === 403 || res.statusCode === 429) {
          res.resume();
          reject(
            new Error(
              `Download failed: HTTP ${res.statusCode} (rate limited). ` +
                `GitHub throttles unauthenticated release downloads. Retry in a moment.`,
            ),
          );
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }

        res.setTimeout(RESPONSE_TIMEOUT_MS, () => {
          res.destroy(new Error("Download stalled: response timeout"));
        });

        const file = createWriteStream(tmp);
        pipeline(res, file)
          .then(() => {
            renameSync(tmp, dest);
            resolve();
          })
          .catch((err) => {
            try {
              unlinkSync(tmp);
            } catch {
              // ignore cleanup failure
            }
            reject(err);
          });
      });
      req.setTimeout(SOCKET_TIMEOUT_MS, () => {
        req.destroy(new Error("Download failed: connection timeout"));
      });
      req.on("error", (err) => {
        try {
          if (existsSync(tmp)) unlinkSync(tmp);
        } catch {
          // ignore cleanup failure
        }
        reject(err);
      });
    };
    follow(url);
  });
}

/**
 * Download a file from a URL with retry, following redirects.
 * Uses atomic write (download to .tmp, rename on success) to prevent
 * corrupt partial files from persisting in the cache on interruption.
 */
export async function downloadFile(url: string, dest: string): Promise<void> {
  let lastErr: Error | undefined;
  for (let i = 0; i <= MAX_RETRIES; i++) {
    try {
      await attempt(url, dest);
      return;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (i < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * 2 ** i;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}
