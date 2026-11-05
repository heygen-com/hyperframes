import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ignore, { type Ignore } from "ignore";

// Unanchored ".*" matches a dot-prefixed name at any depth, and a `.hyperframesignore` negation can still override it.
const DEFAULT_PROJECT_IGNORE = ["/renders/", "/snapshots/", ".*"];

/** What the project leaves out: renders, snapshots, dotfiles and its `.hyperframesignore` rules. Paths are relative,
 * with `/` separators, and a folder is asked about with a trailing `/`. */
export function projectIgnore(projectDir: string): Ignore {
  const matcher = ignore().add(DEFAULT_PROJECT_IGNORE);
  const ignorePath = join(projectDir, ".hyperframesignore");
  if (existsSync(ignorePath)) matcher.add(readFileSync(ignorePath, "utf-8"));
  return matcher;
}
