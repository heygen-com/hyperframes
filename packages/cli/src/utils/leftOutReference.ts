import { isAbsolute, relative } from "node:path";
import { realFilePath } from "@hyperframes/studio-server/safe-path";

/** `blocklisted`: a private location; `received`: reached from an imported file; `file_type`: not a type uploads copy. */
export type LeftOutReason = "blocklisted" | "received" | "file_type";

/** One file an upload left out. `path` is from the project folder; `levels_up` is null on another drive. */
export interface LeftOutReference {
  file: string;
  reference: string;
  path: string;
  reason: LeftOutReason;
  levels_up: number | null;
}

export type OnLeftOut = (warning: string, reference: LeftOutReference) => void;

const WHY: Record<LeftOutReason, string> = {
  blocklisted: "which is outside the project in a private location",
  received: "which leads outside the project and came in with an imported project",
  file_type: "which is outside the project and is not an image, video, audio, font, CSS or JS file",
};

export function leftOutWarning(file: string, reference: string, reason: LeftOutReason): string {
  const warning = `${file} references ${reference}, ${WHY[reason]}; it was left out of the upload.`;
  return reason === "file_type" ? `${warning} Move it into the project to include it.` : warning;
}

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
