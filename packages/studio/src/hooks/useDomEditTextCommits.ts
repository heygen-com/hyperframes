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

// ── Types ──

export interface UseDomEditTextCommitsParams {
  activeCompPath: string | null;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
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

function applyPreviewAttribute(
  doc: Document | null | undefined,
  selection: DomEditSelection,
  activeCompPath: string | null,
  attr: string,
  value: string | null,
  options: { prefixData?: boolean; removeFalse?: boolean } = {},
): void {
  if (!doc) return;
  const el = findElementForSelection(doc, selection, activeCompPath);
  if (!el) return;
  const fullAttr = options.prefixData && !attr.startsWith("data-") ? `data-${attr}` : attr;
  if (value === null || value === "" || (options.removeFalse && value === "false")) {
    el.removeAttribute(fullAttr);
  } else {
    el.setAttribute(fullAttr, value);
  }
}

interface DataAttributeCommitOptions {
  label: string;
  coalescePrefix: string;
  skipRefresh: boolean;
  warningMessage: string;
  refreshAfter?: boolean;
}

// ── Hook ──

export function useDomEditTextCommits({
  activeCompPath,
  previewIframeRef,
  domEditSelection,
  applyDomSelection,
  refreshDomEditSelectionFromPreview,
  buildDomSelectionFromTarget,
  persistDomEditOperations,
  resolveImportedFontAsset,
}: UseDomEditTextCommitsParams) {
  const domTextCommitVersionRef = useRef(0);

  const handleDomStyleCommit = useCallback(
    async (property: string, value: string) => {
      if (!domEditSelection) return;
      if (isManualGeometryStyleProperty(property)) return;
      if (!domEditSelection.capabilities.canEditStyles) return;
      const importedFont = property === "font-family" ? resolveImportedFontAsset(value) : null;
      const iframe = previewIframeRef.current;
      const doc = iframe?.contentDocument;
      if (doc) {
        const el = findElementForSelection(doc, domEditSelection, activeCompPath);
        if (el) {
          el.style.setProperty(property, normalizeDomEditStyleValue(property, value));
          if (property === "font-family") {
            injectPreviewGoogleFont(doc, value);
            if (importedFont) injectPreviewImportedFont(doc, importedFont);
          }
          if (property === "background-image" && isImageBackgroundValue(value)) {
            el.style.setProperty("background-position", "center");
            el.style.setProperty("background-repeat", "no-repeat");
            el.style.setProperty("background-size", "contain");
          }
        }
      }
      const operations: PatchOperation[] = [
        buildDomEditStylePatchOperation(property, normalizeDomEditStyleValue(property, value)),
      ];
      if (property === "background-image" && isImageBackgroundValue(value)) {
        operations.push(
          buildDomEditStylePatchOperation("background-position", "center"),
          buildDomEditStylePatchOperation("background-repeat", "no-repeat"),
          buildDomEditStylePatchOperation("background-size", "contain"),
        );
      }
      const skipRefresh = property !== "z-index";
      try {
        await persistDomEditOperations(domEditSelection, operations, {
          label: "Edit layer style",
          skipRefresh,
          prepareContent: importedFont
            ? (html, sourceFile) => ensureImportedFontFace(html, importedFont, sourceFile)
            : undefined,
        });
      } catch {}
      refreshDomEditSelectionFromPreview(domEditSelection);
    },
    [
      activeCompPath,
      domEditSelection,
      persistDomEditOperations,
      refreshDomEditSelectionFromPreview,
      resolveImportedFontAsset,
      previewIframeRef,
    ],
  );

  const commitDataAttribute = useCallback(
    async (attr: string, value: string | null, options: DataAttributeCommitOptions) => {
      if (!domEditSelection) return;
      const iframe = previewIframeRef.current;
      applyPreviewAttribute(
        iframe?.contentDocument,
        domEditSelection,
        activeCompPath,
        attr,
        value,
        {
          prefixData: true,
        },
      );
      const op: PatchOperation = { type: "attribute", property: attr, value };
      try {
        await persistDomEditOperations(domEditSelection, [op], {
          label: options.label,
          coalesceKey: `${options.coalescePrefix}:${attr}:${getDomEditTargetKey(domEditSelection)}`,
          skipRefresh: options.skipRefresh,
        });
      } catch {}
      if (options.refreshAfter) {
        refreshDomEditSelectionFromPreview(domEditSelection);
      }
    },
    [
      activeCompPath,
      domEditSelection,
      persistDomEditOperations,
      refreshDomEditSelectionFromPreview,
      previewIframeRef,
    ],
  );

  const handleDomAttributeCommit = useCallback(
    async (attr: string, value: string) => {
      await commitDataAttribute(attr, value, {
        label: `Edit ${attr.replace(/-/g, " ")}`,
        coalescePrefix: "attr",
        skipRefresh: false,
        warningMessage: "[Studio] Attribute persist failed:",
        refreshAfter: true,
      });
    },
    [commitDataAttribute],
  );

  const handleDomAttributeLiveCommit = useCallback(
    async (attr: string, value: string | null) => {
      await commitDataAttribute(attr, value, {
        label: `Edit ${attr.replace(/^(data-)?/, "").replace(/-/g, " ")}`,
        coalescePrefix: "attr-live",
        skipRefresh: true,
        warningMessage: "[Studio] Live attribute persist failed:",
      });
    },
    [commitDataAttribute],
  );

  const handleDomHtmlAttributeCommit = useCallback(
    async (attr: string, value: string | null) => {
      if (!domEditSelection) return;
      const iframe = previewIframeRef.current;
      applyPreviewAttribute(
        iframe?.contentDocument,
        domEditSelection,
        activeCompPath,
        attr,
        value,
        {
          removeFalse: true,
        },
      );
      const op: PatchOperation = { type: "html-attribute", property: attr, value };
      try {
        await persistDomEditOperations(domEditSelection, [op], {
          label: `Edit ${attr}`,
          coalesceKey: `html-attr:${attr}:${getDomEditTargetKey(domEditSelection)}`,
          skipRefresh: false,
        });
      } catch {}
      refreshDomEditSelectionFromPreview(domEditSelection);
    },
    [
      activeCompPath,
      domEditSelection,
      persistDomEditOperations,
      refreshDomEditSelectionFromPreview,
      previewIframeRef,
    ],
  );

  const handleDomTextCommit = useCallback(
    async (value: string, fieldKey?: string) => {
      if (!domEditSelection) return;
      if (!isTextEditableSelection(domEditSelection)) return;
      const commitVersion = domTextCommitVersionRef.current + 1;
      domTextCommitVersionRef.current = commitVersion;
      const nextTextFields =
        domEditSelection.textFields.length > 0
          ? domEditSelection.textFields.map((field) =>
              field.key === fieldKey ? { ...field, value } : field,
            )
          : [];
      const nextContent =
        nextTextFields.length > 1 || nextTextFields.some((field) => field.source === "child")
          ? serializeDomEditTextFields(nextTextFields)
          : value;
      const iframe = previewIframeRef.current;
      const doc = iframe?.contentDocument;
      if (doc) {
        const el = findElementForSelection(doc, domEditSelection, activeCompPath);
        if (el) {
          if (
            nextTextFields.length > 1 ||
            nextTextFields.some((field) => field.source === "child")
          ) {
            el.innerHTML = nextContent;
          } else {
            el.textContent = value;
          }
        }
      }
      await persistDomEditOperations(
        domEditSelection,
        [buildDomEditTextPatchOperation(nextContent)],
        {
          label: "Edit text",
          skipRefresh: true,
          shouldSave: () => domTextCommitVersionRef.current === commitVersion,
        },
      );
      if (domTextCommitVersionRef.current !== commitVersion) return;

      if (doc) {
        const refreshed = findElementForSelection(doc, domEditSelection, activeCompPath);
        if (refreshed) {
          const nextSelection = await buildDomSelectionFromTarget(refreshed);
          if (nextSelection) {
            applyDomSelection(nextSelection, { revealPanel: false, preserveGroup: true });
          }
        }
      }
    },
    [
      activeCompPath,
      applyDomSelection,
      buildDomSelectionFromTarget,
      domEditSelection,
      persistDomEditOperations,
      previewIframeRef,
    ],
  );

  const commitDomTextFields = useCallback(
    async (
      selection: DomEditSelection,
      nextTextFields: DomEditTextField[],
      options?: { importedFont?: ImportedFontAsset | null },
    ) => {
      const nextContent =
        nextTextFields.length > 1 || nextTextFields.some((field) => field.source === "child")
          ? serializeDomEditTextFields(nextTextFields)
          : (nextTextFields[0]?.value ?? "");

      const iframe = previewIframeRef.current;
      const doc = iframe?.contentDocument;
      if (doc) {
        const el = findElementForSelection(doc, selection, activeCompPath);
        if (el) {
          if (
            nextTextFields.length > 1 ||
            nextTextFields.some((field) => field.source === "child")
          ) {
            el.innerHTML = nextContent;
          } else {
            el.textContent = nextContent;
          }
        }
      }

      const importedFont = options?.importedFont ?? null;
      await persistDomEditOperations(selection, [buildDomEditTextPatchOperation(nextContent)], {
        label: "Edit text",
        skipRefresh: true,
        prepareContent: importedFont
          ? (html, sourceFile) => ensureImportedFontFace(html, importedFont, sourceFile)
          : undefined,
      });

      if (doc) {
        const refreshed = findElementForSelection(doc, selection, activeCompPath);
        if (refreshed) {
          const nextSelection = await buildDomSelectionFromTarget(refreshed);
          if (nextSelection) {
            applyDomSelection(nextSelection, { revealPanel: false, preserveGroup: true });
          }
        }
      }
    },
    [
      activeCompPath,
      applyDomSelection,
      buildDomSelectionFromTarget,
      persistDomEditOperations,
      previewIframeRef,
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
    handleDomTextCommit,
    commitDomTextFields,
    handleDomTextFieldStyleCommit,
    handleDomAddTextField,
    handleDomRemoveTextField,
  };
}
