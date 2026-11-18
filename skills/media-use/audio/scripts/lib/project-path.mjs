// Paths taken from project files (audio_request.json, audio_meta.json), resolved the way the
// filesystem will: through every link, so a name inside the project cannot lead outside it.
import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep, win32 } from "node:path";

// Where `abs` lands: its nearest existing part resolved through links, plus the parts not made
// yet. Null when a link on the way leads nowhere.
function realLocation(abs) {
  const missing = [];
  let at = abs;
  while (!lstatSync(at, { throwIfNoEntry: false })) {
    missing.unshift(basename(at));
    at = dirname(at);
  }
  try {
    return join(realpathSync(at), ...missing);
  } catch {
    return null;
  }
}

const within = (dir, path) => path === dir || path.startsWith(dir + sep);

/** `rel` (relative to the project) where it really lands, or null when it is absolute or lands outside the project. */
export function projectPath(hyperframesDir, rel) {
  if (typeof rel !== "string" || isAbsolute(rel) || win32.isAbsolute(rel)) return null;
  const root = realpathSync(hyperframesDir);
  const real = realLocation(resolve(root, rel));
  return real && within(root, real) ? real : null;
}

/** True when `rel` reaches its own place in the project with no link on the way. */
export function isPlainProjectPath(hyperframesDir, rel) {
  return projectPath(hyperframesDir, rel) === join(realpathSync(hyperframesDir), rel);
}

const BGM_LOG_NAME = /^bgm-\d+\.log$/;

/**
 * The detached BGM renderer's log named by `value` (audio_meta.json `bgm_log`), or null. Only a
 * regular file directly in <project>/assets/bgm named bgm-<digits>.log counts: the engine writes
 * its logs there and nowhere else.
 */
export function engineBgmLog(hyperframesDir, value) {
  if (typeof value !== "string" || !BGM_LOG_NAME.test(basename(value))) return null;
  const bgmDir = join("assets", "bgm");
  if (!isPlainProjectPath(hyperframesDir, bgmDir)) return null;
  const abs = resolve(hyperframesDir, value);
  if (!lstatSync(abs, { throwIfNoEntry: false })?.isFile()) return null;
  const expected = join(realpathSync(hyperframesDir), bgmDir, basename(value));
  try {
    return realpathSync(abs) === expected ? expected : null;
  } catch {
    return null;
  }
}
