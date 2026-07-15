// assets.mjs — stage frame-named capture assets into assets/.
// Shared by stage-assets.mjs (Step 4 close, BEFORE the frame workers run) and
// assemble-index.mjs (Step 5, idempotent backstop). Only assets a frame names
// in `asset_candidates` are staged; unnamed assets never reach the project.
// asset_candidates value form: "assets/<relative-path> — desc; assets/… — …".

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join, posix } from "node:path";

export function assetPathsFromCandidates(value) {
  if (typeof value !== "string") return [];
  return value
    .split(";")
    .map((seg) => seg.split(/\s+[—–-]\s+/)[0].trim()) // strip the " — description"
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/").replace(/^assets\//, ""))
    .map((path) => posix.normalize(path))
    .filter(
      (path) =>
        path !== "." &&
        !path.startsWith("../") &&
        !posix.isAbsolute(path) &&
        !/^[A-Za-z]:\//.test(path),
    );
}

export function basenamesFromCandidates(value) {
  return assetPathsFromCandidates(value).map((path) => basename(path));
}

// Copy each frame's asset_candidates from capture/{assets,assets/videos,
// screenshots} into assets/. Already-staged files are left as is (first-wins),
// so calling this twice is safe. Returns { staged, wanted, anomalies }.
export function stageAssets({ hyperframesDir, frames }) {
  const wanted = new Set();
  for (const f of frames) {
    for (const path of assetPathsFromCandidates(f.extra?.asset_candidates)) wanted.add(path);
  }
  const captureDirs = [
    join(hyperframesDir, "capture/assets"),
    join(hyperframesDir, "capture/assets/videos"), // videos download into a subdir
    join(hyperframesDir, "capture/screenshots"),
  ];
  const assetsDir = join(hyperframesDir, "assets");
  const anomalies = [];
  let staged = 0;
  if (wanted.size > 0) {
    mkdirSync(assetsDir, { recursive: true });
    for (const assetPath of wanted) {
      const dest = join(assetsDir, assetPath);
      if (existsSync(dest)) {
        staged++;
        continue;
      } // first-wins / already staged
      const src = captureDirs
        .flatMap((dir) => [join(dir, assetPath), join(dir, basename(assetPath))])
        .find((path) => existsSync(path));
      if (src) {
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(src, dest);
        staged++;
      } else {
        anomalies.push(
          `asset "${assetPath}" named by a frame but not found under capture/ — frame will 404 it`,
        );
      }
    }
  }
  return { staged, wanted, anomalies };
}
