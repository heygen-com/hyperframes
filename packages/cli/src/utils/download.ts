import { createWriteStream, renameSync, unlinkSync } from "node:fs";
import { get as httpsGet } from "node:https";
import { pipeline } from "node:stream/promises";

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

/**
 * Download a file from a URL, following redirects.
 * Uses atomic write (download to .tmp, rename on success) to prevent
 * corrupt partial files from persisting in the cache on interruption.
 *
 * Location headers are resolved against the URL that sent them, because they
 * are frequently relative: a host answering 307 with `/api/resolve-cache/...`
 * is normal, and passing that string back as a request target is not.
 */
export function downloadFile(url: string, dest: string): Promise<void> {
  const tmp = `${dest}.tmp`;
  return new Promise((resolve, reject) => {
    const follow = (u: string, hops = 0) => {
      httpsGet(u, (res) => {
        if (res.statusCode && REDIRECT_CODES.has(res.statusCode)) {
          const location = res.headers.location;
          if (location) {
            if (hops >= MAX_REDIRECTS) {
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
            try {
              unlinkSync(tmp);
            } catch {
              // ignore cleanup failure
            }
            reject(err);
          });
      }).on("error", (err) => {
        try {
          unlinkSync(tmp);
        } catch {
          // ignore cleanup failure
        }
        reject(err);
      });
    };
    follow(url);
  });
}
