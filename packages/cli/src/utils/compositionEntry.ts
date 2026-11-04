import { realpathSync, type Stats } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { errorBox } from "../ui/format.js";
import { failUsage } from "./commandResult.js";

export type CompositionEntryParseError = {
  kind: "outside-project" | "not-found" | "not-a-file";
  entryFile: string;
  entryPath: string;
  projectDir: string;
};

export type CompositionEntryParseResult =
  | { ok: true; value: string | undefined }
  | { ok: false; error: CompositionEntryParseError };

function normalizeCompositionEntryArg(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim().replace(/^\.\//, "") || undefined;
  return !trimmed || trimmed === "." ? undefined : trimmed;
}

export function hasExplicitCompositionArg(raw: string | undefined): boolean {
  return normalizeCompositionEntryArg(raw) !== undefined;
}

/** `--composition <path>` as a project-relative entry file; `undefined` (also for "." / "./") means index.html. */
export function parseCompositionEntryArg(
  raw: string | undefined,
  projectDir: string,
  stat: (path: string) => Stats,
  real: (path: string) => string = realpathOrSame,
): CompositionEntryParseResult {
  const trimmed = normalizeCompositionEntryArg(raw);
  // A project-root shorthand is no override; statting the dir would end in EISDIR (#1199).
  if (!trimmed) return { ok: true, value: undefined };

  const absProjectDir = resolve(projectDir);
  const entryPath = resolve(absProjectDir, trimmed);
  // An absolute entry may name the project through a symlink (macOS /tmp), so try both spellings of each.
  const relativeEntry = [absProjectDir, real(absProjectDir)]
    .flatMap((root) => [entryPath, real(entryPath)].map((path) => relative(root, path)))
    .find((rel) => rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  const fail = (kind: CompositionEntryParseError["kind"]): CompositionEntryParseResult => ({
    ok: false,
    error: { kind, entryFile: trimmed, entryPath, projectDir: absProjectDir },
  });
  if (relativeEntry === undefined) return fail("outside-project");

  let entryStat: Stats;
  try {
    entryStat = stat(entryPath);
  } catch {
    return fail("not-found");
  }
  if (!entryStat.isFile()) {
    // A directory would pass existsSync downstream and fail with EISDIR in the producer.
    return fail("not-a-file");
  }
  return { ok: true, value: relativeEntry.split(sep).join("/") };
}

function realpathOrSame(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function compositionEntryErrorMessage(error: CompositionEntryParseError): {
  title: string;
  message: string;
  hint?: string;
} {
  const resolved = `"${error.entryFile}" resolves to ${error.entryPath}`;
  switch (error.kind) {
    case "outside-project":
      return {
        title: "Invalid composition path",
        message: `${resolved}, outside the project directory ${error.projectDir}.`,
        hint: "Pass a .html file inside the project directory, relative to it (e.g. compositions/intro.html).",
      };
    case "not-found":
      return {
        title: "Composition not found",
        message: `${resolved}, which does not exist in the project directory ${error.projectDir}.`,
        hint: "Pass a path to a .html file relative to the project root (e.g. compositions/intro.html).",
      };
    case "not-a-file":
      return {
        title: "Invalid composition path",
        message: `${resolved}, a directory, not an .html file (project directory ${error.projectDir}).`,
        hint: "Pass a path to a .html file (e.g. compositions/intro.html), or omit --composition to render index.html.",
      };
  }
}

/** `parseCompositionEntryArg`, exiting with an error box on failure. */
export function resolveCompositionEntryArg(
  raw: string | undefined,
  projectDir: string,
  stat: (path: string) => Stats,
): string | undefined {
  const result = parseCompositionEntryArg(raw, projectDir, stat);
  if (!result.ok) {
    const { title, message, hint } = compositionEntryErrorMessage(result.error);
    errorBox(title, message, hint);
    failUsage();
  }
  return result.value;
}
