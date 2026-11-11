import { relative } from "node:path";
import { isPrivateProjectFile, realFilePath } from "@hyperframes/studio-server/safe-path";

const ENV_FILE = /^\.env([._-].*|rc)?$/;

export function isEnvOrGitPath(path: string): boolean {
  const segments = path.toLowerCase().split(/[\\/]/);
  return segments.includes(".git") || ENV_FILE.test(segments.at(-1) ?? "");
}

/** Project files no composition loads, so none is served or uploaded for one: env files, Git data, tool records. */
export function isPrivateCompositionFile(projectDir: string, filePath: string): boolean {
  return (
    isEnvOrGitPath(relative(projectDir, filePath)) ||
    isEnvOrGitPath(relative(realFilePath(projectDir), realFilePath(filePath))) ||
    isPrivateProjectFile(projectDir, filePath)
  );
}
