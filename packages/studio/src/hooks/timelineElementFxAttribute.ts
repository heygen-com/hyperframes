/**
 * C1's clip-level FX write: persist one attribute directly on a specific
 * timeline clip, addressed by the clip itself rather than the current
 * selection — so applying a preset from the timeline FX popover doesn't
 * depend on that clip already being selected in the property panel.
 * Built on `persistElementAttribute` (`timelineEditingHelpers.ts`), the
 * shared core `setAudioGroupAttribute` also uses.
 */

import { useCallback } from "react";
import type { TimelineElement } from "../player";
import {
  buildPatchTarget,
  findTimelineElementInIframe,
  persistElementAttribute,
} from "./timelineEditingHelpers";
import type {
  MutableRef,
  UseTimelineElementVisibilityEditingInput,
} from "./timelineTrackVisibility";

function patchLiveElementAttribute(
  iframe: HTMLIFrameElement | null,
  element: TimelineElement,
  attr: string,
  value: string | null,
  activeCompPath: string | null,
): void {
  const target = findTimelineElementInIframe(iframe, element, activeCompPath);
  if (!target) return;
  if (value === null) target.removeAttribute(attr);
  else target.setAttribute(attr, value);
}

interface SetElementAttributeInput {
  projectId: string;
  activeCompPath: string | null;
  element: TimelineElement;
  attr: string;
  value: string | null;
  label: string;
  previewIframe: HTMLIFrameElement | null;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  recordEdit: Parameters<typeof persistElementAttribute>[0]["recordEdit"];
  domEditSaveTimestampRef: MutableRef<number>;
  pendingTimelineEditPathRef: MutableRef<Set<string>>;
}

async function setElementAttribute({
  projectId,
  activeCompPath,
  element,
  attr,
  value,
  label,
  previewIframe,
  writeProjectFile,
  recordEdit,
  domEditSaveTimestampRef,
  pendingTimelineEditPathRef,
}: SetElementAttributeInput): Promise<string[]> {
  const targetPath = element.sourceFile || activeCompPath || "index.html";
  const patchTarget = buildPatchTarget(element);
  if (!patchTarget) return [];

  return persistElementAttribute({
    projectId,
    targetPath,
    patchTarget,
    attr,
    value,
    label,
    writeProjectFile,
    recordEdit,
    domEditSaveTimestampRef,
    pendingTimelineEditPathRef,
    patchLive: (v) => patchLiveElementAttribute(previewIframe, element, attr, v, activeCompPath),
    readLive: () =>
      findTimelineElementInIframe(previewIframe, element, activeCompPath)?.getAttribute(attr) ??
      null,
  });
}

export function useSetElementAttribute({
  projectIdRef,
  activeCompPath,
  showToast,
  writeProjectFile,
  recordEdit,
  domEditSaveTimestampRef,
  previewIframeRef,
  pendingTimelineEditPathRef,
  isRecordingRef,
}: UseTimelineElementVisibilityEditingInput): {
  setLive: (element: TimelineElement, attr: string, value: string | null) => void;
  setQuiet: (
    element: TimelineElement,
    attr: string,
    value: string | null,
    label: string,
  ) => Promise<void>;
} {
  const setLive = useCallback(
    (element: TimelineElement, attr: string, value: string | null) => {
      patchLiveElementAttribute(previewIframeRef.current, element, attr, value, activeCompPath);
    },
    [previewIframeRef, activeCompPath],
  );
  const setQuiet = useCallback(
    async (element: TimelineElement, attr: string, value: string | null, label: string) => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return;
      }
      const pid = projectIdRef.current;
      if (!pid) return;
      try {
        await setElementAttribute({
          projectId: pid,
          activeCompPath,
          element,
          attr,
          value,
          label,
          previewIframe: previewIframeRef.current,
          writeProjectFile,
          recordEdit,
          domEditSaveTimestampRef,
          pendingTimelineEditPathRef,
        });
      } catch (error) {
        console.error("[Timeline] Failed to set element attribute", error);
        const message = error instanceof Error ? error.message : "Failed to update effect";
        showToast(message);
      }
    },
    [
      activeCompPath,
      previewIframeRef,
      writeProjectFile,
      recordEdit,
      domEditSaveTimestampRef,
      pendingTimelineEditPathRef,
      isRecordingRef,
      showToast,
      projectIdRef,
    ],
  );
  return { setLive, setQuiet };
}
