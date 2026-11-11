export function skipWorkingDirectoryInExeSearch(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === "win32") env.NoDefaultCurrentDirectoryInExePath ??= "1";
}

skipWorkingDirectoryInExeSearch();
