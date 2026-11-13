import { isAbsolute, relative } from "node:path";
import { type LeftOutReason, leftOutWarning } from "@hyperframes/studio-server/outside-file";
import { realFilePath } from "@hyperframes/studio-server/safe-path";

export { type LeftOutReason, leftOutWarning };

/** One file an upload left out. `path` is from the project folder; `levels_up` is null on another drive. */
export interface LeftOutReference {
  file: string;
  reference: string;
  path: string;
  reason: LeftOutReason;
  levels_up: number | null;
}

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
