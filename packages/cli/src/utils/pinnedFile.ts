import { mkdirSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { verifies, type ModelFile } from "../whisper/modelFile.js";
import { downloadFile } from "./download.js";

/**
 * `dest` once it holds the pinned bytes: a cached copy that matches is used as it is, any other
 * copy is replaced by a fresh download, and a download that does not match is discarded.
 */
export async function ensurePinnedFile(
  url: string,
  dest: string,
  pin: ModelFile,
  progress: { downloading: string; onProgress?: (message: string) => void },
): Promise<string> {
  const cached = statSync(dest, { throwIfNoEntry: false }) !== undefined;
  if (cached && (await verifies(dest, pin))) return dest;

  mkdirSync(dirname(dest), { recursive: true });
  rmSync(dest, { force: true });
  progress.onProgress?.(
    cached
      ? `The cached ${pin.name} does not match its pinned sha256; downloading it again...`
      : progress.downloading,
  );
  await downloadFile(url, dest, {
    verify: async (path) => {
      if (!(await verifies(path, pin))) {
        throw new Error(
          `${pin.name} did not match its pinned size and sha256, so it was discarded. Re-run to retry.`,
        );
      }
    },
  });
  return dest;
}
