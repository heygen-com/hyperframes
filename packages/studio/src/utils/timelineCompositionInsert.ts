import { createStudioSaveHttpError } from "./studioSaveDiagnostics";
import { serializeStudioFileMutation } from "./studioFileMutationCoordinator";
import type { RecordEditInput } from "./studioFileHistory";
import { buildProjectApiPath } from "./projectRouting";
import { studioWriteHeaders } from "./studioFileVersion";
import { extendRootDurationInSource } from "./rootDuration";

interface TimelineCompositionInsertionResult {
  path: string;
  hostId: string;
  duration: number;
  before: string;
  after: string;
  version: string;
}

async function insertTimelineComposition(input: {
  projectId: string;
  targetPath: string;
  sourcePath: string;
  start: number;
  track: number;
}): Promise<TimelineCompositionInsertionResult> {
  const current = await fetch(
    buildProjectApiPath(input.projectId, `/files/${encodeURIComponent(input.targetPath)}`),
  );
  if (!current.ok) {
    throw await createStudioSaveHttpError(current, `Failed to read ${input.targetPath}`);
  }
  const snapshot = (await current.json()) as { version?: string };
  if (typeof snapshot.version !== "string") throw new Error("Missing composition file version");

  const response = await fetch(
    buildProjectApiPath(
      input.projectId,
      `/file-mutations/insert-composition/${encodeURIComponent(input.targetPath)}`,
    ),
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...studioWriteHeaders() },
      body: JSON.stringify({
        sourcePath: input.sourcePath,
        start: input.start,
        track: input.track,
        expectedVersion: snapshot.version,
      }),
    },
  );
  if (!response.ok) {
    throw await createStudioSaveHttpError(response, "Failed to add composition to timeline");
  }
  return (await response.json()) as TimelineCompositionInsertionResult;
}

export async function commitTimelineCompositionInsertion(input: {
  projectId: string;
  targetPath: string;
  sourcePath: string;
  start: number;
  track: number;
  writeFile: (path: string, content: string, expectedContent?: string) => Promise<void>;
  recordEdit: (entry: RecordEditInput) => Promise<void>;
  observeVersion?: (path: string, version: string | null) => void;
  selectHost: (key: string) => void;
  resync?: () => void;
  refresh: () => void;
}): Promise<void> {
  await serializeStudioFileMutation(input.writeFile, input.targetPath, async () => {
    const result = await insertTimelineComposition(input);
    input.observeVersion?.(input.targetPath, result.version);
    // The server never grows the root composition's duration (it only knows the
    // one file it patched); a drop past the end would render truncated, same gap
    // the asset/file drop path had. Extend here, the same grow-only helper, and
    // fold it into the same edit-history entry so it's one undo step.
    const finalAfter = extendRootDurationInSource(result.after, input.start + result.duration);
    try {
      if (finalAfter !== result.after) {
        await input.writeFile(input.targetPath, finalAfter, result.after);
      }
      await input.recordEdit({
        label: "Add composition to timeline",
        kind: "timeline",
        files: { [input.targetPath]: { before: result.before, after: finalAfter } },
      });
    } catch (error) {
      await input.writeFile(input.targetPath, result.before, finalAfter);
      throw error;
    }
    input.selectHost(`${input.targetPath}#${result.hostId}`);
    try {
      input.resync?.();
    } catch (error) {
      console.error("[Studio] Composition insertion committed but preview resync failed", error);
    }
    try {
      input.refresh();
    } catch (error) {
      console.error("[Studio] Composition insertion committed but refresh failed", error);
    }
  });
}
