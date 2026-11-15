import { isAbsolute, relative, resolve, sep } from "node:path";
import { executableIn, pathEntries, trustedPathDirs } from "@hyperframes/parsers/ff-binaries";
import { originalPath } from "./windowsExeSearch.js";

function shownPath(cwd: string, found: string): string | undefined {
  const rel = relative(cwd, found);
  if (isAbsolute(rel)) return undefined;
  return rel === ".." || rel.startsWith(`..${sep}`) ? rel : `.${sep}${rel}`;
}

/** A copy of `name` in a PATH folder the trusted rule skipped, as `./…` or `../…` from the working directory. */
export function skippedProjectCopy(name: string, pathValue = originalPath()): string | undefined {
  const trusted = new Set(trustedPathDirs(pathValue));
  const cwd = process.cwd();
  for (const entry of pathEntries(pathValue)) {
    if (!entry || trusted.has(entry)) continue;
    const found = executableIn(resolve(cwd, entry), name);
    const shown = found && shownPath(cwd, found);
    if (shown) return shown;
  }
  return undefined;
}

/** A sentence for a not-found message when the project holds a copy of `name`, else "". */
export function projectCopyHint(name: string, pathValue = originalPath()): string {
  const copy = skippedProjectCopy(name, pathValue);
  if (!copy) return "";
  return ` A copy at ${copy} was not used: HyperFrames only runs programs from absolute PATH folders outside the current project. Install ${name} outside the project and retry.`;
}
