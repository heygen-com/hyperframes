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
  writeProjectFile: (path: string, content: string) => Promise<void>;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  domEditSaveTimestampRef: React.MutableRefObject<number>;
  reloadPreview: () => void;
  /**
   * Resync the in-memory SDK session after the server-side split write (the
   * split-element / split-gsap endpoints write the file directly, so the SDK's
   * linkedom doc is now stale). Without this, a later SDK-routed edit serializes
   * the PRE-split doc and reverts the split on disk — the undo baseline recorded
   * here then no longer matches disk, so Cmd+Z trips the "changed externally"
   * guard. Every other server-side-write timeline path (move / resize / delete /
   * drop / visibility) already calls this; the split path was the sole omission.
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
): Promise<{ ok: boolean; changed?: boolean; content?: string }> {
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
  return (await response.json()) as { ok: boolean; changed?: boolean; content?: string };
}

async function splitGsapAnimations(
  projectId: string,
  targetPath: string,
  originalId: string,
  newId: string,
  splitTime: number,
  elementStart: number,
  elementDuration: number,
): Promise<{ content: string | null; skippedSelectors?: string[] }> {
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
    skippedSelectors?: string[];
  };
  return {
    content: data.ok && data.after ? data.after : null,
    skippedSelectors: data.skippedSelectors,
  };
}

// fallow-ignore-next-line complexity
async function executeSplit(
  pid: string,
  element: TimelineElement,
  splitTime: number,
  activeCompPath: string | null,
  writeProjectFile: (path: string, content: string) => Promise<void>,
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
      if (gsapResult.skippedSelectors?.length) skippedSelectors = gsapResult.skippedSelectors;
    } catch (gsapError) {
      // GSAP mutation failed — the HTML split already wrote to disk.
      // Restore the original content to avoid a corrupt half-split state.
      await writeProjectFile(targetPath, originalContent);
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
          await executeSplit(pid, element, splitTime, activeCompPath, writeProjectFile);

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

        // Server wrote the file; resync the stale in-memory SDK doc BEFORE the
        // reload so a later SDK-routed edit can't serialize the pre-split doc and
        // revert this split (which would desync disk from the undo baseline just
        // recorded → Cmd+Z reports "changed externally").
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
      domEditSaveTimestampRef,
      reloadPreview,
      forceReloadSdkSession,
      isRecordingRef,
    ],
  );

  // fallow-ignore-next-line complexity
  const handleRazorSplitAll = useCallback(
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

      try {
        const originals = new Map<string, string>();
        for (const el of splittable) {
          const path = el.sourceFile || activeCompPath || "index.html";
          if (!originals.has(path)) {
            originals.set(path, await readFileContent(pid, path));
          }
        }

        let splitCount = 0;
        const finalContent = new Map<string, string>();

        for (const element of splittable) {
          const result = await executeSplit(
            pid,
            element,
            splitTime,
            activeCompPath,
            writeProjectFile,
          );
          if (result.changed) {
            finalContent.set(result.targetPath, result.patchedContent);
            await writeProjectFile(result.targetPath, result.patchedContent);
            splitCount++;
          }
        }

        if (splitCount === 0) return;

        domEditSaveTimestampRef.current = Date.now();
        await recordEdit({
          label: `Split ${splitCount} clips at ${splitTime.toFixed(2)}s`,
          kind: "timeline",
          files: Object.fromEntries(
            [...finalContent].map(([path, after]) => [
              path,
              { before: originals.get(path) ?? "", after },
            ]),
          ),
        });

        // Resync the stale SDK doc after the batched server write (see the
        // single-split path above for why this precedes the reload).
        forceReloadSdkSession?.();
        reloadPreview();
        trackStudioRazorSplit({ mode: "all", count: splitCount });
        showToast(`Split ${splitCount} clips at ${splitTime.toFixed(2)}s`, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to split clips";
        showToast(message, "error");
      }
    },
    [
      activeCompPath,
      recordEdit,
      showToast,
      writeProjectFile,
      domEditSaveTimestampRef,
      reloadPreview,
      forceReloadSdkSession,
      isRecordingRef,
    ],
  );

  return { handleRazorSplit, handleRazorSplitAll };
}
