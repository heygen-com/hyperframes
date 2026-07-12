import type { MutableRefObject } from "react";
import type { EditHistoryKind } from "../utils/editHistory";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import { patchMediaColorGradingInHtml } from "./editor/colorGradingScopePatch";
import { hasRelativeLutSource } from "./studioMediaJobs";

export type ColorGradingScope = "source-file" | "project";
export type ColorGradingScopeResult = { changedFiles: number; changedElements: number };

type ProjectFileReader = (path: string) => Promise<string>;
type ProjectFileWriter = (path: string, content: string) => Promise<void>;
type ShowToast = (message: string, tone?: "error" | "info") => void;
type RecordEdit = (entry: {
  label: string;
  kind: EditHistoryKind;
  files: Record<string, { before: string; after: string }>;
}) => Promise<void>;

export const EMPTY_COLOR_GRADING_SCOPE_RESULT: ColorGradingScopeResult = {
  changedFiles: 0,
  changedElements: 0,
};

interface ApplyColorGradingScopeOptions {
  scope: ColorGradingScope;
  value: string | null;
  selectedSourceFile: string;
  fileTree: string[];
  projectId: string;
  domEditSaveTimestampRef: MutableRefObject<number>;
  waitForPendingDomEditSaves: () => Promise<void>;
  readProjectFile: ProjectFileReader;
  writeProjectFile: ProjectFileWriter;
  recordEdit: RecordEdit;
  reloadPreview: () => void;
  showToast: ShowToast;
}

function colorGradingScopePaths(
  scope: ColorGradingScope,
  selectedSourceFile: string,
  fileTree: string[],
): string[] {
  return scope === "source-file"
    ? [selectedSourceFile]
    : fileTree.filter((path) => /\.html?$/i.test(path));
}

async function patchColorGradingScopeFiles(
  paths: string[],
  value: string | null,
  readProjectFile: ProjectFileReader,
): Promise<{ files: Record<string, string>; changedElements: number }> {
  const snapshots = await Promise.all(
    Array.from(new Set(paths)).map(async (path) => ({
      path,
      before: await readProjectFile(path),
    })),
  );
  const files: Record<string, string> = {};
  let changedElements = 0;

  for (const { path, before } of snapshots) {
    const result = patchMediaColorGradingInHtml(before, value);
    if (result.html !== before) {
      files[path] = result.html;
      changedElements += result.count;
    }
  }

  return { files, changedElements };
}

// fallow-ignore-next-line complexity
export async function applyColorGradingScopeUpdate({
  scope,
  value,
  selectedSourceFile,
  fileTree,
  projectId,
  domEditSaveTimestampRef,
  waitForPendingDomEditSaves,
  readProjectFile,
  writeProjectFile,
  recordEdit,
  reloadPreview,
  showToast,
}: ApplyColorGradingScopeOptions): Promise<ColorGradingScopeResult> {
  await waitForPendingDomEditSaves();
  if (scope === "project" && hasRelativeLutSource(value)) {
    showToast(
      "Project-wide color grading cannot copy relative LUT paths. Apply to this file or use a URL/data LUT.",
      "error",
    );
    return EMPTY_COLOR_GRADING_SCOPE_RESULT;
  }

  const { files, changedElements } = await patchColorGradingScopeFiles(
    colorGradingScopePaths(scope, selectedSourceFile, fileTree),
    value,
    readProjectFile,
  );
  if (Object.keys(files).length === 0) {
    showToast("No color grading changed", "info");
    return EMPTY_COLOR_GRADING_SCOPE_RESULT;
  }

  domEditSaveTimestampRef.current = Date.now();
  const changedPaths = await saveProjectFilesWithHistory({
    projectId,
    label: value ? "Apply color grading" : "Clear color grading",
    kind: "manual",
    files,
    readFile: readProjectFile,
    writeFile: writeProjectFile,
    recordEdit,
  });
  reloadPreview();
  showToast(
    `${value ? "Applied" : "Cleared"} color grading on ${changedElements} media item${changedElements === 1 ? "" : "s"}`,
    "info",
  );
  return { changedFiles: changedPaths.length, changedElements };
}
