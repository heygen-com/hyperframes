import { createWriteStream, renameSync, unlinkSync } from "node:fs";
import { get as httpsGet } from "node:https";
import { pipeline } from "node:stream/promises";

/**
 * Download a file from a URL, following redirects.
 * Uses atomic write (download to .tmp, rename on success) to prevent
 * corrupt partial files from persisting in the cache on interruption.
 */
export function downloadFile(url: string, dest: string): Promise<void> {
  const tmp = `${dest}.tmp`;
  return new Promise((resolve, reject) => {
    const follow = (u: string) => {
      httpsGet(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location;
          if (location) {
            follow(location);
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
