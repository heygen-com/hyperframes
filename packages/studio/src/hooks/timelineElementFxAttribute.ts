/**
 * C1's clip-level FX write: persist one attribute directly on a specific
 * timeline clip, addressed by the clip itself rather than the current
 * selection — so applying a preset from the timeline FX popover doesn't
 * depend on that clip already being selected in the property panel.
 * Built on `persistElementAttribute` (`timelineEditingHelpers.ts`), the
 * shared core `setAudioGroupAttribute` also uses.
 */

import { useCallback, useRef } from "react";
import type { TimelineElement } from "../player";
import {
  buildPatchTarget,
  findTimelineElementInIframe,
  persistElementAttribute,
  claimLiveBefore,
  readSavedAttribute,
} from "./timelineEditingHelpers";
import type {
  MutableRef,
  UseTimelineElementVisibilityEditingInput,
} from "./timelineTrackVisibility";
import {
  failedTimelineSave,
  projectForTimelineSave,
  type TimelineEditOutcome,
} from "./timelineEditPermission";
import { syncStoredAutomationFromPreview } from "../player/lib/automationStoreSync";

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

function elementAttributeLiveKey(
  element: TimelineElement,
  activeCompPath: string | null,
  attr: string,
): string {
  return `${element.sourceFile || activeCompPath || "index.html"}\0${element.key ?? element.domId ?? element.id}\0${attr}`;
}

function elementSaveTarget(element: TimelineElement, activeCompPath: string | null) {
  return {
    targetPath: element.sourceFile || activeCompPath || "index.html",
    patchTarget: buildPatchTarget(element),
  };
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
  pendingTimelineEditPathRef,
}: SetElementAttributeInput): Promise<string[] | null> {
  const { targetPath, patchTarget } = elementSaveTarget(element, activeCompPath);
  if (!patchTarget) return null;

  return persistElementAttribute({
    projectId,
    targetPath,
    patchTarget,
    attr,
    value,
    label,
    writeProjectFile,
    recordEdit,
    pendingTimelineEditPathRef,
    patchLive: (v) => patchLiveElementAttribute(previewIframe, element, attr, v, activeCompPath),
  });
}

export function useSetElementAttribute({
  projectIdRef,
  activeCompPath,
  showToast,
  writeProjectFile,
  recordEdit,
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
  ) => Promise<TimelineEditOutcome>;
  revertLive: (element: TimelineElement, attr: string) => void;
} {
  const liveBeforeRef = useRef(new Map<string, string | null>());
  const setLive = useCallback(
    (element: TimelineElement, attr: string, value: string | null) => {
      const key = elementAttributeLiveKey(element, activeCompPath, attr);
      const target = findTimelineElementInIframe(previewIframeRef.current, element, activeCompPath);
      if (!liveBeforeRef.current.has(key)) {
        liveBeforeRef.current.set(key, target?.getAttribute(attr) ?? null);
      }
      patchLiveElementAttribute(previewIframeRef.current, element, attr, value, activeCompPath);
    },
    [previewIframeRef, activeCompPath],
  );
  const claimLive = useCallback(
    (element: TimelineElement, attr: string) =>
      claimLiveBefore(
        liveBeforeRef.current,
        elementAttributeLiveKey(element, activeCompPath, attr),
        (value) => {
          patchLiveElementAttribute(previewIframeRef.current, element, attr, value, activeCompPath);
          syncStoredAutomationFromPreview(previewIframeRef.current?.contentDocument);
        },
      ),
    [previewIframeRef, activeCompPath],
  );
  const revertLive = useCallback(
    (element: TimelineElement, attr: string) => claimLive(element, attr)(),
    [claimLive],
  );
  const setQuiet = useCallback(
    async (
      element: TimelineElement,
      attr: string,
      value: string | null,
      label: string,
    ): Promise<TimelineEditOutcome> => {
      const pid = projectForTimelineSave(isRecordingRef?.current, projectIdRef.current, showToast);
      const settleLive = claimLive(element, attr);
      const unsaved = async (outcome: TimelineEditOutcome): Promise<TimelineEditOutcome> => {
        const { targetPath, patchTarget } = elementSaveTarget(element, activeCompPath);
        settleLive(await readSavedAttribute(projectIdRef.current, targetPath, patchTarget, attr));
        return outcome;
      };
      if (typeof pid !== "string") return unsaved(pid);
      try {
        const written = await setElementAttribute({
          projectId: pid,
          activeCompPath,
          element,
          attr,
          value,
          label,
          previewIframe: previewIframeRef.current,
          writeProjectFile,
          recordEdit,
          pendingTimelineEditPathRef,
        });
        if (!written)
          return unsaved(failedTimelineSave("This clip has no id to save it by", showToast));
        syncStoredAutomationFromPreview(previewIframeRef.current?.contentDocument);
        return { status: "saved" };
      } catch (error) {
        console.error("[Timeline] Failed to set element attribute", error);
        const message = error instanceof Error ? error.message : "Failed to update effect";
        return unsaved(failedTimelineSave(message, showToast));
      }
    },
    [
      claimLive,
      activeCompPath,
      previewIframeRef,
      writeProjectFile,
      recordEdit,
      pendingTimelineEditPathRef,
      isRecordingRef,
      showToast,
      projectIdRef,
    ],
  );
  return { setLive, setQuiet, revertLive };
}
