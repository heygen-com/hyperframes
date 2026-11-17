import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

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

// A fresh private folder for an agent CLI to work in, under HyperFrames' per-user cache folder
// (resolved as hyperframesCacheDir in @hyperframes/core does; this tree runs unbundled and cannot
// import it). Not under the shared temp folder: an agent that looks for project instructions in
// the folders above its working folder would find files another account put there.
export function privateWorkDir(provider) {
  const named = process.env.HYPERFRAMES_CACHE_DIR;
  const root = join(named ? resolve(named) : join(homedir(), ".cache", "hyperframes"), "media-use");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return mkdtempSync(join(root, `${provider}-`));
}
