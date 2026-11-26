// @ts-check
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { referencedHiddenSourceFiles, openListed } from "./capture.mjs";
import { isEligibleHiddenSourcePath } from "./pathPolicy.mjs";

/** Share concurrent scans of a project, then forget the result so the next preview sees edits.
 * @type {Map<string, Promise<import("./types.js").Found[]>>} */
const scanning = new Map();

/** @param {string} root */
function referencedFiles(root) {
  let pending = scanning.get(root);
  if (!pending) {
    pending = referencedHiddenSourceFiles(root, undefined, { ignoreSyntax: "gitignore" }).finally(
      () => scanning.delete(root),
    );
    scanning.set(root, pending);
  }
  return pending;
}

/** A private-file route may serve this one project font from the descriptor checked against the
 * source inventory. A caller must never use the result to authorize a second open by pathname.
 * @param {string} projectDir @param {string} path @param {string} method */
export async function referencedFontResponse(projectDir, path, method) {
  const font = /(?:^|\/)\.[^/]+\.(woff2?|ttf|otf)$/i.exec(path);
  if (!font || (method !== "HEAD" && method !== "GET") || !isEligibleHiddenSourcePath(path))
    return null;
  try {
    const root = await realpath(projectDir);
    const full = join(root, path);
    if (!(await lstat(full)).isFile()) return null;
    const file = (await referencedFiles(root)).find((entry) => entry.path === path);
    if (!file) return null;
    const { size } = file;
    const handle = await openListed(root, file);
    if (!handle) return null;
    const headers = {
      "Content-Type": "font/" + font[1].toLowerCase(),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (method === "HEAD" || !size) {
      await handle.close();
      return new Response(null, { headers: { ...headers, "Content-Length": String(size) } });
    }
    const body = Readable.toWeb(handle.createReadStream({ end: size - 1 }));
    return new Response(/** @type {ReadableStream<Uint8Array<ArrayBuffer>>} */ (body), { headers });
  } catch {
    return null;
  }
}
