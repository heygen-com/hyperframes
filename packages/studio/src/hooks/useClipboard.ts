import { useCallback, useRef } from "react";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
import type { DomEditSelection } from "../components/editor/domEditing";
import { type ClipboardPayload, deduplicateIds, insertAsSibling } from "../utils/clipboardPayload";
import { collectHtmlIds } from "../utils/studioHelpers";
import { insertTimelineAssetIntoSource } from "../utils/timelineAssetDrop";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import type { EditHistoryKind } from "../utils/editHistory";
import { formatTimelineAttributeNumber } from "../player/components/timelineEditing";

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
  domEditSaveTimestampRef: React.MutableRefObject<number>;
  reloadPreview: () => void;
  handleTimelineElementDelete: (element: TimelineElement) => Promise<void>;
  handleDomEditElementDelete: (selection: DomEditSelection) => Promise<void>;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
}

async function readFileContent(projectId: string, targetPath: string): Promise<string> {
  const response = await fetch(
    `/api/projects/${projectId}/files/${encodeURIComponent(targetPath)}`,
  );
  if (!response.ok) throw new Error(`Failed to read ${targetPath}`);
  const data = (await response.json()) as { content?: string };
  if (typeof data.content !== "string") throw new Error(`Missing file contents for ${targetPath}`);
  return data.content;
}

function getElementOuterHtml(
  iframeRef: React.MutableRefObject<HTMLIFrameElement | null>,
  selection: DomEditSelection,
): string | null {
  let doc: Document | null = null;
  try {
    doc = iframeRef.current?.contentDocument ?? null;
  } catch {
    return null;
  }
  if (!doc) return null;

  let el: Element | null = null;
  if (selection.id) {
    el = doc.getElementById(selection.id);
  }
  if (!el && selection.selector) {
    const matches = doc.querySelectorAll(selection.selector);
    el = matches[selection.selectorIndex ?? 0] ?? null;
  }
  return el && "outerHTML" in el ? (el as Element).outerHTML : null;
}

export function useClipboard({
  projectId,
  activeCompPath,
  domEditSelectionRef,
  showToast,
  writeProjectFile,
  recordEdit,
  domEditSaveTimestampRef,
  reloadPreview,
  handleTimelineElementDelete,
  handleDomEditElementDelete,
  previewIframeRef,
}: UseClipboardOptions) {
  const clipboardRef = useRef<ClipboardPayload | null>(null);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const handleCopy = useCallback((): boolean => {
    const { selectedElementId, elements } = usePlayerStore.getState();

    // Timeline clip copy
    if (selectedElementId) {
      const element = elements.find((el) => (el.key ?? el.id) === selectedElementId);
      if (!element) return false;
      const targetPath = element.sourceFile || activeCompPath || "index.html";

      let html: string | null = null;
      try {
        const doc = previewIframeRef.current?.contentDocument;
        if (doc) {
          let el: Element | null = null;
          if (element.domId) el = doc.getElementById(element.domId);
          if (!el && element.selector) {
            const matches = doc.querySelectorAll(element.selector);
            el = matches[element.selectorIndex ?? 0] ?? null;
          }
          if (el && "outerHTML" in el) html = (el as Element).outerHTML;
        }
      } catch {
        // cross-origin frame
      }

      if (!html) {
        showToast("Unable to copy this element.", "info");
        return false;
      }

      const payload: ClipboardPayload = { kind: "timeline-clip", html, sourceFile: targetPath };
      clipboardRef.current = payload;
      showToast("Copied clip", "info");
      return true;
    }

    // DOM element copy
    const domSelection = domEditSelectionRef.current;
    if (domSelection) {
      const html = getElementOuterHtml(previewIframeRef, domSelection);
      if (!html) {
        showToast("Unable to copy this element.", "info");
        return false;
      }
      const targetPath = domSelection.sourceFile || activeCompPath || "index.html";
      const payload: ClipboardPayload = {
        kind: "dom-element",
        html,
        sourceFile: targetPath,
        originSelector: domSelection.selector,
        originSelectorIndex: domSelection.selectorIndex,
      };
      clipboardRef.current = payload;
      showToast("Copied element", "info");
      return true;
    }

    return false;
  }, [activeCompPath, domEditSelectionRef, previewIframeRef, showToast]);

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
      const existingIds = collectHtmlIds(originalContent);
      const deduped = deduplicateIds(payload.html, existingIds);

      let patchedContent: string;
      if (payload.kind === "timeline-clip") {
        // Only rewrite data-start on the outermost opening tag. The non-global
        // regex matches the first occurrence, which is always in the root tag
        // since outerHTML starts with it. Nested clips keep their own timing.
        const { currentTime } = usePlayerStore.getState();
        const rootTagEnd = deduped.indexOf(">");
        const rootTag = rootTagEnd >= 0 ? deduped.slice(0, rootTagEnd + 1) : deduped;
        const patchedRootTag = rootTag.replace(
          /data-start="[^"]*"/,
          `data-start="${formatTimelineAttributeNumber(currentTime)}"`,
        );
        const withNewStart = patchedRootTag + deduped.slice(rootTagEnd + 1);
        patchedContent = insertTimelineAssetIntoSource(originalContent, withNewStart);
      } else {
        patchedContent = insertAsSibling(
          originalContent,
          deduped,
          payload.originSelector,
          payload.originSelectorIndex,
        );
      }

      domEditSaveTimestampRef.current = Date.now();
      await saveProjectFilesWithHistory({
        projectId: pid,
        label: payload.kind === "timeline-clip" ? "Paste clip" : "Paste element",
        kind: "timeline" as EditHistoryKind,
        files: { [targetPath]: patchedContent },
        readFile: async () => originalContent,
        writeFile: writeProjectFile,
        recordEdit,
      });

      reloadPreview();
      showToast(payload.kind === "timeline-clip" ? "Pasted clip" : "Pasted element", "info");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to paste";
      showToast(message);
    }
  }, [
    activeCompPath,
    domEditSaveTimestampRef,
    recordEdit,
    reloadPreview,
    showToast,
    writeProjectFile,
  ]);

  const handleCut = useCallback(async (): Promise<boolean> => {
    const copied = handleCopy();
    if (!copied) return false;

    const { selectedElementId, elements } = usePlayerStore.getState();
    if (selectedElementId) {
      const element = elements.find((el) => (el.key ?? el.id) === selectedElementId);
      if (element) {
        await handleTimelineElementDelete(element);
        return true;
      }
    }

    const domSelection = domEditSelectionRef.current;
    if (domSelection) {
      await handleDomEditElementDelete(domSelection);
      return true;
    }
    return true;
  }, [handleCopy, domEditSelectionRef, handleTimelineElementDelete, handleDomEditElementDelete]);

  return { handleCopy, handlePaste, handleCut };
}
