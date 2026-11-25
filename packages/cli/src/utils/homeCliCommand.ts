import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute } from "node:path";

type GlobalInstallLocation = { cwd: string } | { reason: string };

export function globalInstallLocation(): GlobalInstallLocation {
  // Package scripts inherit project configuration and executable search paths from their manager.
  if (process.env["npm_lifecycle_event"]) {
    return {
      reason: "Run the global CLI update directly from your shell, outside the package script.",
    };
  }
  const unavailable = { reason: "The CLI update needs an accessible, absolute home directory." };
  try {
    const home = homedir();
    if (!isAbsolute(home)) return unavailable;
    const stat = statSync(home);
    if (!stat.isDirectory()) return unavailable;
    if (process.geteuid) {
      if (stat.uid !== process.geteuid()) {
        return {
          reason:
            "The home directory belongs to a different user. Run the update as the home owner, or use the effective user's own home directory.",
        };
      }
      if ((stat.mode & 0o022) !== 0) {
        return { reason: "The home directory allows writes by the group or other users." };
      }
    }
    accessSync(home, constants.X_OK);
    return { cwd: home };
  } catch {
    return unavailable;
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
