import {
  findElementForSelection,
  serializeDomEditTextFields,
  type DomEditSelection,
} from "../components/editor/domEditing";
import { editSealedSelection } from "../components/editor/previewSelection";
import { escapeHtmlText } from "../components/editor/domEditingLayers";
import type { PreviewElementEdit } from "../player/lib/previewElements";
import type { TextWriteClaim } from "./domEditCommitRunner";
import { reportDomEditPersistFailure } from "./domEditPersistFailure";
import { usesSerializedTextFields, type planDomTextCommit } from "./domEditTextCommitPlan";
import { refreshTimelineRowText } from "./refreshTimelineRowText";
import type { UseDomEditTextCommitsParams } from "./useDomEditTextCommits";
import { flushStudioPendingEdits } from "../utils/studioPendingEdits";

export async function resyncDomTextSelectionFromPreview(
  doc: Document | null | undefined,
  selection: DomEditSelection,
  activeCompPath: string | null,
  buildDomSelectionFromTarget: UseDomEditTextCommitsParams["buildDomSelectionFromTarget"],
  applyDomSelection: UseDomEditTextCommitsParams["applyDomSelection"],
): Promise<void> {
  if (!doc) return;
  const refreshed = findElementForSelection(doc, selection, activeCompPath);
  if (!refreshed) return;
  refreshTimelineRowText(refreshed);
  const nextSelection = await buildDomSelectionFromTarget(refreshed);
  if (!nextSelection) return;
  applyDomSelection(nextSelection, { revealPanel: false, preserveGroup: true });
}

type TextResync = Pick<
  UseDomEditTextCommitsParams,
  "buildDomSelectionFromTarget" | "applyDomSelection" | "refreshDomEditSelectionFromPreview"
>;

export function textWriteSteps(input: {
  iframe: HTMLIFrameElement | null;
  selection: DomEditSelection;
  activeCompPath: string | null;
  textCommit: ReturnType<typeof planDomTextCommit>;
  text: string;
  isLatest: TextWriteClaim;
  showToast: UseDomEditTextCommitsParams["showToast"];
  resync: TextResync;
  reloadFromFile: () => void;
}) {
  const { iframe, selection, activeCompPath, textCommit, text, isLatest } = input;
  const doc = iframe?.contentDocument;
  let editedElement: HTMLElement | null = null;
  let sealedEdit: PreviewElementEdit | null = null;
  let drawn = "";
  // What the element showed when this save's turn opened: what the file holds, since earlier saves settled first.
  let before: string | undefined = selection.textFields.length
    ? usesSerializedTextFields(selection.textFields)
      ? serializeDomEditTextFields(selection.textFields)
      : escapeHtmlText(selection.textFields[0]!.value)
    : undefined;
  const steps = {
    capture: () => {
      const el = doc ? findElementForSelection(doc, selection, activeCompPath) : null;
      if (el) {
        editedElement = el;
        before = el.innerHTML;
      }
    },
    apply: () => {
      const serialized = textCommit.usesSerializedTextFields;
      if (!editedElement) {
        drawn = serialized ? textCommit.nextContent : escapeHtmlText(text);
        sealedEdit = editSealedSelection(iframe, selection, { html: drawn });
        return;
      }
      if (serialized) editedElement.innerHTML = textCommit.nextContent;
      else editedElement.textContent = text;
      drawn = editedElement.innerHTML;
    },
    shouldRevert: () => true,
    // The newest save goes back to what reached the file, or draws it again; an older one takes back only its own draw.
    revert: () => {
      const back = isLatest() ? isLatest.saved() : before;
      if (back === undefined) return input.reloadFromFile();
      if (sealedEdit) void editSealedSelection(iframe, selection, { html: back, expect: drawn });
      else if (editedElement?.innerHTML === drawn) editedElement.innerHTML = back;
    },
    onError: (error: unknown) =>
      reportDomEditPersistFailure(selection, textCommit.operations, error, input.showToast),
    shouldResync: isLatest,
    resync: () =>
      sealedEdit
        ? input.resync.refreshDomEditSelectionFromPreview(selection)
        : resyncDomTextSelectionFromPreview(
            doc,
            selection,
            activeCompPath,
            input.resync.buildDomSelectionFromTarget,
            input.resync.applyDomSelection,
          ),
    onFinally: isLatest.release,
  };
  return { steps, sealedEdit: () => sealedEdit, drawn: () => drawn };
}

// After the drain, so other open or saving edits reach the file before the preview is drawn from it.
export const drawFileAgain = (reloadPreview: () => void) =>
  void flushStudioPendingEdits().then(() => reloadPreview());
