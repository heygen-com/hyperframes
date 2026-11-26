// @ts-check
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";

export class SourceIgnoreError extends Error {
  code = "invalid_source_ignore";
}
const scratch = (/** @type {string} */ path) => /(?:^|\/)[^/]+\.(?:log|swp)$/.test(path);

/** @typedef {"gitignore"} SourceIgnoreSyntax */
/** @typedef {(path: string, directory?: boolean) => boolean} SourceIgnore */

/** Read one immutable set of file-selection rules for the project walks in a capture. Hosts
 * with gitignore-style project rules opt into that syntax. Private-path checks apply separately.
 * @param {string} root @param {{syntax?: SourceIgnoreSyntax}} [options] @returns {Promise<SourceIgnore>} */
export async function readSourceIgnore(root, { syntax } = {}) {
  const text = await readIgnoreText(root);
  if (!text) return scratch;
  if (syntax === "gitignore") {
    const { default: ignore } = await import("ignore");
    const rules = ignore({ allowRelativePaths: true }).add(text);
    if (rules.ignores("index.html"))
      throw new SourceIgnoreError(
        ".hyperframesignore must include index.html at the project root.",
      );
    return (path, directory) => scratch(path) || rules.ignores(directory ? `${path}/` : path);
  }
  const paths = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const entries = paths.map(ignorePattern);
  return (path) => scratch(path) || entries.some((entry) => entry.test(path));
}

const invalidIgnoreFile = () =>
  new SourceIgnoreError(
    ".hyperframesignore must be a regular file inside the project, smaller than 64 KiB.",
  );

/** @param {string} file */
async function openIgnoreFile(file) {
  return open(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  ).catch(async (/** @type {NodeJS.ErrnoException} */ error) => {
    if (error.code !== "ENOENT") throw invalidIgnoreFile();
    // An absent file means no exclusions; a dangling symlink is invalid.
    const named = await lstat(file).catch((/** @type {NodeJS.ErrnoException} */ missing) => {
      if (missing.code === "ENOENT") return null;
      throw invalidIgnoreFile();
    });
    if (named) throw invalidIgnoreFile();
    return null;
  });
}

/** @param {import("node:fs/promises").FileHandle} handle @param {string} file */
async function verifyIgnoreFile(handle, file) {
  // Validate the opened descriptor before reading. lstat additionally rejects links on
  // platforms without O_NOFOLLOW; it never authorizes a later open of this path.
  const [stat, named] = await Promise.all([handle.stat(), lstat(file)]);
  if (
    !stat.isFile() ||
    stat.size >= 65536 ||
    !named.isFile() ||
    stat.ino !== named.ino ||
    stat.dev !== named.dev
  )
    throw invalidIgnoreFile();
}

/** @param {string} root */
async function readIgnoreText(root) {
  const file = join(root, ".hyperframesignore");
  const handle = await openIgnoreFile(file);
  if (!handle) return "";
  try {
    await verifyIgnoreFile(handle, file);
    const buffer = Buffer.alloc(65536);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length === buffer.length) throw invalidIgnoreFile();
    return buffer.subarray(0, length).toString("utf8");
  } finally {
    await handle.close();
  }
}

/** The exclusions change detection applies. Change detection must keep working whatever the file holds: the CLI
 * reads `.hyperframesignore` as gitignore syntax (`/renders/`, `**`, `!keep`), which this reader refuses. An
 * unreadable file then excludes only scratch files, so a scan sees more files, never fewer. Never use it to pick
 * files to send: it drops the file's valid exclusions too. @param {string} root
 * @returns {Promise<(path: string) => boolean>} */
export async function readChangeIgnore(root) {
  return readSourceIgnore(root).catch(() => scratch);
}

/** @param {string} entry */
function ignorePattern(entry) {
  const path = entry.replace(/\/$/, "");
  const invalid = () =>
    new SourceIgnoreError(
      ".hyperframesignore accepts project-relative paths or patterns with one * wildcard. Negation, traversal, and excluding index.html are not supported.",
    );
  if (!validPatternPath(path)) throw invalid();
  const escaped = path
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");
  const prefix = path.includes("*") && !path.includes("/") ? "(?:^|/)" : "^";
  const pattern = new RegExp(`${prefix}${escaped}(?:/|$)`);
  if (pattern.test("index.html")) throw invalid();
  return pattern;
}

/** @param {string} path */
function validPatternPath(path) {
  return (
    !/[\\?![\]:]/.test(path) &&
    !path.includes("\0") &&
    !path.split("/").some((part) => !part || part === "." || part === "..") &&
    path.split("*").length <= 2
  );
}
