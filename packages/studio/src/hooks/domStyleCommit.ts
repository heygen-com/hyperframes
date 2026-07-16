/** Per-target DOM style commit machinery shared by the single-selection and
 * batch commit paths in useDomEditTextCommits (extracted for the file-size cap;
 * behavior is identical to the inline original). */
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
  findElementForSelection,
  getDomEditTargetKey,
  type DomEditTextField,
  type DomEditSelection,
} from "../components/editor/domEditing";
import type { ImportedFontAsset } from "../components/editor/fontAssets";
import type { PersistDomEditOperations } from "./domEditCommitTypes";
import { reportDomEditPersistFailure } from "./domEditPersistFailure";
import { bumpDomEditCommitMapVersion, runDomEditCommit } from "./domEditCommitRunner";
import { applyAuthoredInlineOpacity, readStampedAuthoredOpacity } from "../utils/authoredOpacity";

interface DomStyleCommitPlan {
  operations: PatchOperation[];
  isImageBackgroundCommit: boolean;
}

export interface DomStyleCommitHistoryOptions {
  coalesceKey: string;
  coalesceMs: number;
}

export type DomStyleUpdate = [property: string, value: string | null];
export type DomStyleBatchUpdateBuilder = (selection: DomEditSelection) => DomStyleUpdate[];
export type DomStyleBatchCommitArgs =
  | [selections: DomEditSelection[], property: string, value: string | null]
  | [selections: DomEditSelection[], buildUpdates: DomStyleBatchUpdateBuilder];

interface RunDomStyleCommitParams {
  selection: DomEditSelection;
  property: string;
  value: string | null;
  activeCompPath: string | null;
  doc: Document | null | undefined;
  commitVersions: Map<string, number>;
  persistDomEditOperations: PersistDomEditOperations;
  refreshDomEditSelectionFromPreview: (selection: DomEditSelection) => void;
  resolveImportedFontAsset: (fontFamilyValue: string) => ImportedFontAsset | null;
  showToast: (message: string, tone?: "error" | "info") => void;
  historyOptions?: DomStyleCommitHistoryOptions;
}

let domStyleBatchCommitCounter = 0;

/** Mint a per-batch coalesce key so a whole batch collapses to one undo entry. */
export function nextDomStyleBatchCoalesceKey(): string {
  return `batch-style:${++domStyleBatchCommitCounter}`;
}

function buildDomStyleCommitPlan(property: string, value: string | null): DomStyleCommitPlan {
  const isImageBackgroundCommit =
    value !== null && property === "background-image" && isImageBackgroundValue(value);
  const operations: PatchOperation[] = [buildDomEditStylePatchOperation(property, value)];
  if (isImageBackgroundCommit) {
    operations.push(
      buildDomEditStylePatchOperation("background-position", "center"),
      buildDomEditStylePatchOperation("background-repeat", "no-repeat"),
      buildDomEditStylePatchOperation("background-size", "contain"),
    );
  }
  return { operations, isImageBackgroundCommit };
}

export function resolveNullableDomStyleValue(
  property: string,
  value: string | null,
  resolveImportedFontAsset: (fontFamilyValue: string) => ImportedFontAsset | null,
): { normalizedValue: string | null; importedFont: ImportedFontAsset | null } {
  return {
    normalizedValue: value === null ? null : normalizeDomEditStyleValue(property, value),
    importedFont:
      property === "font-family" && value !== null ? resolveImportedFontAsset(value) : null,
  };
}

export function injectPreviewFontForStyle(
  doc: Document | null | undefined,
  property: string,
  value: string | null,
  importedFont: ImportedFontAsset | null,
): void {
  if (!doc || property !== "font-family" || value === null) return;

  injectPreviewGoogleFont(doc, value);
  if (importedFont) injectPreviewImportedFont(doc, importedFont);
}

