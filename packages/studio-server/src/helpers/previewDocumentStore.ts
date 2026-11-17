import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { replaceFileAtomically } from "@hyperframes/core/atomic-file";
import { mkdirOwnedWithinProject, readProjectCacheFile } from "./safePath.js";
import type { PreviewDocumentStore } from "./mediaProxyPreview.js";

const MAX_DOCUMENT_BYTES = 256 * 1024 * 1024;
const MAC_HEX_LENGTH = 64;

/** One built preview document under the project's `.hyperframes/preview`. `salt` names the server build; the
 * user's private `secret` signs each document, so one the project shipped is never served. A miss costs a rebuild. */
export function createPreviewDocumentStore(
  projectDir: string,
  salt: string,
  secret: string,
): PreviewDocumentStore {
  if (!secret) return { read: () => null, write: () => {} };
  const dir = join(projectDir, ".hyperframes", "preview");
  const fileFor = (key: string) =>
    join(dir, `${createHash("sha256").update(`${salt}\n${key}`).digest("hex").slice(0, 32)}.html`);
  const macFor = (key: string, html: string) =>
    createHmac("sha256", secret)
      .update(`preview-document\n${salt}\n${key}\n`)
      .update(html)
      .digest("hex");
  return {
    read(key) {
      const stored = readProjectCacheFile(projectDir, fileFor(key), MAX_DOCUMENT_BYTES);
      if (!stored || stored.length <= MAC_HEX_LENGTH) return null;
      const html = stored.subarray(MAC_HEX_LENGTH + 1).toString("utf-8");
      const mac = stored.subarray(0, MAC_HEX_LENGTH);
      return timingSafeEqual(mac, Buffer.from(macFor(key, html))) ? html : null;
    },
    write(key, html) {
      try {
        mkdirOwnedWithinProject(projectDir, dir);
        const file = fileFor(key);
        replaceFileAtomically(file, `${macFor(key, html)}\n${html}`, 0o644);
        for (const name of readdirSync(dir)) {
          if (join(dir, name) !== file) rmSync(join(dir, name), { force: true });
        }
      } catch {
        // A document that fails to persist is rebuilt on the next open.
      }
    },
  };
}
