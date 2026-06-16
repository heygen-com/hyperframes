import { existsSync, statSync } from "node:fs";
import { resolve, basename } from "node:path";
import { errorBox } from "../ui/format.js";
import { trackCommandFailure } from "../telemetry/events.js";

export interface ProjectDir {
  dir: string;
  name: string;
  indexPath: string;
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

export function resolveProjectOrThrow(dirArg: string | undefined): ProjectDir {
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
  if (!existsSync(indexPath)) {
    throw new InvalidProjectError(
      "No composition found in " + dir,
      "No index.html file found.",
      "Run npx hyperframes init to create a new composition.",
    );
  }

  return { dir, name, indexPath };
}

export function resolveProject(dirArg: string | undefined): ProjectDir {
  try {
    return resolveProjectOrThrow(dirArg);
  } catch (err) {
    if (err instanceof InvalidProjectError) {
      // Self-exit (not a throw) so the cli.ts wrapper never sees it — report
      // inline. argv[2] is the running command (info / inspect / render / ...).
      // This is the dominant failure for read-only commands like `info` run
      // outside a project; the redaction in trackCliError strips the dir path.
      trackCommandFailure(process.argv[2] ?? "unknown", err);
      errorBox(err.title, err.hint, err.suggestion);
      process.exit(1);
    }
    throw err;
  }
}
