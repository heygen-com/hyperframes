import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

// Where a local generator writes its file: inside a fresh folder that only this account can
// open (mkdtemp: an unguessable name, created exclusively, mode 0700). A guessable name in the
// shared temp folder, which is /tmp on Linux, could be created first by another account and
// then taken as the generated file.
export function privateOutputPath(provider, ext) {
  return join(mkdtempSync(join(tmpdir(), `media-use-${provider}-`)), `output${ext}`);
}

// Remove the folder privateOutputPath made for `path`, once its file is copied into the project.
// Any other path is left alone: providers also return files they do not own, such as a sound in
// the bundled SFX library.
export function discardPrivateOutput(path) {
  const dir = dirname(path);
  if (dirname(dir) !== tmpdir() || !/^media-use-[a-z]+-[A-Za-z0-9]{6}$/.test(basename(dir))) return;
  if (!/^output\.[a-z0-9]+$/.test(basename(path))) return;
  rmSync(dir, { recursive: true, force: true });
}
