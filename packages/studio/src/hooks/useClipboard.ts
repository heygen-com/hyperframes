import { useCallback, useRef } from "react";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
import type { DomEditSelection } from "../components/editor/domEditing";
import {
  type ClipboardPayload,
  type TimelineClipboardClip,
  ID_ATTR_RE,
  deduplicateIds,
  insertAsSibling,
} from "../utils/clipboardPayload";
import { collectHtmlIds } from "../utils/studioHelpers";
import { insertTimelineAssetIntoSource } from "../utils/timelineAssetDrop";
import { extendRootDurationInSource } from "../utils/rootDuration";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import type { EditHistoryKind } from "../utils/editHistory";
import { formatTimelineAttributeNumber } from "../player/components/timelineEditing";
import { findElementForSelection } from "../components/editor/domEditingElement";
import { findTimelineElementInIframe, readFileContent } from "./timelineEditingHelpers";
import { buildTimelineElementKey } from "../player/lib/timelineElementHelpers";
import { timeRangesOverlap } from "../player/components/timelineCollision";

interface RecordEditInput {
  label: string;
  kind: EditHistoryKind;
  coalesceKey?: string;
  files: Record<string, { before: string; after: string }>;
}

interface UseClipboardOptions {
  projectId: string | null;
  activeCompPath: string | null;
  domEditSelectionRef: React.MutableRefObject<DomEditSelection | null>;
  showToast: (message: string, tone?: "error" | "info") => void;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  reloadPreview: () => void;
  handleTimelineElementsDelete: (elements: TimelineElement[]) => Promise<void>;
  handleDomEditElementDelete: (selection: DomEditSelection) => Promise<void>;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
}

/** The timeline element(s) a copy/cut/duplicate acts on: the multi-selection
 *  when one is active, else the single primary selection. */
function getSelectedElements(): TimelineElement[] {
  const { selectedElementId, selectedElementIds, elements } = usePlayerStore.getState();
  if (!selectedElementId) return [];
  const ids = selectedElementIds.size > 1 ? selectedElementIds : new Set([selectedElementId]);
  return elements.filter((el) => ids.has(el.key ?? el.id));
}

function elementKey(domId: string, sourceFile: string): string {
  return buildTimelineElementKey({ id: domId, fallbackIndex: 0, domId, sourceFile });
}

/** "Paste clip" / "Paste clips" — the edit-history label, no count shown. */
function clipLabel(verb: string, clipCount: number): string {
  return `${verb} ${clipCount > 1 ? "clips" : "clip"}`;
}

/** "Pasted clip" / "Pasted 3 clips" — the toast message, count shown once plural. */
function clipToast(verbPast: string, clipCount: number): string {
  return clipCount > 1 ? `${verbPast} ${clipCount} clips` : `${verbPast} clip`;
}

function getElementOuterHtml(
  iframeRef: React.MutableRefObject<HTMLIFrameElement | null>,
  selection: DomEditSelection,
  activeCompositionPath: string | null,
): string | null {
  let doc: Document | null = null;
  try {
    doc = iframeRef.current?.contentDocument ?? null;
  } catch {
    return null;
  }
  if (!doc) return null;

  return findElementForSelection(doc, selection, activeCompositionPath)?.outerHTML ?? null;
}

export interface PlacedClip {
  track: number;
  start: number;
  duration: number;
}

function tracksOverlap(a: PlacedClip, b: PlacedClip): boolean {
  return (
    a.track === b.track &&
    timeRangesOverlap(a.start, a.start + a.duration, b.start, b.start + b.duration)
  );
}

/** CapCut: keeps the preferred track if free at the new time, else the next
 *  unused track index. Exported so placement is tested with values directly. */
export function resolveFreeTrack(preferred: PlacedClip, taken: readonly PlacedClip[]): number {
  if (!taken.some((t) => tracksOverlap(preferred, t))) return preferred.track;
  const maxTrack = taken.reduce((max, t) => Math.max(max, t.track), preferred.track);
  return maxTrack + 1;
}

