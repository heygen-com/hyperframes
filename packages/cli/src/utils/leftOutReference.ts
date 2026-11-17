import { terminalText } from "@hyperframes/core";
import { isAbsolute, relative } from "node:path";
import {
  type LeftOutReason,
  leftOutWarning as leftOutText,
} from "@hyperframes/studio-server/outside-file";
import { realFilePath } from "@hyperframes/studio-server/safe-path";
import { namesAnotherNetworkRoot } from "@hyperframes/parsers/asset-resolution";

export type { LeftOutReason };

export const leftOutWarning = (file: string, reference: string, reason: LeftOutReason): string =>
  terminalText(leftOutText(file, reference, reason));

/** One file an upload left out. `path` is from the project folder; `levels_up` is null on another drive. */
export interface LeftOutReference {
  file: string;
  reference: string;
  path: string;
  reason: LeftOutReason;
  levels_up: number | null;
}

export type OnLeftOut = (warning: string, reference: LeftOutReference) => void;

export type OutsideFileReference = Omit<LeftOutReference, "reason">;

export type OnOutsideFile = (reference: OutsideFileReference) => void;

export function outsideFileReference(
  projectDir: string,
  file: string,
  reference: string,
  absPath: string,
): OutsideFileReference {
  const onAnotherShare = namesAnotherNetworkRoot(projectDir, absPath);
  const target = onAnotherShare ? absPath : realFilePath(absPath);
  const path = relative(realFilePath(projectDir), target).replaceAll("\\", "/");
  const levels_up = isAbsolute(path) ? null : path.split("/").filter((s) => s === "..").length;
  return { file, reference, path, levels_up };
}

export function leftOutReference(
  projectDir: string,
  file: string,
  reference: string,
  absPath: string,
  reason: LeftOutReason,
): LeftOutReference {
  const { path, levels_up } = outsideFileReference(projectDir, file, reference, absPath);
  return { file, reference, path, reason, levels_up };
}

export function outsideFilesNotice(references: OutsideFileReference[]): string {
  const count = references.length === 1 ? "1 file" : `${references.length} files`;
  const lines = references.map(({ file, reference, path }) =>
    terminalText(
      file === reference ? `  ${path} (linked from ${file})` : `  ${path} (referenced by ${file})`,
    ),
  );
  return [`Uploading ${count} from outside the project folder:`, ...lines].join("\n");
}
