import { existsSync, statSync } from "node:fs";
import { resolve, basename } from "node:path";
import { errorBox } from "../ui/format.js";

export interface ProjectDir {
  dir: string;
  name: string;
  indexPath: string;
}

export function resolveProject(dirArg: string | undefined): ProjectDir {
  const dir = resolve(dirArg ?? ".");
  const name = basename(dir);
  const indexPath = resolve(dir, "index.html");

  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    errorBox("Not a directory: " + dir);
    process.exit(1);
  }
  if (!existsSync(indexPath)) {
    errorBox(
      "No composition found in " + dir,
      "No index.html file found.",
      "Run npx hyperframes init to create a new composition.",
    );
    process.exit(1);
  }

  return { dir, name, indexPath };
}
