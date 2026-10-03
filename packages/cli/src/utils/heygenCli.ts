import { execFileSync } from "node:child_process";
import { c } from "../ui/colors.js";

export const HEYGEN_CLI_DOCS_URL = "https://developers.heygen.com/cli";

/**
 * Whether the separate `heygen` CLI binary is reachable on PATH. media-use's
 * free resolution path shells out to it directly with no bundling/fallback,
 * so its absence silently breaks that path with no signal from auth login.
 */
export function hasHeygenCli(): boolean {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const output = execFileSync(cmd, ["heygen"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    return output.split(/\r?\n/).some((line) => line.trim().length > 0);
  } catch {
    return false;
  }
}

/**
 * Print a one-line note after a successful `auth login` when the separate
 * `heygen` CLI isn't on PATH. HeyGen's own CLI has no native Windows build
 * yet (WSL is the documented workaround), so win32 gets an extra mention.
 */
export function printHeygenCliNoteIfMissing(): void {
  if (hasHeygenCli()) return;
  const platformNote =
    process.platform === "win32" ? " (no native Windows build yet — use WSL)" : "";
  console.log(
    c.dim(
      `Note: media-use's free resolution path also needs the separate heygen CLI${platformNote} — see ${HEYGEN_CLI_DOCS_URL}`,
    ),
  );
}
