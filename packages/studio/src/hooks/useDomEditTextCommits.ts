import { useCallback, useRef } from "react";
import type { PatchOperation } from "../utils/sourcePatcher";
import {
  isImageBackgroundValue,
  isManualGeometryStyleProperty,
  normalizeDomEditStyleValue,
} from "../utils/studioHelpers";
import {
  injectPreviewGoogleFont,
  injectPreviewImportedFont,
  ensureImportedFontFace,
} from "../utils/studioFontHelpers";
import {
  buildDomEditStylePatchOperation,
  buildDomEditTextPatchOperation,
  findElementForSelection,
  getDomEditTargetKey,
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
import {
  bumpDomEditCommitMapVersion,
  bumpDomEditCommitVersion,
  runDomEditCommit,
} from "./domEditCommitRunner";
import { useDomEditAttributeCommits } from "./useDomEditAttributeCommits";

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
  resolveImportedFontAsset: (fontFamilyValue: string) => ImportedFontAsset | null;
}

interface DomTextCommitPlan {
  usesSerializedTextFields: boolean;
  nextContent: string;
  childOperations: PatchOperation[] | null;
  operations: PatchOperation[];
}

function buildDomStyleCommitOperations(
  property: string,
  value: string,
  isImageBackgroundCommit: boolean,
): PatchOperation[] {
  const operations: PatchOperation[] = [
    buildDomEditStylePatchOperation(property, normalizeDomEditStyleValue(property, value)),
  ];
  if (isImageBackgroundCommit) {
    operations.push(
      buildDomEditStylePatchOperation("background-position", "center"),
      buildDomEditStylePatchOperation("background-repeat", "no-repeat"),
      buildDomEditStylePatchOperation("background-size", "contain"),
    );
  }
  return operations;
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
  resolveImportedFontAsset,
}: UseDomEditTextCommitsParams) {
  const domTextCommitVersionRef = useRef(0);
  const domStyleCommitVersionRef = useRef(new Map<string, number>());

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
    persistDomEditOperations,
  });

  const handleDomStyleCommit = useCallback(
    async (property: string, value: string) => {
      if (!domEditSelection) return;
      if (isManualGeometryStyleProperty(property)) return;
      if (!domEditSelection.capabilities.canEditStyles) return;
      const styleCommitKey = `${getDomEditTargetKey(domEditSelection)}:${property}`;
      const isLatestStyleCommit = bumpDomEditCommitMapVersion(
        domStyleCommitVersionRef.current,
        styleCommitKey,
      );
      const importedFont = property === "font-family" ? resolveImportedFontAsset(value) : null;
      const iframe = previewIframeRef.current;
      const doc = iframe?.contentDocument;
      const normalizedValue = normalizeDomEditStyleValue(property, value);
      const isImageBackgroundCommit =
        property === "background-image" && isImageBackgroundValue(value);
      let editedElement: HTMLElement | null = null;
      let previousInlineValue: string | null = null;
      const operations = buildDomStyleCommitOperations(property, value, isImageBackgroundCommit);
      // Inline-style commits never full-reload the preview (that blanks the iframe
      // until it re-renders): the live element was already mutated optimistically in
      // apply(). z-index is no exception — setting `element.style.zIndex` restacks the
      // element in-browser immediately, so a reload would only cost a black blink.
      const skipRefresh = true;

      await runDomEditCommit({
        capture: () => {
          if (!doc) return;
          const el = findElementForSelection(doc, domEditSelection, activeCompPath);
          if (!el) return;
          editedElement = el;
          previousInlineValue = el.style.getPropertyValue(property);
        },
        apply: () => {
          if (!editedElement) return;
          editedElement.style.setProperty(property, normalizedValue);
          if (property === "font-family" && doc) {
            injectPreviewGoogleFont(doc, value);
            if (importedFont) injectPreviewImportedFont(doc, importedFont);
          }
          if (isImageBackgroundCommit) {
            editedElement.style.setProperty("background-position", "center");
            editedElement.style.setProperty("background-repeat", "no-repeat");
            editedElement.style.setProperty("background-size", "contain");
          }
        },
        persist: () =>
          persistDomEditOperations(domEditSelection, operations, {
            label: "Edit layer style",
            skipRefresh,
            prepareContent: importedFont
              ? (html, sourceFile) => ensureImportedFontFace(html, importedFont, sourceFile)
              : undefined,
          }),
        shouldRevert: () => isLatestStyleCommit(),
        revert: () => {
          if (!editedElement || previousInlineValue === null) return;
          // ponytail: background-image side-effect styles are not reverted here.
          if (previousInlineValue === "") {
            editedElement.style.removeProperty(property);
          } else {
            editedElement.style.setProperty(property, previousInlineValue);
          }
        },
        onError: (error) =>
          reportDomEditPersistFailure(domEditSelection, operations, error, showToast),
        shouldResync: isLatestStyleCommit,
        resync: () => refreshDomEditSelectionFromPreview(domEditSelection),
      });
    },
    [
      activeCompPath,
      domEditSelection,
      persistDomEditOperations,
      refreshDomEditSelectionFromPreview,
      resolveImportedFontAsset,
      showToast,
      previewIframeRef,
    ],
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
          await persistDomEditOperations(domEditSelection, textCommit.operations, {
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
      persistDomEditOperations,
      previewIframeRef,
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
          await persistDomEditOperations(selection, textCommit.operations, {
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
      persistDomEditOperations,
      previewIframeRef,
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
