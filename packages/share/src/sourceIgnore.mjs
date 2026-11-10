// @ts-check
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";

/** Explicit, project-relative exclusions. This only removes files; it cannot override safety exclusions.
 * @param {string} root @returns {Promise<(path: string) => boolean>} */
export async function readSourceIgnore(root) {
  const file = join(root, ".hyperframesignore");
  const invalid = () =>
    new Error(".hyperframesignore must be a regular file inside the project, smaller than 64 KiB.");
  const handle = await open(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  ).catch(async (/** @type {NodeJS.ErrnoException} */ error) => {
    if (error.code !== "ENOENT") throw invalid();
    // An absent file means no exclusions; a dangling symlink is invalid.
    const named = await lstat(file).catch((/** @type {NodeJS.ErrnoException} */ missing) => {
      if (missing.code === "ENOENT") return null;
      throw invalid();
    });
    if (named) throw invalid();
    return null;
  });
  if (!handle) return () => false;
  let text;
  try {
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
      throw invalid();
    const buffer = Buffer.alloc(65536);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length === buffer.length) throw invalid();
    text = buffer.subarray(0, length).toString("utf8");
  } finally {
    await handle.close();
  }
  const paths = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const entries = paths.map((entry) => {
    const path = entry.replace(/\/$/, "");
    if (
      path === "index.html" ||
      /[\\*?![\]:]/.test(path) ||
      path.includes("\0") ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error(
        ".hyperframesignore accepts literal project-relative file or folder paths, one per line. Wildcards and excluding index.html are not supported.",
      );
    return path;
  });
  return (path) => entries.some((entry) => path === entry || path.startsWith(`${entry}/`));
}
