import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Where a local generator writes its file: inside a fresh folder that only this account can
// open (mkdtemp: an unguessable name, created exclusively, mode 0700). A guessable name in the
// shared temp folder, which is /tmp on Linux, could be created first by another account and
// then taken as the generated file. `made` holds the folders this run created.
const made = new Set();
export function privateOutputPath(provider, ext) {
  const dir = mkdtempSync(join(tmpdir(), `media-use-${provider}-`));
  made.add(dir);
  return join(dir, `output${ext}`);
}

// Remove the folder privateOutputPath made for `path`, once its file is copied into the project.
// Any other path is left alone, and a folder that will not go stays behind, still owner-only.
export function discardPrivateOutput(path) {
  const dir = dirname(path);
  if (!made.delete(dir)) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // never turn a finished or failed generation into a cleanup error
  }
}
