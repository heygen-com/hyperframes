import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The file lines a snippet id, `<file>:<start>-<end>`, names, as they are on disk now. */
export function snippetSource(project: string, id: string): string {
  const [, file, startLine, endLine] = /^(.+):(\d+)-(\d+)$/.exec(id)!;
  return readFileSync(join(project, file!), "utf8")
    .split(/(?<=\n)/)
    .slice(Number(startLine) - 1, Number(endLine))
    .join("");
}
