import { useCallback, useRef } from "react";
import { WEB_CAPTURE_CUSTOM_MIME, WEB_CAPTURE_ROUTE_PREFIX } from "@hyperframes/core/web-capture";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
import type { DomEditSelection } from "../components/editor/domEditing";
import {
  type ClipboardPayload,
  deduplicateIds,
  insertAsSibling,
  isLegacyClipboardText,
} from "../utils/clipboardPayload";
import { collectHtmlIds } from "../utils/studioHelpers";
import { insertTimelineAssetIntoSource } from "../utils/timelineAssetDrop";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import type { EditHistoryKind } from "../utils/editHistory";
import { formatTimelineAttributeNumber } from "../player/components/timelineEditing";
import { findElementForSelection } from "../components/editor/domEditingElement";
import {
  createInternalClipboardTokenStore,
  isInternalClipboardText,
} from "../utils/internalClipboardToken";
import { materializeWebCaptureImageResource } from "../utils/webCaptureImageMaterializer";
import {
  planWebCaptureImport,
  type WebCaptureImportIdentity,
  type WebCaptureImportRejection,
} from "../utils/webCaptureImport";
import { generateId } from "../utils/generateId";
import { commitTimelineCompositionInsertion } from "../utils/timelineCompositionInsert";
import { deleteProjectFile } from "../utils/projectFileDelete";
import { readFileContent } from "./timelineEditingHelpers";

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
  observeProjectFileVersion?: (path: string, version: string | null) => void;
  refreshFileTree: () => Promise<void>;
  forceReloadSdkSession?: () => void;
  domEditSaveTimestampRef: React.MutableRefObject<number>;
  reloadPreview: () => void;
  handleTimelineElementDelete: (element: TimelineElement) => Promise<void>;
  handleDomEditElementDelete: (selection: DomEditSelection) => Promise<void>;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
}

interface ClipboardTargetSnapshot {
  projectId: string;
  targetPath: string;
  playhead: number;
}

