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
  buildDomEditRichTextPatchOperation,
  buildDomEditStylePatchOperation,
  findElementForSelection,
  getDomEditTargetKey,
  isTextEditableSelection,
  buildDefaultDomEditTextField,
  type DomEditTextField,
  type DomEditSelection,
} from "../components/editor/domEditing";
import type { ImportedFontAsset } from "../components/editor/fontAssets";
import type { PersistDomEditOperations } from "./domEditCommitTypes";
import { canEditElementTextInline } from "../components/editor/domEditInlineText";
import { buildNextDomTextFields, planDomTextCommit } from "./domEditTextCommitPlan";
import { reportDomEditPersistFailure } from "./domEditPersistFailure";
import {
  bumpDomEditCommitMapVersion,
  domEditCommitDeclined,
  runDomEditCommit,
  runReportedDomEditCommit,
  type DomEditCommitOutcome,
} from "./domEditCommitRunner";
import { useDomEditAttributeCommits } from "./useDomEditAttributeCommits";
import type { InlineTextEditCommit } from "./useInlineTextEdit";

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

function canCommitInlineTextSelection(selection: DomEditSelection, element: HTMLElement): boolean {
  if (selection.isCompositionHost || selection.isInsideLockedComposition) return false;
  return canEditElementTextInline(element);
}

function ownsCurrentPreviewElement(
  selection: DomEditSelection,
  element: HTMLElement,
  document: Document | null | undefined,
): document is Document {
  if (!document || !element.isConnected) return false;
  return element === selection.element && element.ownerDocument === document;
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
  const domTextCommitVersionRef = useRef(new Map<string, symbol>());
  const domStyleCommitVersionRef = useRef(new Map<string, symbol>());

  const {
    handleDomAttributeCommit,
    handleDomAttributeLiveCommit,
    handleDomAttributeQuietCommit,
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

  const handleDomStyleCommitForSelection = useCallback(
    async (
      selection: DomEditSelection,
      property: string,
      value: string,
    ): Promise<DomEditCommitOutcome> => {
      if (isManualGeometryStyleProperty(property))
        return domEditCommitDeclined("geometry-property");
      if (!selection.capabilities.canEditStyles) {
        return domEditCommitDeclined("styles-not-editable");
      }
      const styleCommitKey = `${getDomEditTargetKey(selection)}:${property}`;
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

      return runReportedDomEditCommit({
        capture: () => {
          if (!doc) return;
          const el = findElementForSelection(doc, selection, activeCompPath);
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
          persistDomEditOperations(selection, operations, {
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
        onError: (error) => reportDomEditPersistFailure(selection, operations, error, showToast),
        shouldResync: isLatestStyleCommit,
        resync: () => refreshDomEditSelectionFromPreview(selection),
        onFinally: isLatestStyleCommit.release,
      });
    },
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
      const isLatestTextCommit = bumpDomEditCommitMapVersion(
        domTextCommitVersionRef.current,
        getDomEditTargetKey(selection),
      );
      const nextTextFields = buildNextDomTextFields(selection.textFields, value, fieldKey);
      const textCommit = planDomTextCommit(selection.textFields, nextTextFields, value);
      const iframe = previewIframeRef.current;
      const doc = iframe?.contentDocument;
      let editedElement: HTMLElement | null = null;
      let previousInnerHtml: string | null = null;

      return runReportedDomEditCommit({
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
            editedElement.textContent = value;
          }
        },
        persist: () =>
          persistDomEditOperations(selection, textCommit.operations, {
            label: "Edit text",
            skipRefresh: true,
            shouldSave: isLatestTextCommit,
          }),
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
        onFinally: isLatestTextCommit.release,
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
  const handleDomRichTextCommit = useCallback(
    async ({ element, html, previousHtml }: InlineTextEditCommit) => {
      if (!domEditSelection) return;
      // The same gate that let the edit open, not the design panel's.
      //
      // The panel's rule is about its text fields, and it has none for an
      // element whose text contains a line break: a `<span>` holding `<br>`s
      // is not a leaf, so nothing inside is a field and the element reports no
      // editable text at all. Editing in place does not use fields — it
      // rewrites the element's own markup — so refusing on that rule refused
      // elements the caret had just been opened in, and every colour the user
      // chose was dropped on the way out with nothing said about it.
      if (!canCommitInlineTextSelection(domEditSelection, element)) return;
      const iframe = previewIframeRef.current;
      const doc = iframe?.contentDocument;
      // A preview reload replaces the document. Never resolve this commit onto
      // the replacement node: it did not own the edit or its rollback snapshot.
      if (!ownsCurrentPreviewElement(domEditSelection, element, doc)) return;
      const isLatestTextCommit = bumpDomEditCommitMapVersion(
        domTextCommitVersionRef.current,
        getDomEditTargetKey(domEditSelection),
      );
      const operations = [buildDomEditRichTextPatchOperation(html)];
      let appliedHtml = "";

      await runDomEditCommit({
        capture: () => {},
        apply: () => {
          // Idempotent: the caret put this there. Assigned anyway so a commit
          // raised from anywhere but the element itself still lands.
          element.innerHTML = html;
          appliedHtml = element.innerHTML;
        },
        persist: async () => {
          await persistDomEditOperations(domEditSelection, operations, {
            label: "Edit text",
            skipRefresh: true,
            shouldSave: isLatestTextCommit,
          });
        },
        shouldRevert: () => isLatestTextCommit(),
        revert: () => {
          // An external actor that changed the live node while the request was
          // in flight owns its new value; only roll back the value we submitted.
          if (element.isConnected && element.innerHTML === appliedHtml) {
            element.innerHTML = previousHtml;
          }
        },
        onError: (error) =>
          reportDomEditPersistFailure(domEditSelection, operations, error, showToast),
        shouldResync: isLatestTextCommit,
        resync: () =>
          resyncDomTextSelectionFromPreview(
            doc,
            domEditSelection,
            activeCompPath,
            buildDomSelectionFromTarget,
            applyDomSelection,
          ),
        onFinally: isLatestTextCommit.release,
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
      const isLatestTextCommit = bumpDomEditCommitMapVersion(
        domTextCommitVersionRef.current,
        getDomEditTargetKey(selection),
      );
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
        onFinally: isLatestTextCommit.release,
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
    handleDomStyleCommitForSelection,
    handleDomAttributeCommit,
    handleDomAttributeLiveCommit,
    handleDomAttributeQuietCommit,
    handleDomHtmlAttributeCommit,
    handleDomAttributesCommit,
    handleDomTextCommit,
    handleDomTextCommitForSelection,
    handleDomRichTextCommit,
    commitDomTextFields,
    handleDomTextFieldStyleCommit,
    handleDomAddTextField,
    handleDomRemoveTextField,
  };
}