function applyNullableStyleValue(
  element: HTMLElement,
  property: string,
  value: string | null,
  computedStyles: Record<string, string>,
  doc: Document | null | undefined,
): void {
  if (value !== null) {
    element.style.setProperty(property, value);
    computedStyles[property] = value;
    return;
  }

  const authoredOpacity = property === "opacity" ? readStampedAuthoredOpacity(element) : null;
  if (authoredOpacity !== null) {
    applyAuthoredInlineOpacity(element.style, authoredOpacity);
    if (authoredOpacity === "") delete computedStyles[property];
    else computedStyles[property] = authoredOpacity;
    return;
  }

  element.style.removeProperty(property);
  // The panel reads this exact snapshot synchronously, so keep coupled
  // style builders fresh while persistence is still pending.
  const authoredValue = doc?.defaultView?.getComputedStyle(element).getPropertyValue(property);
  if (authoredValue === undefined) {
    delete computedStyles[property];
    return;
  }
  computedStyles[property] = authoredValue;
}

export function buildNextDomTextFieldStyle(
  field: DomEditTextField,
  fieldKey: string,
  property: string,
  value: string | null,
): DomEditTextField {
  if (field.key !== fieldKey) return field;

  const inlineStyles = { ...field.inlineStyles };
  const computedStyles = { ...field.computedStyles };
  if (value === null) {
    delete inlineStyles[property];
    delete computedStyles[property];
  } else {
    inlineStyles[property] = value;
    computedStyles[property] = value;
  }
  return { ...field, inlineStyles, computedStyles };
}

export async function runDomStyleSelectionCommit({
  selection,
  property,
  value,
  activeCompPath,
  doc,
  commitVersions,
  persistDomEditOperations,
  refreshDomEditSelectionFromPreview,
  resolveImportedFontAsset,
  showToast,
  historyOptions,
}: RunDomStyleCommitParams): Promise<void> {
  if (isManualGeometryStyleProperty(property)) return;
  if (!selection.capabilities.canEditStyles) return;
  const styleCommitKey = `${getDomEditTargetKey(selection)}:${property}`;
  const isLatestStyleCommit = bumpDomEditCommitMapVersion(commitVersions, styleCommitKey);
  const { normalizedValue, importedFont } = resolveNullableDomStyleValue(
    property,
    value,
    resolveImportedFontAsset,
  );
  let editedElement: HTMLElement | null = null;
  let previousInlineValue: string | null = null;
  let previousComputedValue: string | undefined;
  const { operations, isImageBackgroundCommit } = buildDomStyleCommitPlan(
    property,
    normalizedValue,
  );

  await runDomEditCommit({
    capture: () => {
      if (!doc) return;
      const el = findElementForSelection(doc, selection, activeCompPath);
      if (!el) return;
      editedElement = el;
      previousInlineValue = el.style.getPropertyValue(property);
      previousComputedValue = selection.computedStyles[property];
    },
    apply: () => {
      if (!editedElement) return;
      applyNullableStyleValue(
        editedElement,
        property,
        normalizedValue,
        selection.computedStyles,
        doc,
      );
      injectPreviewFontForStyle(doc, property, value, importedFont);
      if (isImageBackgroundCommit) {
        editedElement.style.setProperty("background-position", "center");
        editedElement.style.setProperty("background-repeat", "no-repeat");
        editedElement.style.setProperty("background-size", "contain");
      }
    },
    persist: () =>
      persistDomEditOperations(selection, operations, {
        label: "Edit layer style",
        skipRefresh: true,
        ...historyOptions,
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
      if (previousComputedValue === undefined) {
        delete selection.computedStyles[property];
      } else {
        selection.computedStyles[property] = previousComputedValue;
      }
    },
    onError: (error) => reportDomEditPersistFailure(selection, operations, error, showToast),
    shouldResync: isLatestStyleCommit,
    resync: () => refreshDomEditSelectionFromPreview(selection),
  });
}
