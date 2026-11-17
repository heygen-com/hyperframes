import { mkdirSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Where a local generator writes its file: inside a fresh folder that only this account can
// open (mkdtemp: an unguessable name, created exclusively, mode 0700). A guessable name in the
// shared temp folder, which is /tmp on Linux, could be created first by another account and
// then taken as the generated file.
export function privateOutputPath(provider, ext) {
  return join(mkdtempSync(join(tmpdir(), `media-use-${provider}-`)), `output${ext}`);
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
