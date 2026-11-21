import { trackPreviewFeatureUsed } from "../utils/previewFeatureUsage";
import { useCallback, useRef } from "react";
import { refreshTimelineRowText } from "./refreshTimelineRowText";
import { normalizeDomEditStyleValue } from "../utils/studioHelpers";
import { injectPreviewGoogleFont, injectPreviewImportedFont } from "../utils/studioFontHelpers";
import {
  buildDomEditRichTextPatchOperation,
  findElementForSelection,
  getDomEditTargetKey,
  isTextEditableSelection,
  buildDefaultDomEditTextField,
  type DomEditTextField,
  type DomEditSelection,
} from "../components/editor/domEditing";
import type { ImportedFontAsset } from "../components/editor/fontAssets";
import type { PersistDomEditOperations } from "./domEditCommitTypes";
import {
  canEditElementTextInline,
  canEditSealedTextInline,
} from "../components/editor/domEditInlineText";
import { previewStandIn } from "../components/editor/previewDrafts";
import { buildNextDomTextFields, planDomTextCommit } from "./domEditTextCommitPlan";
import { reportDomEditPersistFailure } from "./domEditPersistFailure";
import {
  claimTextWrite,
  type TextWriteClaim,
  type TextWriteOrder,
  domEditCommitDeclined,
  runDomEditCommit,
  runReportedDomEditCommit,
  type DomEditCommitOutcome,
} from "./domEditCommitRunner";
import { commitDomStyles } from "./domStyleCommit";
import { editSealedSelection } from "../components/editor/previewSelection";
import { escapeHtmlText } from "../components/editor/domEditingLayers";
import {
  afterSealedDraw,
  describePreviewElements,
  editPreviewElement,
  type PreviewElementEdit,
} from "../player/lib/previewElements";
import { useDomEditAttributeCommits } from "./useDomEditAttributeCommits";
import { textSaveEnded, type InlineTextEditCommit } from "./useInlineTextEdit";
import {
  landedText,
  nextTextSaveOrder,
  requestedOrder,
  textSaveLanded,
  textSaveStarted,
} from "./textSaves";
import type { UseDomSelectionReturn } from "./useDomSelectionTypes";

// ── Types ──

export interface UseDomEditTextCommitsParams {
  activeCompPath: string | null;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  showToast: (message: string, tone?: "error" | "info") => void;
  domEditSelection: DomEditSelection | null;
  applyDomSelection: (
    selection: DomEditSelection | null,
    options?: { revealPanel?: boolean; additive?: boolean; preserveGroup?: boolean },
  ) => void;
  refreshDomEditSelectionFromPreview: (selection: DomEditSelection) => void;
  buildDomSelectionFromTarget: UseDomSelectionReturn["buildDomSelectionFromTarget"];
  persistDomEditOperations: PersistDomEditOperations;
  resolveImportedFontAsset: (fontFamilyValue: string) => ImportedFontAsset | null;
  readOnlyPreview: boolean;
}

function canCommitInlineTextSelection(selection: DomEditSelection, element: HTMLElement): boolean {
  if (selection.isCompositionHost || selection.isInsideLockedComposition) return false;
  return canEditElementTextInline(element);
}

