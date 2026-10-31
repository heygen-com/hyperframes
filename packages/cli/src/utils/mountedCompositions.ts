import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parseHTML } from "linkedom";
import { isPathInside } from "@hyperframes/core";

/** The entry file plus every sub-composition file it mounts, nested ones included, as project-relative paths. */
export function projectCompositionFiles(projectDir: string, entry = "index.html"): string[] {
  const files: string[] = [];
  const visit = (file: string): void => {
    if (files.includes(file)) return;
    const path = resolve(projectDir, file);
    if (!isPathInside(path, projectDir) || !existsSync(path)) return;
    files.push(file);
    const { document } = parseHTML(readFileSync(path, "utf8"));
    for (const host of document.querySelectorAll("[data-composition-src]")) {
      const src = host.getAttribute("data-composition-src");
      if (src) visit(relative(projectDir, resolve(projectDir, src)).split("\\").join("/"));
    }
  };
  visit(entry);
  return files;
}
