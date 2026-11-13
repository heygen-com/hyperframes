import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  isEnvOrGitPath,
  isPrivateOutsideFile,
  linksOutside,
} from "@hyperframes/studio-server/outside-file";
import { isPrivateProjectFile, realFilePath } from "@hyperframes/studio-server/safe-path";

export { isEnvOrGitPath, isPrivateOutsideFile, linksOutside };

export function linksToPrivateOutsideFile(projectDir: string, filePath: string): boolean {
  return linksOutside(projectDir, filePath) && isPrivateOutsideFile(projectDir, filePath);
}

export function receivedFiles(projectDir: string): (path: string) => boolean {
  let listed: unknown;
  try {
    listed = JSON.parse(
      readFileSync(join(projectDir, ".hyperframes", "received-files.json"), "utf-8"),
    ).files;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return () => false;
  }
  if (!Array.isArray(listed)) return () => true;
  const files = new Set(listed.map((path) => String(path).normalize("NFC")));
  return (path) => files.has(path.normalize("NFC"));
}

/** Project files no composition loads, so none is served or uploaded for one: env files, Git data, tool records. */
export function isPrivateCompositionFile(projectDir: string, filePath: string): boolean {
  return (
    isEnvOrGitPath(relative(projectDir, filePath)) ||
    isEnvOrGitPath(relative(realFilePath(projectDir), realFilePath(filePath))) ||
    isPrivateProjectFile(projectDir, filePath)
  );
}
