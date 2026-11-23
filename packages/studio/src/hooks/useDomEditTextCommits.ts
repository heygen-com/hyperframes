import { trackPreviewFeatureUsed } from "../utils/previewFeatureUsage";
import { useCallback, useRef } from "react";
import { normalizeDomEditStyleValue } from "../utils/studioHelpers";
import { injectPreviewGoogleFont, injectPreviewImportedFont } from "../utils/studioFontHelpers";
import {
  buildDomEditRichTextPatchOperation,
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
  drawFileAgain,
  resyncDomTextSelectionFromPreview,
  textWriteSteps,
} from "./domEditTextWriteSteps";
import {
  claimTextWrite,
  textWriteOrder,
  type TextWriteClaim,
  type TextWriteOrder,
  domEditCommitDeclined,
  runDomEditCommit,
  runReportedDomEditCommit,
  type DomEditCommitOutcome,
} from "./domEditCommitRunner";
import { commitDomStyles } from "./domStyleCommit";
import {
  afterSealedDraw,
  describePreviewElements,
  editPreviewElement,
} from "../player/lib/previewElements";
import { useDomEditAttributeCommits } from "./useDomEditAttributeCommits";
import { endInlineEditOn, textSaveEnded, type InlineTextEditCommit } from "./useInlineTextEdit";
import {
  fieldSave,
  type TextSaveBookkeeping,
  landedTextFor,
  nextTextSaveOrder,
  queueTextSave,
  rememberTextTarget,
  requestedOrder,
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
  /** Draws the file again: what a failed save falls back to when no save of its target reached the file. */
  reloadPreview: () => void;
}

function canCommitInlineTextSelection(selection: DomEditSelection, element: HTMLElement): boolean {
  if (selection.isCompositionHost || selection.isInsideLockedComposition) return false;
  return canEditElementTextInline(element);
}

export const textEditNotSaved = (reason: string) => `Couldn't save the text edit: ${reason}`;

function claimTextFor(
  order: TextWriteOrder,
  element: HTMLElement,
  key: string,
  number: number,
  composes = false,
) {
  const claim = claimTextWrite(order, key, number, () => textSaveEnded(element), composes);
  if (claim) rememberTextTarget(element, order, key);
  return claim;
}
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

/** At its turn, a save that followed another on the element reads it as that save left it. */
const selectionAtTurn = (
  claim: TextWriteClaim,
  snapshot: DomEditSelection,
  build: UseDomEditTextCommitsParams["buildDomSelectionFromTarget"],
) => (claim.followed() ? selectionAsLanded(snapshot, build) : snapshot);

