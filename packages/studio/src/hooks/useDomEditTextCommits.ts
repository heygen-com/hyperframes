import { useCallback, useRef } from "react";
import type { PatchOperation } from "../utils/sourcePatcher";
import { ensureImportedFontFace } from "../utils/studioFontHelpers";
import {
  buildDomEditTextPatchOperation,
  findElementForSelection,
  isTextEditableSelection,
  serializeDomEditTextFields,
  buildDefaultDomEditTextField,
  type DomEditTextField,
  type DomEditSelection,
} from "../components/editor/domEditing";
import type { ImportedFontAsset } from "../components/editor/fontAssets";
import type { PersistDomEditOperations } from "./domEditCommitTypes";
import { buildTextFieldChildOperations } from "./domEditTextFieldCommitOps";
import {
  DomEditPersistUnsupportedTextStructureError,
  reportDomEditPersistFailure,
} from "./domEditPersistFailure";
import { bumpDomEditCommitVersion, runDomEditCommit } from "./domEditCommitRunner";
import { useDomEditAttributeCommits } from "./useDomEditAttributeCommits";
import {
  buildNextDomTextFieldStyle,
  injectPreviewFontForStyle,
  nextDomStyleBatchCoalesceKey,
  resolveNullableDomStyleValue,
  runDomStyleSelectionCommit,
  type DomStyleCommitHistoryOptions,
} from "./domStyleCommit";

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
  buildDomSelectionFromTarget: (
    target: HTMLElement,
    options?: { preferClipAncestor?: boolean },
  ) => Promise<DomEditSelection | null>;
  persistDomEditOperations: PersistDomEditOperations;
  queueDomEditSave: (save: () => Promise<void>) => Promise<void>;
  resolveImportedFontAsset: (fontFamilyValue: string) => ImportedFontAsset | null;
}

interface DomTextCommitPlan {
  usesSerializedTextFields: boolean;
  nextContent: string;
  childOperations: PatchOperation[] | null;
  operations: PatchOperation[];
}

function buildNextDomTextFields(
  textFields: DomEditTextField[],
  value: string,
  fieldKey?: string,
): DomEditTextField[] {
  if (textFields.length === 0) return [];
  return textFields.map((field) => (field.key === fieldKey ? { ...field, value } : field));
}

