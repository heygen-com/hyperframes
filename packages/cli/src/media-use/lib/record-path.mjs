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

/**
 * Walk `candidate` component by component from `realpathSync(projectDir)` using `lstat` and `readlink`,
 * failing closed on any unresolved component, link target outside the project, or link loop.
 */
function walkInsideProject(projectDir, candidate, { fs = nodeFs, pathApi = nodePath } = {}) {
  if (typeof candidate !== "string" || !candidate) return null;
  const isWin32 = pathApi.sep === "\\";
  let root;
  try {
    root = fs.realpathSync(projectDir);
  } catch {
    return null;
  }
  const resolvedProject = pathApi.resolve(projectDir);
  const roots = root === resolvedProject ? [root] : [root, resolvedProject];

  let queue;
  const isRooted = isWin32 ? ROOTED.test(candidate) : candidate.startsWith("/");
  if (isRooted) {
    const parsed = parseTarget(candidate, roots, isWin32);
    if (parsed === null) return null;
    queue = parsed.parts;
  } else {
    const full = pathApi.resolve(candidate);
    const initial =
      relativeInside(root, full, pathApi) ?? relativeInside(resolvedProject, full, pathApi);
    if (initial === null) return null;
    queue = rawSegments(initial, isWin32);
  }

  const stack = [];
  let links = 0;
  let lastStat = null;

  while (queue.length > 0) {
    const part = queue.shift();
    if (part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) return null;
      stack.pop();
      lastStat = null;
      continue;
    }
    const at = pathApi.join(root, ...stack, part);
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
      if (parsed.rooted) stack.length = 0;
      queue.unshift(...parsed.parts);
      lastStat = null;
      continue;
    }
    if (queue.length > 0 && !stat.isDirectory()) return null;
    stack.push(part);
    lastStat = stat;
  }

  if (stack.length === 0) return null;
  const verified = pathApi.join(root, ...stack);
  if (lastStat === null) {
    try {
      lastStat = fs.lstatSync(verified);
      if (lastStat.isSymbolicLink()) return null;
    } catch {
      return null;
    }
  }
  return {
    full: verified,
    relative: stack.join(pathApi.sep),
    stat: lastStat,
  };
}

/**
 * The verified destination path of `path` inside the real project root once links are read, or null when
 * it is the project itself, has an unresolved component, or leaves the project. Callers must open this path.
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
