import { useCallback, useRef } from "react";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import { getTimelineElementLabel, collectHtmlIds } from "../utils/studioHelpers";
import { trackStudioRazorSplit } from "../telemetry/events";
import {
  canSplitElementAt,
  selectSplittableElements,
  buildPatchTarget,
  readFileContent,
} from "../utils/timelineElementSplit";
import type { RecordEditInput } from "./timelineEditingHelpers";

interface UseRazorSplitOptions {
  projectId: string | null;
  activeCompPath: string | null;
  showToast: (message: string, tone?: "error" | "info") => void;
  writeProjectFile: (path: string, content: string, expectedContent?: string) => Promise<void>;
  observeProjectFileVersion?: (path: string, version: string | null) => void;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  domEditSaveTimestampRef: React.MutableRefObject<number>;
  reloadPreview: () => void;
  /**
   * Resync the in-memory SDK session after the server-side split write (the
   * split-element / split-gsap endpoints write the file directly, so the SDK's
   * linkedom doc is now stale). This reload is read-only; the split endpoint owns
   * the final on-disk bytes and history baseline. Every other server-side-write
   * timeline path (move / resize / delete / drop / visibility) also resyncs.
   */
  forceReloadSdkSession?: () => void;
  isRecordingRef?: React.RefObject<boolean>;
}

function generateSplitId(existingIds: string[], baseId: string): string {
  let newId = `${baseId}-split`;
  let suffix = 2;
  while (existingIds.includes(newId)) {
    newId = `${baseId}-split-${suffix++}`;
  }
  return newId;
}

async function splitHtmlElement(
  projectId: string,
  targetPath: string,
  patchTarget: NonNullable<ReturnType<typeof buildPatchTarget>>,
  splitTime: number,
  newId: string,
  elementStart: number,
  elementDuration: number,
): Promise<{ ok: boolean; changed?: boolean; content?: string; version: string }> {
  const response = await fetch(
    `/api/projects/${projectId}/file-mutations/split-element/${encodeURIComponent(targetPath)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: patchTarget,
        splitTime,
        newId,
        elementStart,
        elementDuration,
      }),
    },
  );
  if (!response.ok) throw new Error("Split request failed");
  const data = (await response.json()) as {
    ok: boolean;
    changed?: boolean;
    content?: string;
    version?: string;
  };
  const version = data.version ?? response.headers.get("etag");
  if (!version) throw new Error("Split response did not include a content version");
  return { ...data, version };
}

// fallow-ignore-next-line complexity
async function splitGsapAnimations(
  projectId: string,
  targetPath: string,
  originalId: string,
  newId: string,
  splitTime: number,
  elementStart: number,
  elementDuration: number,
): Promise<{ content: string | null; version?: string; skippedSelectors?: string[] }> {
  const response = await fetch(
    `/api/projects/${projectId}/gsap-mutations/${encodeURIComponent(targetPath)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "split-animations",
        originalId,
        newId,
        splitTime,
        elementStart,
        elementDuration,
      }),
    },
  );
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
    if (errorBody?.error === "no GSAP script found in file") {
      return { content: null };
    }
    throw new Error(errorBody?.error ?? `GSAP animation split failed (${response.status})`);
  }
  const data = (await response.json()) as {
    ok?: boolean;
    after?: string;
    version?: string;
    skippedSelectors?: string[];
  };
  return {
    content: data.ok && data.after ? data.after : null,
    version: data.version ?? response.headers.get("etag") ?? undefined,
    skippedSelectors: data.skippedSelectors,
  };
}

function getOriginalContent(originals: ReadonlyMap<string, string>, path: string): string {
  const original = originals.get(path);
  if (original === undefined) {
    throw new Error(`Missing original contents for ${path}`);
  }
  return original;
}

async function restoreFilesToOriginal(
  originals: ReadonlyMap<string, string>,
  snapshots: ReadonlyMap<string, { before: string; after: string }>,
  writeProjectFile: (path: string, content: string, expectedContent?: string) => Promise<void>,
): Promise<void> {
  for (const [path, snapshot] of snapshots) {
    await writeProjectFile(path, getOriginalContent(originals, path), snapshot.after);
  }
}

