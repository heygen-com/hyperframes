import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ignore, { type Ignore } from "ignore";

const DEFAULT_PROJECT_IGNORE = ["/renders/", "/snapshots/", ".*"];

/** What the project leaves out; ask with a relative `/` path, a folder with a trailing `/`. */
export function projectIgnore(projectDir: string): Ignore {
  const matcher = ignore().add(DEFAULT_PROJECT_IGNORE);
  const ignorePath = join(projectDir, ".hyperframesignore");
  if (existsSync(ignorePath)) matcher.add(readFileSync(ignorePath, "utf-8"));
  return matcher;
}
