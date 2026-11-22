import { statSync } from "node:fs";
import { dirname } from "node:path";
import { ensurePrivateCacheDir } from "@hyperframes/core/cache-dir";
import { verifies, type ModelFile } from "../whisper/modelFile.js";
import { downloadFile } from "./download.js";

/**
 * `dest` once it holds the pinned bytes: a cached copy that matches is used as it is, any other
 * copy is replaced by a fresh download, and a download that does not match is discarded.
 *
 * `dest`'s folder, under the cache `root`, is made private first (0700 when new) and refused when
 * another account can change it or a link redirects it, so no partial or final file is written
 * there, and no cached copy is trusted from there, until it is the person's own.
 */
export async function ensurePinnedFile(
  url: string,
  dest: string,
  root: string,
  pin: ModelFile,
  progress: { downloading: string; onProgress?: (message: string) => void },
): Promise<string> {
  ensurePrivateCacheDir(dirname(dest), root);
  const cached = statSync(dest, { throwIfNoEntry: false }) !== undefined;
  if (cached && (await verifies(dest, pin))) return dest;

  progress.onProgress?.(
    cached
      ? `The cached ${pin.name} does not match its pinned sha256; downloading it again...`
      : progress.downloading,
  );
  await downloadFile(url, dest, {
    keepExisting: (path) => verifies(path, pin),
    verify: async (path) => {
      if (!(await verifies(path, pin))) {
        throw new Error(
          `${pin.name} was discarded because it does not match its expected size and sha256. ` +
            "Retrying helps only if the download was interrupted or corrupted.",
        );
      }
    },
  });
  return dest;
}
