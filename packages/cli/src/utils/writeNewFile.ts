import { linkSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Publish complete content without replacing or following an existing destination entry. */
export function writeNewFileSync(filePath: string, content: string): void {
  const stagingDir = mkdtempSync(join(dirname(filePath), ".hf-create-"));
  try {
    const stagedPath = join(stagingDir, "content");
    writeFileSync(stagedPath, content, { encoding: "utf-8", flag: "wx" });
    try {
      linkSync(stagedPath, filePath);
    } catch (err) {
      if (!(err instanceof Error && "code" in err && err.code === "EEXIST")) throw err;
    }
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}