async function resyncDomTextSelectionFromPreview(
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

function textWriteSteps(input: {
  iframe: HTMLIFrameElement | null;
  selection: DomEditSelection;
  activeCompPath: string | null;
  textCommit: ReturnType<typeof planDomTextCommit>;
  text: string;
  isLatest: TextWriteClaim;
  showToast: UseDomEditTextCommitsParams["showToast"];
  resync: TextResync;
}) {
  const { iframe, selection, activeCompPath, textCommit, text, isLatest } = input;
  const doc = iframe?.contentDocument;
  let editedElement: HTMLElement | null = null;
  let previousInnerHtml: string | null = null;
  let sealedEdit: PreviewElementEdit | null = null;
  const steps = {
    capture: () => {
      const el = doc ? findElementForSelection(doc, selection, activeCompPath) : null;
      if (!el) return;
      editedElement = el;
      previousInnerHtml = el.innerHTML;
    },
    apply: () => {
      const serialized = textCommit.usesSerializedTextFields;
      if (!editedElement) {
        const html = serialized ? textCommit.nextContent : escapeHtmlText(text);
        sealedEdit = editSealedSelection(iframe, selection, { html });
      } else if (serialized) editedElement.innerHTML = textCommit.nextContent;
      else editedElement.textContent = text;
    },
    shouldRevert: () => isLatest(),
    revert: () => {
      sealedEdit?.restore();
      if (editedElement && previousInnerHtml !== null) editedElement.innerHTML = previousInnerHtml;
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
  return { steps, sealedEdit: () => sealedEdit };
}

export const textEditNotSaved = (reason: string) => `Couldn't save the text edit: ${reason}`;
const NOT_FOUND = "this text was not found in the composition's source";
const GONE = "the text's element is gone from the preview";
// The same gate that let the edit open, not the design panel's field rule: an element
// whose text holds a line break has no fields, and editing in place rewrites its markup.
const NOT_EDITABLE = "this text can't be edited in place";

/** The edited stand-in's own selection: the frame's reply can land after a click moved or cleared the current one. */
async function sealedInlineTextSelection(
  element: HTMLElement,
  sealed: { iframe: HTMLIFrameElement; handle: string },
  build: UseDomEditTextCommitsParams["buildDomSelectionFromTarget"],
): Promise<DomEditSelection | string> {
  const [described] = (await describePreviewElements(sealed.iframe, [sealed.handle])) ?? [];
  if (!described) return GONE;
  const selection = await build(described, { exactTarget: true, skipSourceProbe: true });
  if (selection?.element !== element) return NOT_FOUND;
  return canEditSealedTextInline(selection) ? selection : NOT_EDITABLE;
}

/** The edited node, not the current selection: a press can open an edit on a child of what is selected. */
async function liveInlineTextSelection(
  element: HTMLElement,
  doc: Document | null | undefined,
  build: UseDomEditTextCommitsParams["buildDomSelectionFromTarget"],
): Promise<DomEditSelection | string> {
  if (!doc || !element.isConnected || element.ownerDocument !== doc) return GONE;
  const selection = await build(element, { exactTarget: true, skipSourceProbe: true });
  if (selection?.element !== element) return NOT_FOUND;
  return canCommitInlineTextSelection(selection, element) ? selection : NOT_EDITABLE;
}

// ── Hook ──

export function useDomEditTextCommits({
  activeCompPath,
  previewIframeRef,
  showToast,
  domEditSelection,
  applyDomSelection,
  refreshDomEditSelectionFromPreview,
  buildDomSelectionFromTarget,
  persistDomEditOperations,
  resolveImportedFontAsset,
  readOnlyPreview,
}: UseDomEditTextCommitsParams) {
  const latestReadOnlyPreviewRef = useRef(readOnlyPreview);
  latestReadOnlyPreviewRef.current = readOnlyPreview;
  const latestSelectionRef = useRef(domEditSelection);
  latestSelectionRef.current = domEditSelection;
  const textWritesRef = useRef<TextWriteOrder>({ claims: new Map(), chains: new Map() });
  const domStyleCommitVersionRef = useRef(new Map<string, symbol>());

  const {
    handleDomAttributeCommit,
    handleDomAttributeLiveCommit,
    handleDomAttributeQuietCommit,
    handleDomHtmlAttributeCommit,
    handleDomAttributesCommit,
    handleDomAttributeBatchCommit,
  } = useDomEditAttributeCommits({
    activeCompPath,
    previewIframeRef,
    showToast,
    domEditSelection,
    refreshDomEditSelectionFromPreview,
    persistDomEditOperations,
  });

  const handleDomStyleCommitForSelection = useCallback(
    (
      selection: DomEditSelection,
      propertyOrStylesAsOnePatch: string | Record<string, string>,
      value = "",
    ): Promise<DomEditCommitOutcome> =>
      commitDomStyles(
        {
          activeCompPath,
          previewIframeRef,
          persistDomEditOperations,
          showToast,
          versions: domStyleCommitVersionRef.current,
          resolveImportedFontAsset,
          resync: refreshDomEditSelectionFromPreview,
        },
        selection,
        typeof propertyOrStylesAsOnePatch === "string"
          ? { [propertyOrStylesAsOnePatch]: value }
          : propertyOrStylesAsOnePatch,
      ),
    [
      activeCompPath,
      persistDomEditOperations,
      refreshDomEditSelectionFromPreview,
      resolveImportedFontAsset,
      showToast,
      previewIframeRef,
    ],
  );

  const handleDomStyleCommit = useCallback(
    (property: string, value: string): Promise<DomEditCommitOutcome> =>
      domEditSelection
        ? handleDomStyleCommitForSelection(domEditSelection, property, value)
        : Promise.resolve(domEditCommitDeclined("no-selection")),
    [domEditSelection, handleDomStyleCommitForSelection],
  );

  const handleDomTextCommitForSelection = useCallback(
    async (
      selection: DomEditSelection,
      value: string,
      fieldKey?: string,
    ): Promise<DomEditCommitOutcome> => {
      if (!isTextEditableSelection(selection)) {
        return domEditCommitDeclined("not-text-editable");
      }
      const claim = claimTextWrite(
        textWritesRef.current,
        getDomEditTargetKey(selection),
        nextTextSaveOrder(),
      )!;
      const nextTextFields = buildNextDomTextFields(selection.textFields, value, fieldKey);
      const textCommit = planDomTextCommit(selection.textFields, nextTextFields, value);
      const write = textWriteSteps({
        iframe: previewIframeRef.current,
        selection,
        activeCompPath,
        textCommit,
        text: value,
        isLatest: claim,
        showToast,
        resync: {
          buildDomSelectionFromTarget,
          applyDomSelection,
          refreshDomEditSelectionFromPreview,
        },
      });

      return runReportedDomEditCommit({
        ...write.steps,
        persist: () =>
          claim.write(async () =>
            afterSealedDraw(write.sealedEdit(), (drawn) =>
              persistDomEditOperations(selection, textCommit.operations, {
                label: "Edit text",
                skipRefresh: drawn,
                shouldSave: claim,
              }),
            ),
          ),
      });
    },
    [
      activeCompPath,
      applyDomSelection,
      buildDomSelectionFromTarget,
      persistDomEditOperations,
      previewIframeRef,
      refreshDomEditSelectionFromPreview,
      showToast,
    ],
  );

  const handleDomTextCommit = useCallback(
    (value: string, fieldKey?: string): Promise<DomEditCommitOutcome> =>
      domEditSelection
        ? handleDomTextCommitForSelection(domEditSelection, value, fieldKey)
        : Promise.resolve(domEditCommitDeclined("no-selection")),
    [domEditSelection, handleDomTextCommitForSelection],
  );

  /**
   * Persist an element's own markup, for a text edit that styled part of it.
   *
   * Its own commit rather than a mode of the one above: that one plans a change
   * to the text-field model, which escapes markup on the way out and refuses a
   * change in child structure, and both of those are correct for the design
   * panel. Styling a run of characters is neither of those things. The element
   * already holds what the user typed, so there is nothing to apply, only
   * something to save and something to put back if saving fails.
   */
  const commitRichText = useCallback(
    async (element: HTMLElement, html: string, previousHtml: string, number: number) => {
      const sealed = previewStandIn(element);
      // Back to the newest text that reached the file, and only over this save's own draft.
      const putBack = () => {
        const back = landedText(element) ?? previousHtml;
        if (sealed)
          void editPreviewElement(sealed.iframe, sealed.handle, { html: back, expect: html });
        else if (element.isConnected && element.innerHTML === html) element.innerHTML = back;
      };
      if (latestReadOnlyPreviewRef.current) return putBack();
      const refuse = (reason: string) => {
        console.error("[Studio] text edit not saved:", reason, element);
        showToast(textEditNotSaved(reason), "error");
        putBack();
      };
      const doc = previewIframeRef.current?.contentDocument;
      const selection = sealed
        ? await sealedInlineTextSelection(element, sealed, buildDomSelectionFromTarget)
        : await liveInlineTextSelection(element, doc, buildDomSelectionFromTarget);
      if (typeof selection === "string") return refuse(selection);
      const claim = claimTextWrite(textWritesRef.current, getDomEditTargetKey(selection), number);
      if (!claim) return;
      const operations = [buildDomEditRichTextPatchOperation(html)];

      await runDomEditCommit({
        capture: () => {},
        apply: () => {
          if (sealed)
            return void editPreviewElement(sealed.iframe, sealed.handle, {
              html,
              expect: previousHtml,
            });
          // Idempotent: the caret put this there. Assigned anyway so a commit
          // raised from anywhere but the element itself still lands.
          element.innerHTML = html;
        },
        persist: async () => {
          const result = await claim.write(() =>
            persistDomEditOperations(selection, operations, {
              label: "Edit text",
              skipRefresh: true,
              shouldSave: claim,
            }),
          );
          textSaveLanded(element, number, html);
          if (result?.changed) trackPreviewFeatureUsed("text_edit", "field");
        },
        shouldRevert: () => claim(),
        revert: putBack,
        onError: (error) => reportDomEditPersistFailure(selection, operations, error, showToast),
        // Re-select only what is still selected: the selection may have moved on, or a host cleared it.
        shouldResync: () => claim() && latestSelectionRef.current?.element === element,
        resync: () =>
          sealed
            ? refreshDomEditSelectionFromPreview(selection)
            : resyncDomTextSelectionFromPreview(
                doc,
                selection,
                activeCompPath,
                buildDomSelectionFromTarget,
                applyDomSelection,
              ),
        onFinally: claim.release,
      });
    },
    [
      activeCompPath,
      applyDomSelection,
      buildDomSelectionFromTarget,
      persistDomEditOperations,
      previewIframeRef,
      refreshDomEditSelectionFromPreview,
      showToast,
    ],
  );

  const handleDomRichTextCommit = useCallback(
    async (commit: InlineTextEditCommit) => {
      const { element, html, previousHtml } = commit;
      const number = requestedOrder(commit) ?? nextTextSaveOrder();
      const saveDone = textSaveStarted(element);
      try {
        await commitRichText(element, html, previousHtml, number);
      } finally {
        saveDone();
        textSaveEnded(element);
      }
    },
    [commitRichText],
  );

  const commitDomTextFields = useCallback(
    async (
      selection: DomEditSelection,
      nextTextFields: DomEditTextField[],
      options?: { importedFont?: ImportedFontAsset | null; fontFamily?: boolean },
    ) => {
      const claim = claimTextWrite(
        textWritesRef.current,
        getDomEditTargetKey(selection),
        nextTextSaveOrder(),
      )!;
      const textCommit = planDomTextCommit(
        selection.textFields,
        nextTextFields,
        nextTextFields[0]?.value ?? "",
      );
      const importedFont = options?.importedFont ?? null;
      const write = textWriteSteps({
        iframe: previewIframeRef.current,
        selection,
        activeCompPath,
        textCommit,
        text: textCommit.nextContent,
        isLatest: claim,
        showToast,
        resync: {
          buildDomSelectionFromTarget,
          applyDomSelection,
          refreshDomEditSelectionFromPreview,
        },
      });

      await runDomEditCommit({
        ...write.steps,
        persist: async () => {
          const sealedFontNeedsReload = Boolean(write.sealedEdit() && options?.fontFamily);
          await claim.write(async () =>
            afterSealedDraw(write.sealedEdit(), (drawn) =>
              persistDomEditOperations(selection, textCommit.operations, {
                label: "Edit text",
                skipRefresh: drawn && !sealedFontNeedsReload,
                importedFont: importedFont ?? undefined,
              }),
            ),
          );
        },
      });
    },
    [
      activeCompPath,
      applyDomSelection,
      buildDomSelectionFromTarget,
      persistDomEditOperations,
      previewIframeRef,
      refreshDomEditSelectionFromPreview,
      showToast,
    ],
  );

  const handleDomTextFieldStyleCommit = useCallback(
    async (fieldKey: string, property: string, value: string) => {
      if (!domEditSelection) return;
      const field = domEditSelection.textFields.find((entry) => entry.key === fieldKey);
      if (!field) return;

      if (field.source === "self") {
        await handleDomStyleCommit(property, value);
        return;
      }

      const normalizedValue = normalizeDomEditStyleValue(property, value);
      const importedFont = property === "font-family" ? resolveImportedFontAsset(value) : null;
      if (property === "font-family") {
        const doc = previewIframeRef.current?.contentDocument;
        if (doc) {
          injectPreviewGoogleFont(doc, normalizedValue);
          if (importedFont) injectPreviewImportedFont(doc, importedFont);
        }
      }
      const nextTextFields = domEditSelection.textFields.map((entry) =>
        entry.key === fieldKey
          ? {
              ...entry,
              inlineStyles: {
                ...entry.inlineStyles,
                [property]: normalizedValue,
              },
              computedStyles: {
                ...entry.computedStyles,
                [property]: normalizedValue,
              },
            }
          : entry,
      );

      await commitDomTextFields(domEditSelection, nextTextFields, {
        importedFont,
        fontFamily: property === "font-family",
      });
    },
    [
      commitDomTextFields,
      domEditSelection,
      handleDomStyleCommit,
      resolveImportedFontAsset,
      previewIframeRef,
    ],
  );

  const handleDomAddTextField = useCallback(
    async (afterFieldKey?: string) => {
      if (!domEditSelection) return null;
      if (!domEditSelection.textFields.some((field) => field.source === "child")) return null;

      const insertionIndex = domEditSelection.textFields.findIndex(
        (field) => field.key === afterFieldKey,
      );
      const baseField =
        domEditSelection.textFields[insertionIndex >= 0 ? insertionIndex : 0] ??
        domEditSelection.textFields[0];
      const nextField = buildDefaultDomEditTextField(baseField);
      const nextTextFields = [...domEditSelection.textFields];
      nextTextFields.splice(
        insertionIndex >= 0 ? insertionIndex + 1 : nextTextFields.length,
        0,
        nextField,
      );

      await commitDomTextFields(domEditSelection, nextTextFields);
      return nextField.key;
    },
    [commitDomTextFields, domEditSelection],
  );

  const handleDomRemoveTextField = useCallback(
    async (fieldKey: string) => {
      if (!domEditSelection) return;
      const field = domEditSelection.textFields.find((entry) => entry.key === fieldKey);
      if (!field) return;

      if (field.source === "self") {
        await handleDomTextCommit("", fieldKey);
        return;
      }

      const nextTextFields = domEditSelection.textFields.filter((entry) => entry.key !== fieldKey);
      await commitDomTextFields(domEditSelection, nextTextFields);
    },
    [commitDomTextFields, domEditSelection, handleDomTextCommit],
  );

  return {
    handleDomStyleCommit,
    handleDomStyleCommitForSelection,
    handleDomAttributeCommit,
    handleDomAttributeLiveCommit,
    handleDomAttributeQuietCommit,
    handleDomHtmlAttributeCommit,
    handleDomAttributesCommit,
    handleDomAttributeBatchCommit,
    handleDomTextCommit,
    handleDomTextCommitForSelection,
    handleDomRichTextCommit,
    commitDomTextFields,
    handleDomTextFieldStyleCommit,
    handleDomAddTextField,
    handleDomRemoveTextField,
  };
}
