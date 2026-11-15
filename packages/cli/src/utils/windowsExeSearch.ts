import { delimiter, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { trustedPathDirs } from "@hyperframes/parsers/ff-binaries";

const NEVER_CREATED_PATH_FOLDER = fileURLToPath(new URL("no-trusted-path-folder", import.meta.url));

function keyOf(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return Object.keys(env).find((key) => key.toUpperCase() === name);
}

function windowsFolderKey(dir: string): string {
  return dir.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();
}

function windowsSystemFolders(env: NodeJS.ProcessEnv): Set<string> {
  const rootKey = keyOf(env, "SYSTEMROOT");
  const root = (rootKey && env[rootKey]) || "C:\\Windows";
  const system32 = win32.join(root, "System32");
  return new Set(
    [
      root,
      system32,
      win32.join(system32, "Wbem"),
      win32.join(system32, "WindowsPowerShell", "v1.0"),
    ].map(windowsFolderKey),
  );
}

function unquoted(dir: string): string {
  return dir.length > 1 && dir.startsWith('"') && dir.endsWith('"') ? dir.slice(1, -1) : dir;
}

function windowsTrustedDirs(pathValue: string, env: NodeJS.ProcessEnv): string[] {
  const entries = pathValue.split(win32.delimiter).map(unquoted);
  const trusted = new Set(trustedPathDirs(entries.join(delimiter)));
  const system = windowsSystemFolders(env);
  return [
    ...new Set(entries.filter((dir) => trusted.has(dir) || system.has(windowsFolderKey(dir)))),
  ];
}

export function withOnlyTrustedPathFolders(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const pathKey = keyOf(env, "PATH");
  if (!pathKey) return { ...env };
  const value = env[pathKey] ?? "";
  const dirs = platform === "win32" ? windowsTrustedDirs(value, env) : trustedPathDirs(value);
  const separator = platform === "win32" ? win32.delimiter : delimiter;
  return { ...env, [pathKey]: dirs.length > 0 ? dirs.join(separator) : NEVER_CREATED_PATH_FOLDER };
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