async function readOriginalFiles(
  pid: string,
  elements: TimelineElement[],
  activeCompPath: string | null,
): Promise<Map<string, string>> {
  const originals = new Map<string, string>();
  for (const element of elements) {
    const path = element.sourceFile || activeCompPath || "index.html";
    if (!originals.has(path)) {
      originals.set(path, await readFileContent(pid, path));
    }
  }
  return originals;
}

async function splitElementsAtTime(
  pid: string,
  elements: TimelineElement[],
  splitTime: number,
  activeCompPath: string | null,
  originals: ReadonlyMap<string, string>,
  snapshots: Map<string, { before: string; after: string }>,
  writeProjectFile: (path: string, content: string, expectedContent?: string) => Promise<void>,
  observeProjectFileVersion?: (path: string, version: string | null) => void,
): Promise<number> {
  let count = 0;
  for (const element of elements) {
    const result = await executeSplit(
      pid,
      element,
      splitTime,
      activeCompPath,
      writeProjectFile,
      observeProjectFileVersion,
    );
    if (!result.changed) continue;
    snapshots.set(result.targetPath, {
      before: getOriginalContent(originals, result.targetPath),
      after: result.patchedContent,
    });
    await writeProjectFile(result.targetPath, result.patchedContent, result.patchedContent);
    count++;
  }
  return count;
}

// fallow-ignore-next-line complexity
async function executeSplit(
  pid: string,
  element: TimelineElement,
  splitTime: number,
  activeCompPath: string | null,
  writeProjectFile: (path: string, content: string, expectedContent?: string) => Promise<void>,
  observeProjectFileVersion?: (path: string, version: string | null) => void,
): Promise<{
  targetPath: string;
  originalContent: string;
  patchedContent: string;
  changed: boolean;
  skippedSelectors?: string[];
}> {
  const patchTarget = buildPatchTarget(element);
  if (!patchTarget) throw new Error("Clip is missing a patchable target.");

  const targetPath = element.sourceFile || activeCompPath || "index.html";
  const originalContent = await readFileContent(pid, targetPath);
  const newId = generateSplitId(collectHtmlIds(originalContent), element.domId || "clip");

  // An expanded sub-comp child arrives in MASTER-timeline coordinates — both its
  // `start` and the incoming `splitTime` are offset by the host's master start
  // (expandedParentStart) — but its `sourceFile` is the sub-comp, whose clips are
  // authored in LOCAL time. Rebase both onto local time before the server patches
  // the file, exactly as TimelinePane.handleSplitElement does for non-razor edits.
  // Root-level clips (no expandedParentStart) are already local, so pass through.
  const basis = element.expandedParentStart;
  const localSplitTime = basis === undefined ? splitTime : Math.max(0, splitTime - basis);
  const localElementStart = basis === undefined ? element.start : element.start - basis;

  const splitResult = await splitHtmlElement(
    pid,
    targetPath,
    patchTarget,
    localSplitTime,
    newId,
    localElementStart,
    element.duration,
  );
  if (!splitResult.ok) throw new Error("Failed to split clip.");
  if (!splitResult.changed) {
    return { targetPath, originalContent, patchedContent: originalContent, changed: false };
  }
  observeProjectFileVersion?.(targetPath, splitResult.version);

  let patchedContent =
    typeof splitResult.content === "string" ? splitResult.content : originalContent;

  let skippedSelectors: string[] | undefined;
  if (element.domId) {
    try {
      const gsapResult = await splitGsapAnimations(
        pid,
        targetPath,
        element.domId,
        newId,
        localSplitTime,
        localElementStart,
        element.duration,
      );
      if (gsapResult.content) patchedContent = gsapResult.content;
      if (gsapResult.version) observeProjectFileVersion?.(targetPath, gsapResult.version);
      if (gsapResult.skippedSelectors?.length) skippedSelectors = gsapResult.skippedSelectors;
    } catch (gsapError) {
      // GSAP mutation failed — the HTML split already wrote to disk.
      // Restore the original content to avoid a corrupt half-split state.
      await writeProjectFile(targetPath, originalContent, patchedContent);
      throw gsapError;
    }
  }

  return { targetPath, originalContent, patchedContent, changed: true, skippedSelectors };
}

