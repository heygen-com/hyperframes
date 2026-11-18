/** Manual update commands are often copied from a project terminal. Start npm in the home folder. */
export function homeCliCommand(
  release: string,
  action: "" | "update" = "",
  platform = process.platform,
): string {
  const args = `hyperframes@${release}${action ? " " + action : ""}`;
  if (platform === "win32") {
    return `powershell.exe -NoProfile -Command "Set-Location ~ -ErrorAction Stop; npx.cmd ${args}"`;
  }
  return `(cd ~ && npx ${args})`;
}