function planDomTextCommit(
  originalTextFields: DomEditTextField[],
  nextTextFields: DomEditTextField[],
  plainTextContent: string,
): DomTextCommitPlan {
  const usesSerializedTextFields =
    nextTextFields.length > 1 || nextTextFields.some((field) => field.source === "child");
  const nextContent = usesSerializedTextFields
    ? serializeDomEditTextFields(nextTextFields)
    : plainTextContent;
  const childOperations = usesSerializedTextFields
    ? buildTextFieldChildOperations(originalTextFields, nextTextFields)
    : null;
  const operations =
    childOperations ??
    (usesSerializedTextFields ? [] : [buildDomEditTextPatchOperation(nextContent)]);

  return {
    usesSerializedTextFields,
    nextContent,
    childOperations,
    operations,
  };
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
  const nextSelection = await buildDomSelectionFromTarget(refreshed);
  if (!nextSelection) return;
  applyDomSelection(nextSelection, { revealPanel: false, preserveGroup: true });
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
  queueDomEditSave,
  resolveImportedFontAsset,
}: UseDomEditTextCommitsParams) {
  const domTextCommitVersionRef = useRef(0);
  const domStyleCommitVersionRef = useRef(new Map<string, number>());
  const queuedPersistDomEditOperations: PersistDomEditOperations = useCallback(
    (selection, operations, options) =>
      queueDomEditSave(() => persistDomEditOperations(selection, operations, options)),
    [persistDomEditOperations, queueDomEditSave],
  );

  const {
    handleDomAttributeCommit,
    handleDomAttributeLiveCommit,
    handleDomHtmlAttributeCommit,
    handleDomAttributesCommit,
  } = useDomEditAttributeCommits({
    activeCompPath,
    previewIframeRef,
    showToast,
    domEditSelection,
    refreshDomEditSelectionFromPreview,
    persistDomEditOperations: queuedPersistDomEditOperations,
  });

  const commitDomStyleSelection = useCallback(
    (
      selection: DomEditSelection,
      property: string,
      value: string | null,
      historyOptions?: DomStyleCommitHistoryOptions,
    ) =>
      runDomStyleSelectionCommit({
        selection,
        property,
        value,
        activeCompPath,
        doc: previewIframeRef.current?.contentDocument,
        commitVersions: domStyleCommitVersionRef.current,
        persistDomEditOperations: queuedPersistDomEditOperations,
        refreshDomEditSelectionFromPreview,
        resolveImportedFontAsset,
        showToast,
        historyOptions,
      }),
    [
      activeCompPath,
      previewIframeRef,
      queuedPersistDomEditOperations,
      refreshDomEditSelectionFromPreview,
      resolveImportedFontAsset,
      showToast,
    ],
  );

  const handleDomStyleCommit = useCallback(
    async (property: string, value: string | null) => {
      if (!domEditSelection) return;
      await commitDomStyleSelection(domEditSelection, property, value);
    },
    [commitDomStyleSelection, domEditSelection],
  );

  const handleDomStyleBatchCommit = useCallback(
    async (selections: DomEditSelection[], property: string, value: string | null) => {
      const historyOptions = {
        coalesceKey: nextDomStyleBatchCoalesceKey(),
        coalesceMs: Number.POSITIVE_INFINITY,
      };
      await Promise.all(
        selections.map((selection) =>
          commitDomStyleSelection(selection, property, value, historyOptions),
        ),
      );
    },
    [commitDomStyleSelection],
  );

  const handleDomTextCommit = useCallback(
    async (value: string, fieldKey?: string) => {
      if (!domEditSelection) return;
      if (!isTextEditableSelection(domEditSelection)) return;
      const isLatestTextCommit = bumpDomEditCommitVersion(domTextCommitVersionRef);
      const nextTextFields = buildNextDomTextFields(domEditSelection.textFields, value, fieldKey);
      const textCommit = planDomTextCommit(domEditSelection.textFields, nextTextFields, value);
      const iframe = previewIframeRef.current;
      const doc = iframe?.contentDocument;
      let editedElement: HTMLElement | null = null;
      let previousInnerHtml: string | null = null;

      await runDomEditCommit({
        capture: () => {
          if (!doc) return;
          const el = findElementForSelection(doc, domEditSelection, activeCompPath);
          if (!el) return;
          editedElement = el;
          previousInnerHtml = el.innerHTML;
        },
        apply: () => {
          if (!editedElement) return;
          if (textCommit.usesSerializedTextFields) {
            editedElement.innerHTML = textCommit.nextContent;
          } else {
            editedElement.textContent = value;
          }
        },
        persist: async () => {
          if (textCommit.usesSerializedTextFields && textCommit.childOperations === null) {
            throw new DomEditPersistUnsupportedTextStructureError();
          }
          await queuedPersistDomEditOperations(domEditSelection, textCommit.operations, {
            label: "Edit text",
            skipRefresh: true,
            shouldSave: isLatestTextCommit,
          });
        },
        shouldRevert: () => isLatestTextCommit(),
        revert: () => {
          if (!editedElement || previousInnerHtml === null) return;
          editedElement.innerHTML = previousInnerHtml;
        },
        onError: (error) =>
          reportDomEditPersistFailure(domEditSelection, textCommit.operations, error, showToast),
        shouldResync: isLatestTextCommit,
        resync: () =>
          resyncDomTextSelectionFromPreview(
            doc,
            domEditSelection,
            activeCompPath,
            buildDomSelectionFromTarget,
            applyDomSelection,
          ),
      });
    },
    [
      activeCompPath,
      applyDomSelection,
      buildDomSelectionFromTarget,
      domEditSelection,
      previewIframeRef,
      queuedPersistDomEditOperations,
      showToast,
    ],
  );

  const commitDomTextFields = useCallback(
    async (
      selection: DomEditSelection,
      nextTextFields: DomEditTextField[],
      options?: { importedFont?: ImportedFontAsset | null },
    ) => {
      const isLatestTextCommit = bumpDomEditCommitVersion(domTextCommitVersionRef);
      const textCommit = planDomTextCommit(
        selection.textFields,
        nextTextFields,
        nextTextFields[0]?.value ?? "",
      );
      const iframe = previewIframeRef.current;
      const doc = iframe?.contentDocument;
      let editedElement: HTMLElement | null = null;
      let previousInnerHtml: string | null = null;
      const importedFont = options?.importedFont ?? null;

      await runDomEditCommit({
        capture: () => {
          if (!doc) return;
          const el = findElementForSelection(doc, selection, activeCompPath);
          if (!el) return;
          editedElement = el;
          previousInnerHtml = el.innerHTML;
        },
        apply: () => {
          if (!editedElement) return;
          if (textCommit.usesSerializedTextFields) {
            editedElement.innerHTML = textCommit.nextContent;
          } else {
            editedElement.textContent = textCommit.nextContent;
          }
        },
        persist: async () => {
          if (textCommit.usesSerializedTextFields && textCommit.childOperations === null) {
            throw new DomEditPersistUnsupportedTextStructureError();
          }
          await queuedPersistDomEditOperations(selection, textCommit.operations, {
            label: "Edit text",
            skipRefresh: true,
            prepareContent: importedFont
              ? (html, sourceFile) => ensureImportedFontFace(html, importedFont, sourceFile)
              : undefined,
          });
        },
        shouldRevert: () => isLatestTextCommit(),
        revert: () => {
          if (!editedElement || previousInnerHtml === null) return;
          editedElement.innerHTML = previousInnerHtml;
        },
        onError: (error) =>
          reportDomEditPersistFailure(selection, textCommit.operations, error, showToast),
        shouldResync: isLatestTextCommit,
        resync: () =>
          resyncDomTextSelectionFromPreview(
            doc,
            selection,
            activeCompPath,
            buildDomSelectionFromTarget,
            applyDomSelection,
          ),
      });
    },
    [
      activeCompPath,
      applyDomSelection,
      buildDomSelectionFromTarget,
      previewIframeRef,
      queuedPersistDomEditOperations,
      showToast,
    ],
  );

  const handleDomTextFieldStyleCommit = useCallback(
    async (fieldKey: string, property: string, value: string | null) => {
      if (!domEditSelection) return;
      const field = domEditSelection.textFields.find((entry) => entry.key === fieldKey);
      if (!field) return;

      if (field.source === "self") {
        await handleDomStyleCommit(property, value);
        return;
      }

      const { normalizedValue, importedFont } = resolveNullableDomStyleValue(
        property,
        value,
        resolveImportedFontAsset,
      );
      injectPreviewFontForStyle(
        previewIframeRef.current?.contentDocument,
        property,
        normalizedValue,
        importedFont,
      );
      const nextTextFields = domEditSelection.textFields.map((entry) =>
        buildNextDomTextFieldStyle(entry, fieldKey, property, normalizedValue),
      );

      await commitDomTextFields(domEditSelection, nextTextFields, { importedFont });
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
    handleDomStyleBatchCommit,
    handleDomAttributeCommit,
    handleDomAttributeLiveCommit,
    handleDomHtmlAttributeCommit,
    handleDomAttributesCommit,
    handleDomTextCommit,
    commitDomTextFields,
    handleDomTextFieldStyleCommit,
    handleDomAddTextField,
    handleDomRemoveTextField,
  };
}
