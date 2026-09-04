/**
 * Where the style tests read from.
 *
 * Three tests in this folder compile Studio's stylesheet or walk Studio's
 * sources, and each needs the same two things: Tailwind's own entry file
 * resolved from `node_modules`, and the file list that `@source` in
 * `studio.css` describes. Kept here so the gate, the ratchet and the theme
 * test cannot disagree about which files are Studio's.
 */

import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const STYLES_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.dirname(STYLES_DIR);
export const REPO_ROOT = path.resolve(SRC_DIR, "../../..");

const require = createRequire(import.meta.url);
export const TAILWIND_DIR = path.dirname(require.resolve("tailwindcss/package.json"));

/** Resolves `@import` for Tailwind's compiler: bare `tailwindcss`, or a path. */
export function loadStylesheet(id: string, base: string) {
  const file = id === "tailwindcss" ? path.join(TAILWIND_DIR, "index.css") : path.resolve(base, id);
  return { path: file, base: path.dirname(file), content: readFileSync(file, "utf8") };
}

/**
 * Studio's own sources, keyed by path relative to `from`, for every file the
 * caller keeps. Build output and dependencies are never walked.
 */
export function listSourceFiles(
  keep: (relativePath: string) => boolean,
  from: string = SRC_DIR,
): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "dist") walk(full);
      } else if (keep(path.relative(from, full))) {
        files.set(path.relative(from, full), readFileSync(full, "utf8"));
      }
    }
  };
  walk(SRC_DIR);
  return files;
}
