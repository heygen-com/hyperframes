import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";

export interface ModelFile {
  name: string;
  bytes: number;
  sha256: string;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** The file at `path` has the pinned size and sha256. */
export async function verifies(path: string, file: ModelFile): Promise<boolean> {
  if (statSync(path, { throwIfNoEntry: false })?.size !== file.bytes) return false;
  return (await sha256File(path)) === file.sha256;
}