export function useRazorSplit({
  projectId,
  activeCompPath,
  showToast,
  writeProjectFile,
  observeProjectFileVersion,
  recordEdit,
  domEditSaveTimestampRef,
  reloadPreview,
  forceReloadSdkSession,
  isRecordingRef,
}: UseRazorSplitOptions) {
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const handleRazorSplit = useCallback(
    // fallow-ignore-next-line complexity
    async (element: TimelineElement, splitTime: number) => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return;
      }

      const pid = projectIdRef.current;
      if (!pid || !canSplitElementAt(element, splitTime)) return;

      try {
        const { targetPath, originalContent, patchedContent, changed, skippedSelectors } =
          await executeSplit(
            pid,
            element,
            splitTime,
            activeCompPath,
            writeProjectFile,
            observeProjectFileVersion,
          );

        if (!changed) {
          showToast("Failed to split clip — playhead may be outside the clip", "error");
          return;
        }

        domEditSaveTimestampRef.current = Date.now();
        await saveProjectFilesWithHistory({
          projectId: pid,
          label: "Split timeline clip",
          kind: "timeline",
          files: { [targetPath]: patchedContent },
          readFile: async () => originalContent,
          writeFile: writeProjectFile,
          recordEdit,
        });

        // Server writes bypass the SDK session, so reopen it before refreshing
        // the preview. The split response already owns the final persisted bytes.
        forceReloadSdkSession?.();
        reloadPreview();
        trackStudioRazorSplit({ mode: "single", count: 1 });
        showToast(`Split ${getTimelineElementLabel(element)} at ${splitTime.toFixed(2)}s`, "info");
        if (skippedSelectors?.length) {
          showToast(
            `Some animations use non-ID selectors (${skippedSelectors.join(", ")}) and were not retargeted`,
            "info",
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to split timeline clip";
        showToast(message, "error");
      }
    },
    [
      activeCompPath,
      recordEdit,
      showToast,
      writeProjectFile,
      observeProjectFileVersion,
      domEditSaveTimestampRef,
      reloadPreview,
      forceReloadSdkSession,
      isRecordingRef,
    ],
  );

  const handleRazorSplitAll = useCallback(
    // fallow-ignore-next-line complexity
    async (splitTime: number) => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return;
      }

      const pid = projectIdRef.current;
      if (!pid) return;
      const { elements } = usePlayerStore.getState();
      const splittable = selectSplittableElements(elements, splitTime);
      if (splittable.length === 0) return;

      let originals = new Map<string, string>();
      const finalSnapshots = new Map<string, { before: string; after: string }>();
      try {
        originals = await readOriginalFiles(pid, splittable, activeCompPath);
        const splitCount = await splitElementsAtTime(
          pid,
          splittable,
          splitTime,
          activeCompPath,
          originals,
          finalSnapshots,
          writeProjectFile,
          observeProjectFileVersion,
        );
        if (splitCount === 0) return;

        domEditSaveTimestampRef.current = Date.now();
        await recordEdit({
          label: `Split ${splitCount} clips at ${splitTime.toFixed(2)}s`,
          kind: "timeline",
          files: Object.fromEntries(finalSnapshots),
        });

        // Resync the stale SDK doc after the batched server write (see the
        // single-split path above for why this precedes the reload).
        forceReloadSdkSession?.();
        reloadPreview();
        trackStudioRazorSplit({ mode: "all", count: splitCount });
        showToast(`Split ${splitCount} clips at ${splitTime.toFixed(2)}s`, "info");
      } catch (error) {
        // Best-effort rollback — a failing restore write must not swallow the
        // original error's toast, which is what tells the user the split failed.
        try {
          await restoreFilesToOriginal(originals, finalSnapshots, writeProjectFile);
        } catch {
          /* leave disk as-is; the original failure is reported below */
        }
        const message = error instanceof Error ? error.message : "Failed to split clips";
        showToast(message, "error");
      }
    },
    [
      activeCompPath,
      recordEdit,
      showToast,
      writeProjectFile,
      observeProjectFileVersion,
      domEditSaveTimestampRef,
      reloadPreview,
      forceReloadSdkSession,
      isRecordingRef,
    ],
  );

  return { handleRazorSplit, handleRazorSplitAll };
}
