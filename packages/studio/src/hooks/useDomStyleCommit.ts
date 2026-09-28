import { useCallback, useMemo, useRef, useState } from "react";
import type { DomEditSelection } from "../components/editor/domEditing";
import { createDomEditSaveQueue, type DomEditSaveDrainResult } from "../utils/domEditSaveQueue";
import type { DomEditCommitOutcome } from "./domEditCommitRunner";
import { commitDomStyles } from "./domStyleCommit";
import { useDomEditPersist, type RecordEditInput } from "./useDomEditPersist";
import { useMountEffect } from "./useMountEffect";

export interface UseDomStyleCommitOptions {
  projectId: string | null;
  /** The preview the host already runs; used only to apply the style live. */
  iframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  /** The same writer and history the host gives the timeline, so there is one writer and one undo list. */
  writeProjectFile: (path: string, content: string, expectedContent?: string) => Promise<void>;
  recordEdit: (entry: RecordEditInput) => Promise<void>;
  activeCompPath?: string | null;
  showToast?: (message: string, tone?: "error" | "info") => void;
}

const noop = () => {};

/** Saves style edits on a selection through Studio's own style commit, for a host without the editor. */
export function useDomStyleCommit({
  projectId,
  iframeRef,
  writeProjectFile,
  recordEdit,
  activeCompPath = null,
  showToast = noop,
}: UseDomStyleCommitOptions): {
  commitStyle: (
    selection: DomEditSelection,
    styles: Record<string, string>,
  ) => Promise<DomEditCommitOutcome>;
  waitForPendingSaves: () => Promise<DomEditSaveDrainResult>;
} {
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const [queue] = useState(createDomEditSaveQueue);
  useMountEffect(() => () => queue.destroy());
  const versions = useRef(new Map<string, symbol>()).current;
  const editHistory = useMemo(() => ({ recordEdit }), [recordEdit]);
  const persistDomEditOperations = useDomEditPersist({
    activeCompPath,
    previewIframeRef: iframeRef,
    showToast,
    queueDomEditSave: queue.enqueue,
    writeProjectFile,
    editHistory,
    projectIdRef,
    reloadPreview: noop,
  });
  const commitStyle = useCallback(
    (selection: DomEditSelection, styles: Record<string, string>) =>
      projectIdRef.current
        ? commitDomStyles(
            {
              activeCompPath,
              previewIframeRef: iframeRef,
              persistDomEditOperations,
              showToast,
              versions,
            },
            selection,
            styles,
          )
        : Promise.resolve<DomEditCommitOutcome>({ ok: false, reason: "no-project" }),
    [activeCompPath, iframeRef, persistDomEditOperations, showToast, versions],
  );
  return { commitStyle, waitForPendingSaves: queue.waitForIdle };
}
