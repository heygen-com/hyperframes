import { isAbsolute, relative, resolve, sep } from "node:path";
import { executableIn, pathEntries, trustedPathDirs } from "@hyperframes/parsers/ff-binaries";
import { originalPath } from "./windowsExeSearch.js";

/** `found` relative to `cwd`, with a leading `./` when it is inside; `undefined` when it is on another drive. */
function shownPath(cwd: string, found: string): string | undefined {
  const rel = relative(cwd, found);
  if (isAbsolute(rel)) return undefined;
  return rel === ".." || rel.startsWith(`..${sep}`) ? rel : `.${sep}${rel}`;
}

/**
 * A copy of `name` in a PATH folder the trusted rule skipped, relative to the working directory:
 * `./node_modules/.bin/sam` in the project, or `../node_modules/.bin/sam` when an npm or pnpm
 * script runs from a subfolder.
 */
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
