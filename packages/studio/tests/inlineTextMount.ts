// Studio's inline text editing and text saves, mounted in the test page as the canvas wires them, over a file whose
// writes the test decides: each lands, fails or waits, in the order they reach it.
import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { patchElementInHtml } from "@hyperframes/studio-server/source-mutation";
import {
  findPreviewElementForSelection,
  gestureDocumentOf,
  resolveFoundSelection,
  resolvePreviewSelection,
} from "../src/components/editor/previewSelection";
import type { DomEditSelection } from "../src/components/editor/domEditing";
import type { PersistDomEditOperations } from "../src/hooks/domEditCommitTypes";
import { useDomEditTextCommits } from "../src/hooks/useDomEditTextCommits";
import { useInlineTextEdit } from "../src/hooks/useInlineTextEdit";
import {
  afterStudioPendingEdits,
  hasStudioPendingEdits,
  isStudioEditSaving,
  trackedStudioEdit,
} from "../src/utils/studioPendingEdits";
import {
  afterStudioManualEditGestures,
  isStudioManualEditGestureLiveIn,
} from "../src/components/editor/manualEditGesture";

const PATH = "index.html";
const OPTIONS = { activeCompositionPath: PATH, isMasterView: false, skipSourceProbe: true };

export type WriteFate = "land" | "fail" | "wait";

export interface TextEditing {
  select(): Promise<DomEditSelection>;
  controls: () => ReturnType<typeof useInlineTextEdit>;
  commits: () => ReturnType<typeof useDomEditTextCommits>;
  /** The element's markup in the file, as the patcher left it. */
  saved(): string;
  /** Every write that reached the file, in order, with its value. */
  writes: string[];
  /** Writes Studio dropped as superseded before they reached the file. */
  skipped: string[];
  /** What Studio told the person failed: error toasts and lost edits. */
  reported: string[];
  /** The fate the next writes take, in the order they reach the file; `land` once it runs out. */
  fates: WriteFate[];
  /** Lets every write still waiting go on, landing. */
  releaseWaiting(): void;
  waiting(): number;
  /** Runs `load` as Studio's preview reload does: after any edit gesture live in the preview. */
  reloadWhenFree(load: () => void): void;
  pending(): boolean;
}

export function mountTextEditing(
  iframe: HTMLIFrameElement,
  sealed: boolean,
  fileHtml: string,
  id: string,
  /** Called with the element's markup each time a write lands, so a full reload loads the new file. */
  onLanded: (markup: string) => void,
): TextEditing {
  let file = fileHtml;
  const writes: string[] = [];
  const skipped: string[] = [];
  const reported: string[] = [];
  const fates: WriteFate[] = [];
  const waiting: Array<() => void> = [];
  const valueOf = (operations: Parameters<PersistDomEditOperations>[1]) =>
    String(operations[0]?.value);
  const takeFate = async () => {
    const fate = fates.shift() ?? "land";
    if (fate === "wait") await new Promise<void>((resolve) => waiting.push(resolve));
    if (fate === "fail") throw new Error("write refused");
  };
  const persist: PersistDomEditOperations = async (selection, operations, options) => {
    if (options?.shouldSave?.() === false) return void skipped.push(valueOf(operations));
    await takeFate();
    file = patchElementInHtml(file, { id: selection.id }, operations).html;
    writes.push(valueOf(operations));
    onLanded(saved());
  };
  const select = async () => {
    if (!sealed) {
      const element = iframe.contentDocument!.getElementById(id)!;
      return (await resolveFoundSelection(iframe, element, OPTIONS))!;
    }
    const found = await findPreviewElementForSelection(iframe, { id, sourceFile: PATH }, PATH);
    return (await resolvePreviewSelection(iframe, found!, OPTIONS))!;
  };
  let setSelection!: (selection: DomEditSelection | null) => void;
  let controls!: ReturnType<typeof useInlineTextEdit>;
  let commits!: ReturnType<typeof useDomEditTextCommits>;
  const root = createRoot(document.createElement("div"));
  flushSync(() =>
    root.render(
      createElement(() => {
        const [selection, set] = useState<DomEditSelection | null>(null);
        setSelection = set;
        const raw = useDomEditTextCommits({
          activeCompPath: PATH,
          previewIframeRef: { current: iframe },
          showToast: (message, kind) => void (kind === "error" && reported.push(String(message))),
          reloadPreview: () => (window as unknown as { __reload: () => void }).__reload(),
          domEditSelection: selection,
          applyDomSelection: () => {},
          refreshDomEditSelectionFromPreview: () => {},
          buildDomSelectionFromTarget: (target, options) =>
            resolveFoundSelection(iframe, target, { ...OPTIONS, ...options }),
          persistDomEditOperations: persist,
          resolveImportedFontAsset: () => null,
          readOnlyPreview: false,
        });
        // As DomEditContext's trackEditCommits: each save is a pending edit from the call, after older saves.
        const tracked = <F extends (...args: never[]) => unknown>(save: F) =>
          trackedStudioEdit(save, { afterOlderSaves: true }) as F;
        commits = {
          ...raw,
          handleDomTextCommitForSelection: tracked(raw.handleDomTextCommitForSelection),
          handleDomRichTextCommit: tracked(raw.handleDomRichTextCommit),
          handleDomAddTextField: tracked(raw.handleDomAddTextField),
          handleDomRemoveTextField: tracked(raw.handleDomRemoveTextField),
        };
        controls = useInlineTextEdit({
          onCommit: commits.handleDomRichTextCommit,
          onLost: (reason) => void reported.push(reason),
        });
        return null;
      }),
    ),
  );
  function saved() {
    return new DOMParser().parseFromString(file, "text/html").getElementById(id)!.innerHTML;
  }
  // As Studio's shadow reload (useShadowPreviewReload.ts): after a live gesture, then after pending saves.
  function reloadWhenFree(load: () => void): void {
    const doc = gestureDocumentOf(iframe);
    const retry = () => reloadWhenFree(load);
    if (doc && isStudioManualEditGestureLiveIn(doc)) afterStudioManualEditGestures(doc, retry);
    else if (isStudioEditSaving()) afterStudioPendingEdits(retry);
    else load();
  }
  return {
    select: async () => {
      const selection = await select();
      flushSync(() => setSelection(selection));
      return selection;
    },
    controls: () => controls,
    commits: () => commits,
    saved,
    writes,
    skipped,
    reported,
    fates,
    releaseWaiting: () => waiting.splice(0).forEach((go) => go()),
    waiting: () => waiting.length,
    reloadWhenFree,
    pending: () => hasStudioPendingEdits() || waiting.length > 0,
  };
}
