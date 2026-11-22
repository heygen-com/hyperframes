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

/** The path of `path` inside the project once links are followed, or null when it is the project itself or leaves it. */
export function insideProject(projectDir, path, { fs = nodeFs, pathApi = nodePath } = {}) {
  const real = (at) => (fs.existsSync(at) ? fs.realpathSync(at) : at);
  const inside = pathApi.relative(real(projectDir), real(path));
  return inside &&
    inside !== ".." &&
    !inside.startsWith(`..${pathApi.sep}`) &&
    !pathApi.isAbsolute(inside)
    ? inside
    : null;
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
