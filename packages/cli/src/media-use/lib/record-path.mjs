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

function rawSegments(raw, isWin32) {
  const sepRe = isWin32 ? /[\\/]+/ : /\/+/;
  const trailing = isWin32 ? /[\\/]$/.test(raw) : raw.endsWith("/");
  const parts = raw.split(sepRe).filter(Boolean);
  if (trailing) parts.push(".");
  return parts;
}

/**
 * Split a path or link target into raw segments without collapsing `..`.
 * Rooted targets must stay under `roots`; anything outside (including UNC and device paths) returns null.
 */
function parseTarget(target, roots, isWin32) {
  if (!isWin32) {
    if (!target.startsWith("/")) return { rooted: false, parts: rawSegments(target, false) };
    for (const base of roots) {
      const clean = base.length > 1 ? base.replace(/\/+$/, "") : base;
      const prefix = clean.endsWith("/") ? clean : `${clean}/`;
      if (target === clean) return { rooted: true, parts: [] };
      if (target.startsWith(prefix)) {
        return { rooted: true, parts: rawSegments(target.slice(prefix.length), false) };
      }
    }
    return null;
  }
  if (!ROOTED.test(target)) return { rooted: false, parts: rawSegments(target, true) };
  // Allow only Windows' extended drive prefix (`\\?\C:\...`); refuse UNC shares and device paths.
  const text = /^\\\\\?\\[A-Za-z]:\\/.test(target) ? target.slice(4) : target;
  if (/^(?:\\\\|\/\/)/.test(text)) return null;
  const norm = text.replace(/\//g, "\\");
  const normLower = norm.toLowerCase();
  for (const base of roots) {
    const clean = base.replace(/\//g, "\\").replace(/\\+$/, "");
    const cleanLower = clean.toLowerCase();
    if (normLower === cleanLower) return { rooted: true, parts: [] };
    if (normLower.startsWith(`${cleanLower}\\`)) {
      return { rooted: true, parts: rawSegments(norm.slice(clean.length + 1), true) };
    }
  }
  return null;
}

function initialQueue(candidate, root, resolvedProject, roots, pathApi, isWin32) {
  const isRooted = isWin32 ? ROOTED.test(candidate) : candidate.startsWith("/");
  if (isRooted) {
    const parsed = parseTarget(candidate, roots, isWin32);
    return parsed === null ? null : parsed.parts;
  }
  const full = pathApi.resolve(candidate);
  const initial =
    relativeInside(root, full, pathApi) ?? relativeInside(resolvedProject, full, pathApi);
  return initial === null ? null : rawSegments(initial, isWin32);
}

/**
 * Walk `candidate` component by component from `realpathSync(projectDir)` using `lstat` and `readlink`,
 * failing closed on any unresolved component, link target outside the project, or link loop.
 */
function walkInsideProject(projectDir, candidate, { fs = nodeFs, pathApi = nodePath } = {}) {
  if (typeof candidate !== "string" || !candidate) return null;
  const isWin32 = pathApi.sep === "\\";
  let root;
  let rootStat;
  try {
    root = fs.realpathSync(projectDir);
    rootStat = fs.lstatSync(root);
  } catch {
    return null;
  }
  if (!rootStat.isDirectory()) return null;
  const resolvedProject = pathApi.resolve(projectDir);
  const roots = root === resolvedProject ? [root] : [root, resolvedProject];
  const queue = initialQueue(candidate, root, resolvedProject, roots, pathApi, isWin32);
  if (queue === null) return null;

  const entries = [];
  let links = 0;

  while (queue.length > 0) {
    const part = queue.shift();
    if (part === ".") continue;
    if (part === "..") {
      if (entries.length === 0) return null;
      entries.pop();
      continue;
    }
    const at = pathApi.join(root, ...entries.map((entry) => entry.part), part);
    let stat;
    try {
      stat = fs.lstatSync(at);
    } catch {
      return null;
    }
    if (stat.isSymbolicLink()) {
      if (links >= MAX_LINKS) return null;
      links += 1;
      let target;
      try {
        target = fs.readlinkSync(at);
      } catch {
        return null;
      }
      if (typeof target !== "string" || !target) return null;
      const parsed = parseTarget(target, roots, isWin32);
      if (parsed === null) return null;
      if (parsed.rooted) entries.length = 0;
      queue.unshift(...parsed.parts);
      continue;
    }
    if (queue.length > 0 && !stat.isDirectory()) return null;
    entries.push({ part, path: at, stat });
  }

  if (entries.length === 0) return null;
  const leaf = entries.at(-1);
  return {
    root,
    rootStat,
    entries,
    full: leaf.path,
    relative: entries.map((entry) => entry.part).join(pathApi.sep),
    stat: leaf.stat,
  };
}

const sameNode = (a, b) => a.dev === b.dev && a.ino === b.ino;

function closeAll(fds, fs) {
  for (const fd of fds) {
    try {
      fs.closeSync(fd);
    } catch {
      // best-effort cleanup
    }
  }
}

const useProcFd = (pathApi) => process.platform === "linux" && pathApi.sep === "/";

function openDirChecked(target, expectedStat, dirFlags, fs) {
  const fd = fs.openSync(target, dirFlags);
  try {
    const stat = fs.fstatSync(fd);
    if (stat.isDirectory() && sameNode(stat, expectedStat)) return fd;
  } catch {
    // closed below before failing closed
  }
  closeAll([fd], fs);
  return null;
}

function openVerifiedDirs(root, rootStat, dirEntries, fs, pathApi) {
  const constants = fs.constants ?? nodeFs.constants;
  if (!constants?.O_DIRECTORY || !constants?.O_NOFOLLOW) return [];
  const dirFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
  const procFd = useProcFd(pathApi);
  const fds = [];
  try {
    const rootFd = openDirChecked(root, rootStat, dirFlags, fs);
    if (rootFd === null) return null;
    fds.push(rootFd);
    for (const entry of dirEntries) {
      const target = procFd ? `/proc/self/fd/${fds.at(-1)}/${entry.part}` : entry.path;
      const fd = openDirChecked(target, entry.stat, dirFlags, fs);
      if (fd === null) {
        closeAll(fds, fs);
        return null;
      }
      fds.push(fd);
    }
    return fds;
  } catch {
    closeAll(fds, fs);
    return null;
  }
}

function fdResolvesTo(fd, expectedFull, fs, pathApi) {
  if (!useProcFd(pathApi)) return true;
  try {
    return fs.readlinkSync(`/proc/self/fd/${fd}`) === expectedFull;
  } catch {
    return false;
  }
}

function sameChain(before, after, fdStat) {
  if (!after || after.full !== before.full) return false;
  if (!sameNode(before.rootStat, after.rootStat)) return false;
  if (before.entries.length !== after.entries.length) return false;
  if (!after.stat.isFile() || !sameNode(after.stat, fdStat)) return false;
  return before.entries.every((entry, i) => sameNode(entry.stat, after.entries[i].stat));
}

/**
 * Open and read a verified regular file inside `projectDir`. On Linux each parent directory and the leaf
 * are opened through `/proc/self/fd/<parentFd>/<part>` with `O_NOFOLLOW`; other platforms pin parent handles
 * where supported and re-verify every ancestor `(dev, ino)` after open.
 */
export function readFileInsideProject(
  projectDir,
  candidate,
  { fs = nodeFs, pathApi = nodePath } = {},
) {
  const walked = walkInsideProject(projectDir, candidate, { fs, pathApi });
  if (!walked || !walked.stat.isFile()) return null;
  const dirFds = openVerifiedDirs(
    walked.root,
    walked.rootStat,
    walked.entries.slice(0, -1),
    fs,
    pathApi,
  );
  if (dirFds === null) return null;
  let fd;
  try {
    const constants = fs.constants ?? nodeFs.constants;
    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
    const parentFd = dirFds.at(-1);
    const leaf = walked.entries.at(-1);
    const leafTarget =
      useProcFd(pathApi) && parentFd !== undefined
        ? `/proc/self/fd/${parentFd}/${leaf.part}`
        : walked.full;
    fd = fs.openSync(leafTarget, flags);
    const fdStat = fs.fstatSync(fd);
    if (!fdStat.isFile() || !sameNode(fdStat, walked.stat)) return null;
    if (!fdResolvesTo(fd, walked.full, fs, pathApi)) return null;
    const after = walkInsideProject(projectDir, walked.full, { fs, pathApi });
    if (!sameChain(walked, after, fdStat)) return null;
    return { path: walked.full, bytes: fs.readFileSync(fd) };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeAll([fd], fs);
    closeAll(dirFds, fs);
  }
}

/**
 * The verified destination path of `path` inside the real project root once links are read, or null when
 * it is the project itself, has an unresolved component, or leaves the project.
 */
export function resolveInsideProject(projectDir, path, options) {
  return walkInsideProject(projectDir, path, options)?.full ?? null;
}

/**
 * The verified path of `path` relative to the project once links are read, or null when it is the project
 * itself, has an unresolved component, or leaves it.
 */
export function insideProject(projectDir, path, options) {
  return walkInsideProject(projectDir, path, options)?.relative ?? null;
}

/** Whether a manifest record can be handed back as is: its file is in the project, or it is an inline grade. */
export function recordAvailable(projectDir, record, { fs = nodeFs, pathApi = nodePath } = {}) {
  if (!record) return false;
  if (record.path) {
    const candidate = recordPathInProject(projectDir, record.path, pathApi);
    if (candidate === null) return false;
    const walked = walkInsideProject(projectDir, candidate, { fs, pathApi });
    return walked !== null && walked.stat.isFile();
  }
  return record.type === "grade" && record.grading;
}
