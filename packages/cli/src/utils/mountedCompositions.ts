import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { collectSubCompositionSrcs } from "@hyperframes/parsers/asset-resolution";
import { isPathInside } from "@hyperframes/core";

/** The entry file plus every sub-composition file it mounts, nested ones included, as project-relative paths. */
export function projectCompositionFiles(projectDir: string, entry = "index.html"): string[] {
  const files: string[] = [];
  const visit = (file: string): void => {
    if (files.includes(file)) return;
    const path = resolve(projectDir, file);
    if (!isPathInside(path, projectDir) || !existsSync(path)) return;
    files.push(file);
    for (const src of collectSubCompositionSrcs(readFileSync(path, "utf8"))) {
      visit(relative(projectDir, resolve(projectDir, src)).split("\\").join("/"));
    }
  };
  visit(entry);
  return files;
}
