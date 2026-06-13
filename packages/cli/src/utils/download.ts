import { createWriteStream, renameSync, unlinkSync } from "node:fs";
import { get as httpsGet } from "node:https";
import { pipeline } from "node:stream/promises";
import { URL } from "node:url";

/**
 * Download a file from a URL, following redirects.
 * Uses atomic write (download to .tmp, rename on success) to prevent
 * corrupt partial files from persisting in the cache on interruption.
 */
export function downloadFile(url: string, dest: string): Promise<void> {
  const tmp = `${dest}.tmp`;
  return new Promise((resolve, reject) => {
    const follow = (u: string, redirects = 0) => {
      httpsGet(u, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0)) {
          const location = res.headers.location;
          if (location) {
            if (redirects >= 10) {
              reject(new Error("Download failed: too many redirects"));
              return;
            }
            follow(new URL(location, u).toString(), redirects + 1);
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
