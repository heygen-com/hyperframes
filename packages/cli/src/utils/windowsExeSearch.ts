import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { trustedPathDirs } from "@hyperframes/parsers/ff-binaries";

const NEVER_CREATED_PATH_FOLDER = fileURLToPath(new URL("no-trusted-path-folder", import.meta.url));

function pathKeyOf(env: NodeJS.ProcessEnv): string | undefined {
  return Object.keys(env).find((name) => name.toUpperCase() === "PATH");
}

export function withOnlyTrustedPathFolders(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const pathKey = pathKeyOf(env);
  if (!pathKey) return { ...env };
  const dirs = trustedPathDirs(env[pathKey]);
  return { ...env, [pathKey]: dirs.length > 0 ? dirs.join(delimiter) : NEVER_CREATED_PATH_FOLDER };
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
  const pathKey = pathKeyOf(env);
  if (pathKey) env[pathKey] = withOnlyTrustedPathFolders(env)[pathKey];
  skipWorkingDirectoryInExeSearch(env, platform);
}

searchOnlyTrustedFolders();