interface ClipboardTextSnapshot {
  text: string;
  customMimeText?: string;
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

function readClipboardData(data: DataTransfer, type: string): string {
  try {
    return data.getData(type);
  } catch {
    return "";
  }
}

function snapshotExternalCapture(data: DataTransfer): ClipboardTextSnapshot | null {
  const text = readClipboardData(data, "text/plain");
  const customMimeText = readClipboardData(data, WEB_CAPTURE_CUSTOM_MIME);
  const routedText = text.startsWith(WEB_CAPTURE_ROUTE_PREFIX)
    ? text
    : customMimeText.startsWith(WEB_CAPTURE_ROUTE_PREFIX)
      ? customMimeText
      : null;
  if (routedText === null) return null;
  return { text: routedText, customMimeText: customMimeText || undefined };
}

function allocateWebCaptureIdentity(): WebCaptureImportIdentity {
  const nonce = generateId().replace(/[^A-Za-z0-9_-]/g, "-");
  return {
    operationId: `web-capture-${nonce}`,
    childPath: `compositions/web-captures/capture-${nonce}.html`,
    compositionId: `web-capture-${nonce}`,
    rootDomId: `web-capture-root-${nonce}`,
    rootHfId: `hf-web-capture-root-${nonce}`,
  };
}

function describeWebCaptureRejection(reason: WebCaptureImportRejection): string {
  switch (reason.kind) {
    case "contract":
      return "actual" in reason.failure && "limit" in reason.failure
        ? `Browser capture rejected: ${reason.failure.code} (${reason.failure.actual} > ${reason.failure.limit})`
        : `Browser capture rejected: ${reason.failure.code}`;
    case "artifact.unsupported":
      return `Browser capture kind is not supported yet: ${reason.artifactKind}`;
    case "artifact.unsafe":
      return `Browser capture was unsafe to import: ${reason.reason}`;
    case "placement.invalid-playhead":
      return "Browser capture has no valid timeline playhead.";
    case "identity.invalid":
      return `Browser capture identity is invalid: ${reason.field}`;
  }
}

export function useClipboard({
  projectId,
  activeCompPath,
  domEditSelectionRef,
  showToast,
  writeProjectFile,
  recordEdit,
  observeProjectFileVersion,
  refreshFileTree,
  forceReloadSdkSession,
  domEditSaveTimestampRef,
  reloadPreview,
  handleTimelineElementDelete,
  handleDomEditElementDelete,
  previewIframeRef,
}: UseClipboardOptions) {
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const tokenStoreRef = useRef<ReturnType<typeof createInternalClipboardTokenStore> | null>(null);
  tokenStoreRef.current ??= createInternalClipboardTokenStore();
  const importQueueRef = useRef<Promise<void>>(Promise.resolve());

  const readSelectedPayload = useCallback((): ClipboardPayload | null => {
    const { selectedElementId, elements } = usePlayerStore.getState();
    if (selectedElementId) {
      const element = elements.find(
        (candidate) => (candidate.key ?? candidate.id) === selectedElementId,
      );
      if (!element) return null;
      const targetPath = element.sourceFile || activeCompPath || "index.html";
      let html: string | null = null;
      try {
        const doc = previewIframeRef.current?.contentDocument;
        if (doc) {
          html =
            findElementForSelection(
              doc,
              {
                hfId: element.hfId,
                id: element.domId,
                selector: element.selector,
                selectorIndex: element.selectorIndex,
                sourceFile: targetPath,
              },
              activeCompPath,
            )?.outerHTML ?? null;
        }
      } catch {
        return null;
      }
      return html ? { kind: "timeline-clip", html, sourceFile: targetPath } : null;
    }

    const selection = domEditSelectionRef.current;
    if (!selection) return null;
    const html = getElementOuterHtml(previewIframeRef, selection, activeCompPath);
    if (!html) return null;
    return {
      kind: "dom-element",
      html,
      sourceFile: selection.sourceFile || activeCompPath || "index.html",
      originSelector: selection.selector,
      originSelectorIndex: selection.selectorIndex,
    };
  }, [activeCompPath, domEditSelectionRef, previewIframeRef]);

  const writeInternalClipboard = useCallback(
    (event: ClipboardEvent, verb: "Copied" | "Cut"): boolean => {
      const pid = projectIdRef.current;
      const data = event.clipboardData;
      if (!pid || !data) return false;
      const payload = readSelectedPayload();
      if (!payload) return false;
      data.setData("text/plain", tokenStoreRef.current!.issue(payload, pid));
      event.preventDefault();
      showToast(`${verb} ${payload.kind === "timeline-clip" ? "clip" : "element"}`, "info");
      return true;
    },
    [readSelectedPayload, showToast],
  );

  const pasteInternalPayload = useCallback(
    async (payload: ClipboardPayload, target: ClipboardTargetSnapshot) => {
      const originalContent = await readFileContent(target.projectId, target.targetPath);
      const deduped = deduplicateIds(payload.html, collectHtmlIds(originalContent));
      let patchedContent: string;
      if (payload.kind === "timeline-clip") {
        const rootTagEnd = deduped.indexOf(">");
        const rootTag = rootTagEnd >= 0 ? deduped.slice(0, rootTagEnd + 1) : deduped;
        const patchedRootTag = rootTag.replace(
          /data-start="[^"]*"/,
          `data-start="${formatTimelineAttributeNumber(target.playhead)}"`,
        );
        patchedContent = insertTimelineAssetIntoSource(
          originalContent,
          patchedRootTag + deduped.slice(rootTagEnd + 1),
        );
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
        projectId: target.projectId,
        label: payload.kind === "timeline-clip" ? "Paste clip" : "Paste element",
        kind: "timeline",
        files: { [target.targetPath]: patchedContent },
        readFile: async () => originalContent,
        writeFile: writeProjectFile,
        recordEdit,
      });
      reloadPreview();
      showToast(payload.kind === "timeline-clip" ? "Pasted clip" : "Pasted element", "info");
    },
    [domEditSaveTimestampRef, recordEdit, reloadPreview, showToast, writeProjectFile],
  );

  const pasteExternalCapture = useCallback(
    async (snapshot: ClipboardTextSnapshot, target: ClipboardTargetSnapshot) => {
      try {
        const result = await planWebCaptureImport({
          ...snapshot,
          playhead: target.playhead,
          materializeResource: materializeWebCaptureImageResource,
          allocateIdentity: allocateWebCaptureIdentity,
        });
        if (!result.ok) {
          showToast(describeWebCaptureRejection(result.reason), "error");
          return;
        }
        if (projectIdRef.current !== target.projectId) {
          showToast("Project changed before the browser capture was ready.", "info");
          return;
        }

        const { plan } = result;
        for (const file of plan.supportingFiles) {
          await writeProjectFile(file.path, file.source);
        }
        await writeProjectFile(plan.child.path, plan.child.source);
        try {
          if (projectIdRef.current !== target.projectId) {
            throw new Error("Project changed while the browser capture was being saved");
          }
          await commitTimelineCompositionInsertion({
            projectId: target.projectId,
            targetPath: target.targetPath,
            sourcePath: plan.host.sourcePath,
            start: plan.host.start,
            track: 0,
            writeFile: writeProjectFile,
            recordEdit,
            observeVersion: observeProjectFileVersion,
            selectHost: (key) => usePlayerStore.getState().setSelectedElementId(key),
            resync: forceReloadSdkSession,
            refresh: reloadPreview,
          });
        } catch (error) {
          try {
            await deleteProjectFile(target.projectId, plan.child.path);
          } catch (rollbackError) {
            throw new AggregateError(
              [error, rollbackError],
              "Browser capture insertion failed and its child file could not be removed",
            );
          }
          throw error;
        }

        domEditSaveTimestampRef.current = Date.now();
        await refreshFileTree();
        const message =
          plan.kind === "editable-dom"
            ? plan.warnings.includes("model.localized")
              ? "Pasted editable browser HTML with live local 3D"
              : plan.warnings.includes("opaque.replaced")
                ? "Pasted editable browser HTML with frozen visual islands"
                : "Pasted editable browser HTML"
            : plan.warnings.includes("still.cropped")
              ? "Pasted cropped browser Still"
              : "Pasted browser Still";
        showToast(message, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to paste browser capture";
        showToast(message, "error");
      }
    },
    [
      domEditSaveTimestampRef,
      forceReloadSdkSession,
      observeProjectFileVersion,
      recordEdit,
      refreshFileTree,
      reloadPreview,
      showToast,
      writeProjectFile,
    ],
  );

  const handleNativeCopy = useCallback(
    (event: ClipboardEvent) => {
      writeInternalClipboard(event, "Copied");
    },
    [writeInternalClipboard],
  );

  const handleNativeCut = useCallback(
    (event: ClipboardEvent) => {
      if (!writeInternalClipboard(event, "Cut")) return;
      const { selectedElementId, elements } = usePlayerStore.getState();
      if (selectedElementId) {
        const element = elements.find(
          (candidate) => (candidate.key ?? candidate.id) === selectedElementId,
        );
        if (element) {
          void handleTimelineElementDelete(element);
          return;
        }
      }
      const selection = domEditSelectionRef.current;
      if (selection) void handleDomEditElementDelete(selection);
    },
    [
      domEditSelectionRef,
      handleDomEditElementDelete,
      handleTimelineElementDelete,
      writeInternalClipboard,
    ],
  );

  const handleNativePaste = useCallback(
    (event: ClipboardEvent) => {
      const data = event.clipboardData;
      if (!data) return;
      const text = readClipboardData(data, "text/plain");
      const external = snapshotExternalCapture(data);
      const internal = isInternalClipboardText(text);
      const legacy = isLegacyClipboardText(text);
      if (!external && !internal && !legacy) return;
      event.preventDefault();

      const pid = projectIdRef.current;
      if (!pid) {
        showToast("Open a project before pasting.", "info");
        return;
      }
      const target: ClipboardTargetSnapshot = {
        projectId: pid,
        targetPath: activeCompPath || "index.html",
        playhead: usePlayerStore.getState().currentTime,
      };

      if (external) {
        const task = importQueueRef.current.then(() => pasteExternalCapture(external, target));
        importQueueRef.current = task.catch(() => undefined);
        return;
      }
      if (legacy) {
        showToast("This Studio clipboard format is no longer accepted.", "error");
        return;
      }

      const resolution = tokenStoreRef.current!.resolve(text, pid);
      if (resolution.kind === "resolved") {
        void pasteInternalPayload(resolution.payload, target).catch((error: unknown) => {
          showToast(error instanceof Error ? error.message : "Failed to paste", "error");
        });
        return;
      }
      const message =
        resolution.kind === "foreign-project"
          ? "Copied Studio content belongs to another project."
          : resolution.kind === "expired-token"
            ? "Copied Studio content expired. Copy it again."
            : "Copied Studio content is no longer available. Copy it again.";
      showToast(message, "info");
    },
    [activeCompPath, pasteExternalCapture, pasteInternalPayload, showToast],
  );

  return {
    nativeClipboardHandlers: {
      copy: handleNativeCopy,
      cut: handleNativeCut,
      paste: handleNativePaste,
    },
  };
}