/** Strips data-hf-id from the root and every descendant so a clone re-mints
 *  its own. DOMParser, not a bracket-scoped regex, so a `>` inside an earlier
 *  attribute value or a single-quoted id can't defeat the strip. */
function stripHfIds(html: string, parser: DOMParser): string {
  const root = parser.parseFromString(html, "text/html").body.firstElementChild;
  if (!root) {
    // A tag the HTML parser hoists out of <body> (title/meta/style/base/link)
    // never reaches the walk above — fall back to a direct strip so
    // data-hf-id still can't survive, even though no real clip root is one
    // of these tags today.
    return html.replace(/\sdata-hf-id=("[^"]*"|'[^']*')/g, "");
  }
  root.querySelectorAll("[data-hf-id]").forEach((el) => el.removeAttribute("data-hf-id"));
  root.removeAttribute("data-hf-id");
  return root.outerHTML;
}

/** Shared insertion path for paste and duplicate, anchored at the playhead or
 *  the selection's end respectively. Returns the final ids so the caller can
 *  select what it just placed, and the furthest end any clip lands at so the
 *  caller can grow the root composition's duration to cover it. */
export function pasteTimelineClips(
  content: string,
  clips: readonly TimelineClipboardClip[],
  anchorTime: number,
  liveElements: readonly TimelineElement[],
): { content: string; ids: string[]; requiredEnd: number } {
  const groupMinStart = Math.min(...clips.map((c) => c.start));
  let existingIds = collectHtmlIds(content);
  const taken: PlacedClip[] = liveElements.map((el) => ({
    track: el.authoredTrack ?? el.track,
    start: el.start,
    duration: el.duration,
  }));
  const ids: string[] = [];
  let result = content;
  let requiredEnd = 0;
  const domParser = new DOMParser();
  for (const clip of clips) {
    const stripped = stripHfIds(clip.html, domParser);
    const deduped = deduplicateIds(stripped, existingIds);
    existingIds = existingIds.concat(collectHtmlIds(deduped));
    const newStart = anchorTime + (clip.start - groupMinStart);
    const newTrack = resolveFreeTrack(
      { track: clip.track, start: newStart, duration: clip.duration },
      taken,
    );
    taken.push({ track: newTrack, start: newStart, duration: clip.duration });
    requiredEnd = Math.max(requiredEnd, newStart + clip.duration);

    // Only rewrite the outermost opening tag. The non-global regex matches
    // the first occurrence, which is always in the root tag since outerHTML
    // starts with it. Nested clips keep their own timing and track.
    const rootTagEnd = deduped.indexOf(">");
    const rootTag = rootTagEnd >= 0 ? deduped.slice(0, rootTagEnd + 1) : deduped;
    const patchedRootTag = rootTag
      .replace(/data-start="[^"]*"/, `data-start="${formatTimelineAttributeNumber(newStart)}"`)
      .replace(/data-track-index="[^"]*"/, `data-track-index="${newTrack}"`);
    const withPatched = patchedRootTag + deduped.slice(rootTagEnd + 1);
    result = insertTimelineAssetIntoSource(result, withPatched);

    const id = patchedRootTag.match(ID_ATTR_RE)?.[1];
    if (id) ids.push(id);
  }
  return { content: result, ids, requiredEnd };
}

export function useClipboard({
  projectId,
  activeCompPath,
  domEditSelectionRef,
  showToast,
  writeProjectFile,
  recordEdit,
  reloadPreview,
  handleTimelineElementsDelete,
  handleDomEditElementDelete,
  previewIframeRef,
}: UseClipboardOptions) {
  const clipboardRef = useRef<ClipboardPayload | null>(null);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  // Resolved through findTimelineElementInIframe, the same composition-aware
  // lookup every other timeline editor uses — unlike findElementForSelection,
  // it can address a composition-instance clip's root.
  const collectSelectedClips = useCallback((): {
    elements: TimelineElement[];
    clips: TimelineClipboardClip[];
  } | null => {
    const selected = getSelectedElements();
    if (selected.length === 0) return null;

    const clips: TimelineClipboardClip[] = [];
    for (const element of selected) {
      const html =
        findTimelineElementInIframe(previewIframeRef.current, element, activeCompPath)?.outerHTML ??
        null;
      if (!html) {
        showToast(`Unable to copy "${element.label ?? element.id}".`, "info");
        return null;
      }
      clips.push({
        html,
        start: element.start,
        duration: element.duration,
        // authoredTrack, not track: `track` can be a display-lane number
        // remapped by normalizeToZones, and writing THAT into data-track-index
        // re-targets the wrong track in the sparse authored file.
        track: element.authoredTrack ?? element.track,
      });
    }
    return { elements: selected, clips };
  }, [activeCompPath, previewIframeRef, showToast]);

  // Two independent copy modes (timeline clip vs DOM element) in one handler.
  // fallow-ignore-next-line complexity
  const handleCopy = useCallback((): boolean => {
    if (usePlayerStore.getState().selectedElementId) {
      const result = collectSelectedClips();
      if (!result) return false;
      const targetPath = result.elements[0]?.sourceFile || activeCompPath || "index.html";
      clipboardRef.current = { kind: "timeline-clip", clips: result.clips, sourceFile: targetPath };
      showToast(
        result.clips.length > 1 ? `Copied ${result.clips.length} clips` : "Copied clip",
        "info",
      );
      return true;
    }

    // DOM element copy
    const domSelection = domEditSelectionRef.current;
    if (domSelection) {
      const html = getElementOuterHtml(previewIframeRef, domSelection, activeCompPath);
      if (!html) {
        showToast("Unable to copy this element.", "info");
        return false;
      }
      const targetPath = domSelection.sourceFile || activeCompPath || "index.html";
      clipboardRef.current = {
        kind: "dom-element",
        html,
        sourceFile: targetPath,
        originSelector: domSelection.selector,
        originSelectorIndex: domSelection.selectorIndex,
      };
      showToast("Copied element", "info");
      return true;
    }

    showToast("Nothing selected to copy.", "info");
    return false;
  }, [activeCompPath, collectSelectedClips, domEditSelectionRef, previewIframeRef, showToast]);

  // Two independent paste modes (timeline clip vs DOM element) behind one guarded save.
  // fallow-ignore-next-line complexity
  const handlePaste = useCallback(async () => {
    const payload = clipboardRef.current;
    if (!payload) {
      showToast("Nothing to paste.", "info");
      return;
    }
    const pid = projectIdRef.current;
    if (!pid) return;

    const targetPath = activeCompPath || "index.html";
    try {
      const originalContent = await readFileContent(pid, targetPath);
      let patchedContent: string;
      let pastedIds: string[] = [];

      if (payload.kind === "timeline-clip") {
        const { currentTime, elements } = usePlayerStore.getState();
        const pasted = pasteTimelineClips(originalContent, payload.clips, currentTime, elements);
        // A clip pasted past the current composition end would exist in the
        // file but never appear on the timeline or in playback/export (the
        // root's data-duration is what actually bounds the render).
        patchedContent = extendRootDurationInSource(pasted.content, pasted.requiredEnd);
        pastedIds = pasted.ids;
      } else {
        const deduped = deduplicateIds(payload.html, collectHtmlIds(originalContent));
        patchedContent = insertAsSibling(
          originalContent,
          deduped,
          payload.originSelector,
          payload.originSelectorIndex,
        );
      }

      const label =
        payload.kind === "timeline-clip"
          ? clipLabel("Paste", payload.clips.length)
          : "Paste element";

      await saveProjectFilesWithHistory({
        projectId: pid,
        label,
        kind: "timeline" as EditHistoryKind,
        files: { [targetPath]: patchedContent },
        readFile: async () => originalContent,
        writeFile: writeProjectFile,
        recordEdit,
      });

      // CapCut: the pasted clip(s) become the selection; the playhead does not
      // move. reloadPreview is a bare refresh-key bump with no selection
      // snapshot of its own; calling setSelection before it is what makes the
      // post-reload store state land on the pasted ids instead of stale ones.
      if (pastedIds.length > 0) {
        usePlayerStore.getState().setSelection(pastedIds.map((id) => elementKey(id, targetPath)));
      }
      reloadPreview();
      showToast(
        payload.kind === "timeline-clip"
          ? clipToast("Pasted", payload.clips.length)
          : "Pasted element",
        "info",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to paste";
      showToast(message);
    }
  }, [activeCompPath, recordEdit, reloadPreview, showToast, writeProjectFile]);

  // Duplicates the current selection in place, immediately after it, without
  // touching the clipboard — a pending copy must survive a Cmd+D. Shares
  // pasteTimelineClips with handlePaste; only the anchor and clip source
  // differ (the selection's own end here, the playhead there).
  const handleDuplicate = useCallback(async (): Promise<boolean> => {
    const result = collectSelectedClips();
    if (!result) return false;
    const pid = projectIdRef.current;
    if (!pid) return false;

    const { elements, clips } = result;
    const targetPath = elements[0]?.sourceFile || activeCompPath || "index.html";
    const anchorTime = Math.max(...elements.map((el) => el.start + el.duration));

    try {
      const originalContent = await readFileContent(pid, targetPath);
      const liveElements = usePlayerStore.getState().elements;
      const pasted = pasteTimelineClips(originalContent, clips, anchorTime, liveElements);
      const patchedContent = extendRootDurationInSource(pasted.content, pasted.requiredEnd);
      const ids = pasted.ids;

      await saveProjectFilesWithHistory({
        projectId: pid,
        label: clipLabel("Duplicate", clips.length),
        kind: "timeline" as EditHistoryKind,
        files: { [targetPath]: patchedContent },
        readFile: async () => originalContent,
        writeFile: writeProjectFile,
        recordEdit,
      });

      // The duplicate becomes the selection, mirroring CapCut's own paste
      // convention — there is no CapCut Duplicate to match directly (Cmd+D is
      // a no-op there); this is our own choice for consistency with paste.
      // Select before reloading, same reason as handlePaste above.
      if (ids.length > 0) {
        usePlayerStore.getState().setSelection(ids.map((id) => elementKey(id, targetPath)));
      }
      reloadPreview();
      showToast(clipToast("Duplicated", clips.length), "info");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to duplicate";
      showToast(message);
      return false;
    }
  }, [
    activeCompPath,
    collectSelectedClips,
    recordEdit,
    reloadPreview,
    showToast,
    writeProjectFile,
  ]);

  const handleCut = useCallback(async (): Promise<boolean> => {
    const selected = getSelectedElements();
    const copied = handleCopy();
    if (!copied) return false;

    if (selected.length > 0) {
      // One call for the whole selection, not one per element: the batched
      // delete writes and records history once, so a multi-clip Cmd+X undoes
      // in a single Cmd+Z instead of needing one per clip.
      await handleTimelineElementsDelete(selected);
      return true;
    }

    const domSelection = domEditSelectionRef.current;
    if (domSelection) {
      await handleDomEditElementDelete(domSelection);
      return true;
    }
    return true;
  }, [handleCopy, domEditSelectionRef, handleTimelineElementsDelete, handleDomEditElementDelete]);

  const canPaste = useCallback(() => clipboardRef.current !== null, []);

  return { handleCopy, handlePaste, handleCut, handleDuplicate, canPaste };
}
