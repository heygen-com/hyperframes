/**
 * Windows resolves a bare command name in the working directory before PATH unless
 * `NoDefaultCurrentDirectoryInExePath` is set. Node's spawn and cmd.exe both honor it,
 * and children inherit it, so a project folder cannot supply `powershell.exe`,
 * `taskkill.exe` or an `npx.cmd` of its own.
 */
export function skipWorkingDirectoryInExeSearch(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === "win32") env.NoDefaultCurrentDirectoryInExePath ??= "1";
}

skipWorkingDirectoryInExeSearch();