async function selectionAsLanded(
  snapshot: DomEditSelection,
  build: UseDomEditTextCommitsParams["buildDomSelectionFromTarget"],
): Promise<DomEditSelection> {
  const sealed = previewStandIn(snapshot.element);
  const target = sealed
    ? (await describePreviewElements(sealed.iframe, [sealed.handle]))?.[0]
    : snapshot.element;
  const fresh = target ? await build(target, { exactTarget: true, skipSourceProbe: true }) : null;
  return fresh?.element === snapshot.element ? fresh : snapshot;
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
  reloadPreview,
}: UseDomEditTextCommitsParams) {
  const latestRef = useRef({ readOnlyPreview, selection: domEditSelection });
  latestRef.current = { readOnlyPreview, selection: domEditSelection };
  const writesRef = useRef<TextSaveBookkeeping>({
    text: textWriteOrder(),
    newestFieldSave: new Map(),
    styleVersions: new Map(),
  });

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
          versions: writesRef.current.styleVersions,
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

  const commitTextForSelection = useCallback(
    async (
      selection: DomEditSelection,
      value: string,
      fieldKey?: string,
    ): Promise<DomEditCommitOutcome> => {
      if (!isTextEditableSelection(selection)) {
        return domEditCommitDeclined("not-text-editable");
      }
      const ending = endInlineEditOn(selection.element);
      const number = nextTextSaveOrder();
      const field = `${getDomEditTargetKey(selection)}|${fieldKey ?? ""}`;
      writesRef.current.newestFieldSave.set(field, number);
      await ending;
      const claim = claimTextFor(
        writesRef.current.text,
        selection.element,
        getDomEditTargetKey(selection),
        number,
        true,
      );
      if (!claim) return { ok: true, changed: false };
      await claim.turn();
      const landed = await selectionAtTurn(claim, selection, buildDomSelectionFromTarget);
      const nextTextFields = buildNextDomTextFields(landed.textFields, value, fieldKey);
      const textCommit = planDomTextCommit(landed.textFields, nextTextFields, value);
      const write = textWriteSteps({
        iframe: previewIframeRef.current,
        selection: landed,
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
        reloadFromFile: () => drawFileAgain(reloadPreview),
      });

      return runReportedDomEditCommit({
        ...write.steps,
        persist: () =>
          claim.write(async () => {
            const save = fieldSave(writesRef.current.newestFieldSave, field, number);
            const result = await afterSealedDraw(write.sealedEdit(), (drawn) =>
              persistDomEditOperations(landed, textCommit.operations, {
                label: "Edit text",
                skipRefresh: drawn,
                shouldSave: save.shouldSave,
              }),
            );
            if (save.landed()) claim.landed(write.drawn());
            save.done();
            return result;
          }),
      });
    },
    [
      activeCompPath,
      applyDomSelection,
      buildDomSelectionFromTarget,
      persistDomEditOperations,
      previewIframeRef,
      refreshDomEditSelectionFromPreview,
      reloadPreview,
      showToast,
    ],
  );

  const handleDomTextCommitForSelection = useCallback(
    (selection: DomEditSelection, value: string, fieldKey?: string) =>
      queueTextSave(selection.element, commitTextForSelection(selection, value, fieldKey)),
    [commitTextForSelection],
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
      // Back to what reached the file, only over this save's own draft; with nothing saved yet, the file drawn again.
      const putBack = () => {
        const back = landedTextFor(element);
        if (back === undefined) return drawFileAgain(reloadPreview);
        if (sealed)
          void editPreviewElement(sealed.iframe, sealed.handle, { html: back, expect: html });
        else if (element.isConnected && element.innerHTML === html) element.innerHTML = back;
      };
      if (latestRef.current.readOnlyPreview) return putBack();
      const refuse = (reason: string) => {
        console.error("[Studio] text edit not saved:", reason, element);
        showToast(textEditNotSaved(reason), "error");
        if (reason !== GONE) putBack();
      };
      const doc = previewIframeRef.current?.contentDocument;
      const selection = sealed
        ? await sealedInlineTextSelection(element, sealed, buildDomSelectionFromTarget)
        : await liveInlineTextSelection(element, doc, buildDomSelectionFromTarget);
      if (typeof selection === "string") return refuse(selection);
      const claim = claimTextFor(
        writesRef.current.text,
        element,
        getDomEditTargetKey(selection),
        number,
      );
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
          const result = await claim.write(async () => {
            const saved = await persistDomEditOperations(selection, operations, {
              label: "Edit text",
              skipRefresh: true,
              shouldSave: claim.shouldSave,
            });
            claim.landed(html);
            return saved;
          });
          if (result?.changed) trackPreviewFeatureUsed("text_edit", "field");
        },
        shouldRevert: () => claim(),
        revert: putBack,
        onError: (error) => reportDomEditPersistFailure(selection, operations, error, showToast),
        // Re-select only what is still selected: the selection may have moved on, or a host cleared it.
        shouldResync: () => claim() && latestRef.current.selection?.element === element,
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
      reloadPreview,
      showToast,
    ],
  );

  const handleDomRichTextCommit = useCallback(
    (commit: InlineTextEditCommit) =>
      commitRichText(
        commit.element,
        commit.html,
        commit.previousHtml,
        requestedOrder(commit) ?? nextTextSaveOrder(),
      ),
    [commitRichText],
  );

  const commitTextFields = useCallback(
    async (
      snapshot: DomEditSelection,
      change: (fields: DomEditTextField[]) => DomEditTextField[],
      options?: { importedFont?: ImportedFontAsset | null; fontFamily?: boolean },
    ) => {
      const ending = endInlineEditOn(snapshot.element);
      const number = nextTextSaveOrder();
      await ending;
      const claim = claimTextFor(
        writesRef.current.text,
        snapshot.element,
        getDomEditTargetKey(snapshot),
        number,
        true,
      );
      if (!claim) return;
      await claim.turn();
      const selection = await selectionAtTurn(claim, snapshot, buildDomSelectionFromTarget);
      const nextTextFields = change(selection.textFields);
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
        reloadFromFile: () => drawFileAgain(reloadPreview),
      });

      await runDomEditCommit({
        ...write.steps,
        persist: async () => {
          const sealedFontNeedsReload = Boolean(write.sealedEdit() && options?.fontFamily);
          await claim.write(async () => {
            await afterSealedDraw(write.sealedEdit(), (drawn) =>
              persistDomEditOperations(selection, textCommit.operations, {
                label: "Edit text",
                skipRefresh: drawn && !sealedFontNeedsReload,
                importedFont: importedFont ?? undefined,
              }),
            );
            claim.landed(write.drawn());
          });
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
      reloadPreview,
      showToast,
    ],
  );

  const commitDomTextFields = useCallback(
    (
      snapshot: DomEditSelection,
      change: (fields: DomEditTextField[]) => DomEditTextField[],
      options?: { importedFont?: ImportedFontAsset | null; fontFamily?: boolean },
    ) => queueTextSave(snapshot.element, commitTextFields(snapshot, change, options)),
    [commitTextFields],
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
      const styled = (fields: DomEditTextField[]) =>
        fields.map((entry) =>
          entry.key === fieldKey
            ? {
                ...entry,
                inlineStyles: { ...entry.inlineStyles, [property]: normalizedValue },
                computedStyles: { ...entry.computedStyles, [property]: normalizedValue },
              }
            : entry,
        );

      await commitDomTextFields(domEditSelection, styled, {
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

      let added: string | null = null;
      await commitDomTextFields(domEditSelection, (fields) => {
        const insertionIndex = fields.findIndex((field) => field.key === afterFieldKey);
        const nextField = buildDefaultDomEditTextField(
          fields[insertionIndex >= 0 ? insertionIndex : 0] ?? fields[0],
        );
        added = nextField.key;
        const next = [...fields];
        next.splice(insertionIndex >= 0 ? insertionIndex + 1 : next.length, 0, nextField);
        return next;
      });
      return added;
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

      await commitDomTextFields(domEditSelection, (fields) =>
        fields.filter((entry) => entry.key !== fieldKey),
      );
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
