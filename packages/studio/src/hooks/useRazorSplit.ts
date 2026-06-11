import { useCallback, useRef } from "react";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import { getTimelineElementLabel, collectHtmlIds } from "../utils/studioHelpers";
import {
  canSplitElement,
  buildPatchTarget,
  readFileContent,
  isSplitTimeWithinBounds,
} from "../utils/timelineElementSplit";
import type { RecordEditInput } from "./useTimelineEditing";

interface UseRazorSplitOptions {
  projectId: string | null;
  activeCompPath: string | null;
  showToast: (message: string, tone?: "error" | "info") => void;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  domEditSaveTimestampRef: React.MutableRefObject<number>;
  reloadPreview: () => void;
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
): Promise<{ ok: boolean; changed?: boolean; content?: string }> {
  const response = await fetch(
    `/api/projects/${projectId}/file-mutations/split-element/${encodeURIComponent(targetPath)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: patchTarget, splitTime, newId }),
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

  const splitResult = await splitHtmlElement(pid, targetPath, patchTarget, splitTime, newId);
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
        splitTime,
        element.start,
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
      if (!pid || !canSplitElement(element)) return;

      if (!isSplitTimeWithinBounds(splitTime, element.start, element.duration)) {
        return;
      }

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

        reloadPreview();
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
      const splittable = elements.filter(
        (el) => canSplitElement(el) && splitTime > el.start && splitTime < el.start + el.duration,
      );
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

        reloadPreview();
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
      isRecordingRef,
    ],
  );

  return { handleRazorSplit, handleRazorSplitAll };
}
