import { delimiter, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { trustedPathDirs } from "@hyperframes/parsers/ff-binaries";

const neverCreatedPathFolder = () =>
  fileURLToPath(new URL("no-trusted-path-folder", import.meta.url));

function keyOf(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return Object.keys(env).find((key) => key.toUpperCase() === name);
}

export function withOnlyTrustedPathFolders(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const pathKey = keyOf(env, "PATH");
  if (!pathKey) return { ...env };
  const value = env[pathKey] ?? "";
  const dirs = trustedPathDirs(value, platform, env);
  const separator = platform === "win32" ? win32.delimiter : delimiter;
  return { ...env, [pathKey]: dirs.length > 0 ? dirs.join(separator) : neverCreatedPathFolder() };
}

export function skipWorkingDirectoryInExeSearch(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === "win32") env.NoDefaultCurrentDirectoryInExePath ??= "1";
}

export function searchOnlyTrustedFolders(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): void {
  const pathKey = keyOf(env, "PATH");
  if (pathKey) env[pathKey] = withOnlyTrustedPathFolders(env, platform)[pathKey];
  skipWorkingDirectoryInExeSearch(env, platform);
}

const pathKeyAtStart = keyOf(process.env, "PATH");
const PATH_AT_START = (pathKeyAtStart && process.env[pathKeyAtStart]) || "";

export function originalPath(): string {
  return PATH_AT_START;
}

searchOnlyTrustedFolders();
