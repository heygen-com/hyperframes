import { isAbsolute, relative } from "node:path";
import { realFilePath } from "@hyperframes/studio-server/safe-path";

/** Why an upload left a file out: a private location (env files, Git data, hidden, system and app-data folders), or
 * an outside file reached from a file that came in with an imported project. */
export type LeftOutReason = "blocklisted" | "received";

/** One file an upload left out, as `cloud render --json` reports it. */
export interface LeftOutReference {
  /** The project file holding the reference, or the link itself. */
  file: string;
  /** The reference as written in `file`; for a link, the link's own path. */
  reference: string;
  /** Where it leads, from the project folder (`../shared/logo.png`); absolute when on another drive. */
  path: string;
  reason: LeftOutReason;
  /** How many folders above the project it leads: 1 for `../logo.png`; null on another drive. */
  levels_up: number | null;
}

/** Hears each file an upload leaves out: the warning a person reads, and the same thing for a program. */
export type OnLeftOut = (warning: string, reference: LeftOutReference) => void;

export function leftOutReference(
  projectDir: string,
  file: string,
  reference: string,
  absPath: string,
  reason: LeftOutReason,
): LeftOutReference {
  const path = relative(realFilePath(projectDir), realFilePath(absPath)).replaceAll("\\", "/");
  const levels_up = isAbsolute(path) ? null : path.split("/").filter((s) => s === "..").length;
  return { file, reference, path, reason, levels_up };
}
