import { failCommand } from "./commandResult.js";
import { existsSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { errorBox } from "../ui/format.js";
import { trackCommandFailure } from "../telemetry/events.js";

export interface ProjectDir {
  dir: string;
  name: string;
  indexPath: string;
}

export interface ResolveProjectOptions {
  requireIndex?: boolean;
}

export class InvalidProjectError extends Error {
  readonly title: string;
  readonly hint?: string;
  readonly suggestion?: string;

  constructor(title: string, hint?: string, suggestion?: string) {
    super(title);
    this.name = "InvalidProjectError";
    this.title = title;
    this.hint = hint;
    this.suggestion = suggestion;
  }
}

export function resolveProjectOrThrow(
  dirArg: string | undefined,
  options: ResolveProjectOptions = {},
): ProjectDir {
  const trimmed = dirArg?.trim();
  if (trimmed === "#") {
    throw new InvalidProjectError(
      "Invalid project directory: #",
      "# is a URL fragment, not a project path.",
      "Run hyperframes preview . from your project directory.",
    );
  }

  const dir = resolve(dirArg ?? ".");
  const name = basename(dir);
  const indexPath = resolve(dir, "index.html");

  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new InvalidProjectError("Not a directory: " + dir);
  }
  if (options.requireIndex !== false && !existsSync(indexPath)) {
    throw new InvalidProjectError(
      "No composition found in " + dir,
      "No index.html file found.",
      "Run npx hyperframes init to create a new composition.",
    );
  }

  return { dir, name, indexPath };
}

export function resolveProject(
  dirArg: string | undefined,
  options: ResolveProjectOptions = {},
): ProjectDir {
  try {
    return resolveProjectOrThrow(dirArg, options);
  } catch (err) {
    if (err instanceof InvalidProjectError) {
      // Reported here: several commands catch this failure and never reach the executable boundary.
      trackCommandFailure(process.argv[2] ?? "unknown", err);
      errorBox(err.title, err.hint, err.suggestion);
      failCommand(1, err);
    }
    throw err;
  }
}

export interface LintTarget {
  project: ProjectDir;
  entryFile?: string;
}

function projectHolding(file: string): string {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "index.html"))) return dir;
    if (dirname(dir) === dir) return dirname(file);
  }
}

export function resolveLintTarget(arg: string | undefined): LintTarget {
  const file = arg === undefined ? undefined : resolve(arg);
  if (file === undefined || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
    return { project: resolveProject(arg) };
  }
  const dir = projectHolding(file);
  const project = resolveProject(dir, { requireIndex: false });
  return file === project.indexPath ? { project } : { project, entryFile: file };
}

export function isUnderCompositions(projectDir: string, file: string): boolean {
  return relative(projectDir, file).split(sep)[0] === "compositions";
}
