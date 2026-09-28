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
  type DomEditSelection,
} from "../components/editor/domEditing";
import type { ImportedFontAsset } from "../components/editor/fontAssets";
import type { PersistDomEditOperations } from "./domEditCommitTypes";
import { reportDomEditPersistFailure } from "./domEditPersistFailure";
import {
  bumpDomEditCommitMapVersion,
  domEditCommitDeclined,
  runReportedDomEditCommit,
  type DomEditCommitOutcome,
} from "./domEditCommitRunner";

const IMAGE_BACKGROUND_FIT: Array<[string, string]> = [
  ["background-position", "center"],
  ["background-repeat", "no-repeat"],
  ["background-size", "contain"],
];

export interface DomStyleCommitContext {
  activeCompPath: string | null;
  previewIframeRef: React.RefObject<HTMLIFrameElement | null>;
  persistDomEditOperations: PersistDomEditOperations;
  showToast: (message: string, tone?: "error" | "info") => void;
  /** Latest-commit versions per target and property set; keep one map per caller. */
  versions: Map<string, symbol>;
  resolveImportedFontAsset?: (fontFamilyValue: string) => ImportedFontAsset | null;
  resync?: (selection: DomEditSelection) => void;
}

/** Applies inline styles live and saves them as one source patch and one undo step. */
// fallow-ignore-next-line complexity
export function commitDomStyles(
  context: DomStyleCommitContext,
  selection: DomEditSelection,
  styles: Record<string, string>,
): Promise<DomEditCommitOutcome> {
  const entries = Object.entries(styles);
  if (entries.length === 0) return Promise.resolve(domEditCommitDeclined("no-selection"));
  if (entries.some(([property]) => isManualGeometryStyleProperty(property)))
    return Promise.resolve(domEditCommitDeclined("geometry-property"));
  if (!selection.capabilities.canEditStyles)
    return Promise.resolve(domEditCommitDeclined("styles-not-editable"));

  const { activeCompPath, previewIframeRef, persistDomEditOperations, showToast } = context;
  const commitKey = `${getDomEditTargetKey(selection)}:${entries
    .map(([p]) => p)
    .sort()
    .join(",")}`;
  const isLatestStyleCommit = bumpDomEditCommitMapVersion(context.versions, commitKey);
  const fontFamily = styles["font-family"];
  const importedFont =
    fontFamily !== undefined ? (context.resolveImportedFontAsset?.(fontFamily) ?? null) : null;
  const doc = previewIframeRef.current?.contentDocument;
  const operations: PatchOperation[] = [];
  const liveStyles: Array<[string, string]> = [];
  for (const [property, value] of entries) {
    const normalized = normalizeDomEditStyleValue(property, value);
    operations.push(buildDomEditStylePatchOperation(property, normalized));
    liveStyles.push([property, normalized]);
    if (property === "background-image" && isImageBackgroundValue(value)) {
      for (const [fit, fitValue] of IMAGE_BACKGROUND_FIT) {
        operations.push(buildDomEditStylePatchOperation(fit, fitValue));
        liveStyles.push([fit, fitValue]);
      }
    }
  }
  let editedElement: HTMLElement | null = null;
  const previousInline = new Map<string, string>();

  return runReportedDomEditCommit({
    capture: () => {
      const el = doc ? findElementForSelection(doc, selection, activeCompPath) : null;
      if (!el) return;
      editedElement = el;
      for (const [property] of entries)
        previousInline.set(property, el.style.getPropertyValue(property));
    },
    apply: () => {
      if (!editedElement) return;
      for (const [property, value] of liveStyles) editedElement.style.setProperty(property, value);
      if (fontFamily !== undefined && doc) {
        injectPreviewGoogleFont(doc, fontFamily);
        if (importedFont) injectPreviewImportedFont(doc, importedFont);
      }
    },
    persist: () =>
      persistDomEditOperations(selection, operations, {
        label: "Edit layer style",
        // Inline styles are already live, so a reload would only blank the preview.
        skipRefresh: true,
        prepareContent: importedFont
          ? (html, sourceFile) => ensureImportedFontFace(html, importedFont, sourceFile)
          : undefined,
      }),
    shouldRevert: () => isLatestStyleCommit(),
    revert: () => {
      const el = editedElement;
      if (!el) return;
      // ponytail: background-image fit styles are not reverted here.
      for (const [property, previous] of previousInline) {
        if (previous === "") el.style.removeProperty(property);
        else el.style.setProperty(property, previous);
      }
    },
    onError: (error) => reportDomEditPersistFailure(selection, operations, error, showToast),
    shouldResync: isLatestStyleCommit,
    resync: () => context.resync?.(selection),
    onFinally: isLatestStyleCommit.release,
  });
}
