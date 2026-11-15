import { isAbsolute, relative, resolve, sep } from "node:path";
import { executableIn, pathEntries, trustedPathDirs } from "@hyperframes/parsers/ff-binaries";
import { originalPath } from "./windowsExeSearch.js";

function insideWorkingDirectory(rel: string): boolean {
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** A copy of `name` in a PATH folder the trusted rule skipped, relative to the working directory. */
export function skippedProjectCopy(name: string, pathValue = originalPath()): string | undefined {
  const trusted = new Set(trustedPathDirs(pathValue));
  const cwd = process.cwd();
  for (const entry of pathEntries(pathValue)) {
    if (trusted.has(entry)) continue;
    const found = executableIn(resolve(cwd, entry), name);
    const rel = found && relative(cwd, found);
    if (rel && insideWorkingDirectory(rel)) return `.${sep}${rel}`;
  }
  return undefined;
}

/** A sentence for a not-found message when the project holds a copy of `name`, else "". */
export function projectCopyHint(name: string, pathValue = originalPath()): string {
  const copy = skippedProjectCopy(name, pathValue);
  if (!copy) return "";
  return ` A copy at ${copy} was not used: HyperFrames only runs programs from folders outside the current project. Install ${name} outside the project and retry.`;
}
