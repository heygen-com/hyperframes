import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute } from "node:path";

/** A global install must not discover package-manager settings in the invoking project. */
export function globalInstallCwd(): string | null {
  try {
    const home = homedir();
    if (!isAbsolute(home)) return null;
    const stat = statSync(home);
    if (!stat.isDirectory()) return null;
    if (process.geteuid && (stat.uid !== process.geteuid() || (stat.mode & 0o022) !== 0))
      return null;
    accessSync(home, constants.X_OK);
    return home;
  } catch {
    return null;
  }
}

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
