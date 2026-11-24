import * as nodeFs from "node:fs";
import * as nodePath from "node:path";

// A leading slash or backslash (a root, a UNC share, a device path) or a drive letter.
const ROOTED = /^(?:[\\/]|[A-Za-z]:)/;

/**
 * The path a manifest record names, judged from its text alone: null when the text is rooted
 * (absolute, a UNC share, a device path, a drive) or climbs out of the project. The manifest is
 * written by whoever made the project, so a path it names outside the project is never looked at:
 * on Windows, merely asking whether `\\host\share\x` exists signs in to that host.
 */
export function recordPathInProject(projectDir, recordPath, path = nodePath) {
  if (typeof recordPath !== "string" || !recordPath || ROOTED.test(recordPath)) return null;
  const root = path.resolve(projectDir);
  const full = path.resolve(root, recordPath);
  const inside = path.relative(root, full);
  return inside &&
    inside !== ".." &&
    !inside.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(inside)
    ? full
    : null;
}

const MAX_LINKS = 40;

function relativeInside(root, full, pathApi) {
  const inside = pathApi.relative(root, full);
  return inside &&
    inside !== ".." &&
    !inside.startsWith(`..${pathApi.sep}`) &&
    !pathApi.isAbsolute(inside)
    ? inside
    : null;
}

/** What `rest` (relative to `root`) names once its first link is read; undefined when no part of it is a link. */
function afterFirstLink(root, rest, fs, pathApi) {
  const parts = rest.split(pathApi.sep);
  let at = root;
  for (const [index, part] of parts.entries()) {
    at = pathApi.join(at, part);
    let stat;
    try {
      stat = fs.lstatSync(at);
    } catch {
      return undefined;
    }
    if (stat.isSymbolicLink())
      return pathApi.resolve(pathApi.dirname(at), fs.readlinkSync(at), ...parts.slice(index + 1));
  }
  return undefined;
}

/**
 * The path of `path` inside the project once links are followed, or null when it is the project itself or leaves it.
 * Links are read, never followed, so nothing outside the project is touched (on Windows a link to a share signs in).
 */
export function insideProject(projectDir, path, { fs = nodeFs, pathApi = nodePath } = {}) {
  const root = fs.existsSync(projectDir)
    ? fs.realpathSync(projectDir)
    : pathApi.resolve(projectDir);
  const full = pathApi.resolve(path);
  let rest =
    relativeInside(pathApi.resolve(projectDir), full, pathApi) ??
    relativeInside(root, full, pathApi);
  for (let links = 0; rest !== null && links <= MAX_LINKS; links++) {
    const target = afterFirstLink(root, rest, fs, pathApi);
    if (target === undefined) return rest;
    rest = relativeInside(root, target, pathApi);
  }
  return null;
}

/** Whether a manifest record can be handed back as is: its file is in the project, or it is an inline grade. */
export function recordAvailable(projectDir, record, { fs = nodeFs, pathApi = nodePath } = {}) {
  if (!record) return false;
  if (record.path) {
    const path = recordPathInProject(projectDir, record.path, pathApi);
    return (
      path !== null &&
      insideProject(projectDir, path, { fs, pathApi }) !== null &&
      fs.existsSync(path)
    );
  }
  return record.type === "grade" && record.grading;
}
