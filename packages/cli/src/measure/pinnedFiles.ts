// Files a measuring tool needs but the CLI does not ship: fetched on first use into a folder under the trusted cache
// root, each one checked against its pinned size and sha256 before it is used, and the folder sealed.
import { renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  assertPrivateCachePath,
  ensurePrivateCacheDir,
  foreignWritablePath,
  sealCacheInstall,
} from "@hyperframes/core/cache-dir";
import { downloadToFile } from "../cloud/download.js";
import { verifies, type ModelFile } from "../whisper/modelFile.js";
import { Fix } from "./media.js";

export interface PinnedFile extends ModelFile {
  url: string;
}

async function fetchPinned(dir: string, file: PinnedFile, signal?: AbortSignal): Promise<void> {
  const temp = join(dir, `${file.name}.part-${process.pid}`);
  try {
    await downloadToFile(file.url, temp, { signal }).catch((err: unknown) => {
      throw new Fix(
        `could not download ${file.name} (${err instanceof Error ? err.message : String(err)})`,
        "check the network and run the command again",
      );
    });
    if (!(await verifies(temp, file)))
      throw new Fix(
        `${file.name} did not match its pinned size and sha256`,
        "run the command again to retry the download",
      );
    renameSync(temp, join(dir, file.name));
  } finally {
    rmSync(temp, { force: true });
  }
}

/** Every file present in `dir` (under the cache `root`) and verified; the missing ones fetched. */
export async function ensurePinnedFiles(
  dir: string,
  root: string,
  files: readonly PinnedFile[],
  onStatus?: (message: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const wanted: PinnedFile[] = [];
  for (const file of files) {
    const path = join(dir, file.name);
    if (foreignWritablePath(path, root) || !(await verifies(path, file))) wanted.push(file);
  }
  if (!wanted.length) return;
  ensurePrivateCacheDir(dir, root);
  for (const file of wanted) {
    onStatus?.(`Downloading ${file.name} (${Math.round(file.bytes / 1e5) / 10} MB, once)...`);
    await fetchPinned(dir, file, signal);
  }
  sealCacheInstall(dir, root);
  for (const file of files) assertPrivateCachePath(join(dir, file.name), root);
}
