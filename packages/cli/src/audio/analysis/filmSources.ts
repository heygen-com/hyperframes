import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { isPrivateFileUnder, isStudioPrivatePath } from "@hyperframes/core/safe-path";
import { isPrivateOutsideFile } from "@hyperframes/studio-server/outside-file";
import type { AudioTarget } from "./targets.js";

const REMOTE = /^[a-z][a-z\d+.-]*:\/\//i;

/**
 * Whether a film clip's file may be read: a regular, non-private file inside the project, or one outside it that the
 * received-project rule for local renders admits. A missing file passes here and is reported as missing.
 */
export function admitsFilmSource(
  projectDir: string,
  path: string,
  outsideAllowed: () => boolean,
): boolean {
  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    return true;
  }
  if (!statSync(real).isFile()) return false;
  const rel = relative(realpathSync(projectDir), real);
  const inside = rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  if (inside) return !isPrivateFileUnder(projectDir, path, isStudioPrivatePath);
  return outsideAllowed() && !isPrivateOutsideFile(projectDir, real);
}

/** The targets, each source the project may not name marked `refused`; the render rule is asked at most once. */
export function refuseUnadmittedFilmSources(
  projectDir: string,
  targets: AudioTarget[],
  outsideAllowed: () => boolean,
): AudioTarget[] {
  let allowed: boolean | undefined;
  const outside = () => (allowed ??= outsideAllowed());
  return targets.map((target) =>
    target.onAnotherNetworkRoot ||
    REMOTE.test(target.file) ||
    admitsFilmSource(projectDir, target.path, outside)
      ? target
      : { ...target, refused: true },
  );
}
