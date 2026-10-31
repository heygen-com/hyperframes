import { createFileAtomically } from "@hyperframes/core/atomic-file";

/** Publish complete content without replacing or following an existing destination entry. */
export function writeNewFileSync(filePath: string, content: string): void {
  try {
    createFileAtomically(filePath, content);
  } catch (err) {
    if (!(err instanceof Error && "code" in err && err.code === "EEXIST")) throw err;
  }
}
