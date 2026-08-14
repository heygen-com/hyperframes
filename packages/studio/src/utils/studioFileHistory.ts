import type { MutableRefObject } from "react";
import type { EditHistoryKind } from "./editHistory";
import { serializeStudioFileMutations } from "./studioFileMutationCoordinator";
import { createStudioSaveHttpError } from "./studioSaveDiagnostics";

export interface RecordEditInput {
  label: string;
  kind: EditHistoryKind;
  coalesceKey?: string;
  coalesceMs?: number;
  files: Record<string, { before: string; after: string }>;
}

export interface DomEditCommitBaseParams {
  activeCompPath: string | null;
  showToast: (message: string, tone?: "error" | "info") => void;
  writeProjectFile: ProjectFileWriter;
  domEditSaveTimestampRef: MutableRefObject<number>;
  editHistory: { recordEdit: (entry: RecordEditInput) => Promise<void> };
  projectIdRef: MutableRefObject<string | null>;
  reloadPreview: () => void;
  clearDomSelection: () => void;
}

type ProjectFileWriter = (path: string, content: string, expectedContent?: string) => Promise<void>;

interface SaveProjectFilesWithHistoryInput {
  projectId: string;
  label: string;
  kind: EditHistoryKind;
  coalesceKey?: string;
  coalesceMs?: number;
  files: Record<string, string>;
  readFile: (path: string) => Promise<string>;
  writeFile: ProjectFileWriter;
  recordEdit: (entry: RecordEditInput) => Promise<void>;
  /**
   * What a path holds ON DISK right now, when that is not the same as the
   * history's "before".
   *
   * The two are normally one value, so the write's optimistic-concurrency
   * expectation was taken straight from the undo baseline. They come apart when
   * a server-side mutation has already written part of the edit: deleting a clip
   * POSTs `remove-element`, which rewrites the file, and only then saves the
   * duration shrink — expecting the pre-delete content it read at the start. The
   * server had moved the file on, so the write was refused as a conflict, the
   * save queue paused, and the clip stayed on the timeline until a reload.
   *
   * Undo still restores `before`; this only says what to expect on disk.
   */
  diskContent?: Record<string, string>;
}

export async function readProjectFileContent(pid: string, path: string): Promise<string> {
  const response = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(path)}`);
  if (!response.ok) {
    throw await createStudioSaveHttpError(response, `Failed to read ${path}`);
  }
  const data = (await response.json()) as { content?: string };
  if (typeof data.content !== "string") {
    throw new Error(`Missing file contents for ${path}`);
  }
  return data.content;
}

export async function saveProjectFilesWithHistory({
  label,
  kind,
  coalesceKey,
  coalesceMs,
  files,
  readFile,
  writeFile,
  recordEdit,
  diskContent,
}: SaveProjectFilesWithHistoryInput): Promise<string[]> {
  return serializeStudioFileMutations(writeFile, Object.keys(files), async () => {
    const snapshots: Record<string, { before: string; after: string }> = {};
    for (const [path, after] of Object.entries(files)) {
      const before = await readFile(path);
      if (before !== after) {
        snapshots[path] = { before, after };
      }
    }

    const changedPaths = Object.keys(snapshots);
    if (changedPaths.length === 0) return [];

    const writtenPaths: string[] = [];
    try {
      for (const path of changedPaths) {
        await writeFile(path, snapshots[path].after, diskContent?.[path] ?? snapshots[path].before);
        writtenPaths.push(path);
      }

      await recordEdit({ label, kind, coalesceKey, coalesceMs, files: snapshots });
    } catch (error) {
      try {
        for (const path of writtenPaths.reverse()) {
          await writeFile(path, snapshots[path].before, snapshots[path].after);
        }
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Failed to save project files and rollback did not complete",
        );
      }
      throw error;
    }
    return changedPaths;
  });
}
