import { createHash } from "node:crypto";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { replaceFileAtomically } from "@hyperframes/core/atomic-file";
import { mkdirWithinProject } from "./safePath.js";
import type { PreviewDocumentStore } from "./mediaProxyPreview.js";

/** One built preview document under the project's `.hyperframes/preview`. `salt` names the server build, so new
 * code never reads a document an older build wrote. A failed read or write only costs a rebuild. */
export function createPreviewDocumentStore(projectDir: string, salt: string): PreviewDocumentStore {
  const dir = join(projectDir, ".hyperframes", "preview");
  const fileFor = (key: string) =>
    join(dir, `${createHash("sha256").update(`${salt}\n${key}`).digest("hex").slice(0, 32)}.html`);
  return {
    read(key) {
      try {
        return readFileSync(fileFor(key), "utf-8");
      } catch {
        return null;
      }
    },
    write(key, html) {
      try {
        mkdirWithinProject(projectDir, dir);
        const file = fileFor(key);
        replaceFileAtomically(file, html, 0o644);
        for (const name of readdirSync(dir)) {
          if (join(dir, name) !== file) rmSync(join(dir, name), { force: true });
        }
      } catch {
        // A document that fails to persist is rebuilt on the next open.
      }
    },
  };
}
