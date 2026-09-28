import { buildProjectApiPath } from "../utils/projectRouting";
import { useCallback, useRef } from "react";
import { findUnsafeDomPatchValues } from "@hyperframes/core/studio-api/finite-mutation";
import { FONT_EXT } from "../utils/mediaTypes";

import { trackStudioEvent } from "../utils/studioTelemetry";
import { primaryFontFamilyValue } from "../utils/studioFontHelpers";
import { StudioSaveHttpError, trackStudioSaveFailure } from "../utils/studioSaveDiagnostics";
import { buildDomEditPatchTarget, type DomEditSelection } from "../components/editor/domEditing";
import { fontFamilyFromAssetPath, type ImportedFontAsset } from "../components/editor/fontAssets";
import type { CommitDomEditPatchBatches, PersistDomEditOperations } from "./domEditCommitTypes";
import type { PatchOperation } from "../utils/sourcePatcher";
import {
  DomEditPersistUnsafeValueError,
  DomEditPersistUnresolvableError,
  warnDomEditPersistNoOp,
} from "./domEditPersistFailure";
import { useDomEditPositionPatchCommit } from "./useDomEditPositionPatchCommit";
import { useDomEditTextCommits } from "./useDomEditTextCommits";
import { useDomGeometryCommits } from "./useDomGeometryCommits";
import { useElementLifecycleOps } from "./useElementLifecycleOps";
import {
  AtomicElementPatchConvergenceError,
  batchesAreInlineStyleOnly,
  formatUnsafeFieldList,
  patchElementBatches,
  postPatchElement,
  writePreparedContent,
} from "./useDomEditCommitsHelpers";
import type { CutoverResult } from "../utils/sdkCutover";
import { reseekPreviewRuntime } from "./timelineTrackVisibility";
import { serializeStudioFileMutations } from "../utils/studioFileMutationCoordinator";
import { readProjectFileContent } from "../utils/studioFileHistory";
interface RecordEditInput {
  label: string;
  coalesceKey?: string;
  coalesceMs?: number;
  files: Record<string, { before: string; after: string }>;
}

export interface UseDomEditCommitsParams {
  activeCompPath: string | null;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  showToast: (message: string, tone?: "error" | "info") => void;
  queueDomEditSave: <T>(save: () => Promise<T>) => Promise<T>;
  writeProjectFile: (path: string, content: string, expectedContent?: string) => Promise<void>;
  editHistory: { recordEdit: (entry: RecordEditInput) => Promise<void> };
  fileTree: string[];
  importedFontAssetsRef: React.MutableRefObject<ImportedFontAsset[]>;
  projectId: string | null;
  projectIdRef: React.MutableRefObject<string | null>;
  reloadPreview: () => void;

  // From useDomSelection
  domEditSelection: DomEditSelection | null;
  applyDomSelection: (
    selection: DomEditSelection | null,
    options?: { revealPanel?: boolean; additive?: boolean; preserveGroup?: boolean },
  ) => void;
  clearDomSelection: () => void;
  refreshDomEditSelectionFromPreview: (selection: DomEditSelection) => void;
  buildDomSelectionFromTarget: (
    target: HTMLElement,
    options?: { preferClipAncestor?: boolean },
  ) => Promise<DomEditSelection | null>;
  /** Resync the in-memory SDK session after a SERVER-side write (NOT the SDK
   * path, whose session is already current) so a later SDK edit doesn't
   * serialize the pre-write doc and revert the server's change. */
  forceReloadSdkSession?: () => void;
  /** Stage 7 Step 3c: called before the server-side patch path. */
  onTrySdkPersist?: (
    selection: DomEditSelection,
    operations: PatchOperation[],
    originalContent: string,
    targetPath: string,
    options?: { label?: string; coalesceKey?: string; skipRefresh?: boolean },
  ) => Promise<CutoverResult>;
  /** Stage 7 §3.1: called before the server-side delete path. */
  onTrySdkDelete?: (
    hfId: string,
    originalContent: string,
    targetPath: string,
  ) => Promise<CutoverResult>;
  /** Resolver-shadow tripwire for z-index reorder targets (telemetry-only, decoupled from cutover). */
  onReorderShadow?: (targets: string[]) => void;
  readOnlyPreview: boolean;
}

export function useDomEditCommits({
  activeCompPath,
  previewIframeRef,
  showToast,
  queueDomEditSave,
  writeProjectFile,
  editHistory,
  fileTree,
  importedFontAssetsRef,
  projectId,
  projectIdRef,
  reloadPreview,
  domEditSelection,
  applyDomSelection,
  clearDomSelection,
  refreshDomEditSelectionFromPreview,
  buildDomSelectionFromTarget,
  forceReloadSdkSession,
  onTrySdkPersist,
  onTrySdkDelete,
  onReorderShadow,
  readOnlyPreview,
}: UseDomEditCommitsParams) {
  const resolveImportedFontAsset = useCallback(
    (fontFamilyValue: string): ImportedFontAsset | null => {
      const family = primaryFontFamilyValue(fontFamilyValue);
      if (!family) return null;
      const imported = importedFontAssetsRef.current.find(
        (font) => font.family.toLowerCase() === family.toLowerCase(),
      );
      if (imported) return imported;
      const asset = fileTree.find(
        (path) =>
          FONT_EXT.test(path) &&
          fontFamilyFromAssetPath(path).toLowerCase() === family.toLowerCase(),
      );
      if (!asset || !projectId) return null;
      return {
        family: fontFamilyFromAssetPath(asset),
        path: asset,
        url: buildProjectApiPath(projectId, `/preview/${asset}`),
      };
    },
    [fileTree, projectId, importedFontAssetsRef],
  );

  const reportedUnresolvableRef = useRef(new Set<string>());

  // fallow-ignore-next-line complexity
  const performPersistDomEditOperations = useCallback(
    // fallow-ignore-next-line complexity
    async (
      selection: DomEditSelection,
      operations: PatchOperation[],
      options: Parameters<PersistDomEditOperations>[2],
      expectedProjectId: string,
    ) => {
      if (projectIdRef.current !== expectedProjectId) {
        throw new Error("Active project changed before the edit could be saved");
      }
      const pid = expectedProjectId;
      if (options?.shouldSave && !options.shouldSave()) return;

      const targetPath = selection.sourceFile || activeCompPath || "index.html";
      const completePersistence = <T>(result: T, changed: boolean): T => {
        if (options?.skipRefresh && changed) reseekPreviewRuntime(previewIframeRef.current);
        return result;
      };

      const readTarget = async (): Promise<string | null> => {
        const content = await readProjectFileContent(pid, targetPath);
        if (projectIdRef.current !== expectedProjectId) {
          throw new Error("Active project changed before the edit could be saved");
        }
        return options?.shouldSave && !options.shouldSave() ? null : content;
      };

      // Validate layout values BEFORE any persist path runs. The SDK cutover
      // path (onTrySdkPersist) returns early on success, so leaving this check
      // after it let invalid numeric values bypass the guard whenever the
      // cutover flag was on.
      const patchTarget = buildDomEditPatchTarget(selection);
      const patchBody = { target: patchTarget, operations };
      const unsafeFields = findUnsafeDomPatchValues(patchBody);
      if (unsafeFields.length > 0) {
        const fields = formatUnsafeFieldList(unsafeFields);
        showToast("Couldn't save edit because it contains invalid layout values", "error");
        throw new DomEditPersistUnsafeValueError(`DOM patch contains unsafe values: ${fields}`, {
          alreadyToasted: true,
        });
      }

      // Skip the SDK path when prepareContent is set (e.g. @font-face injection
      // for a custom font): sdkCutoverPersist serializes only the patched DOM
      // and would drop the injected content. Let the server path run prepareContent.
      // The SDK joins the file queue itself and re-reads there; this read is only its fallback.
      if (onTrySdkPersist && !options?.prepareContent) {
        const originalContent = await readTarget();
        if (originalContent === null) return;
        const cutover = await onTrySdkPersist(selection, operations, originalContent, targetPath, {
          label: options?.label,
          coalesceKey: options?.coalesceKey,
          skipRefresh: options?.skipRefresh,
        });
        if (cutover.status === "failed") throw cutover.error;
        if (cutover.status === "committed") {
          // SDK handled it — its in-memory doc is already current, so do NOT
          // forceReload (that would echo-reload the session we just wrote).
          return completePersistence(
            { sourceFile: targetPath, version: cutover.version, changed: true },
            true,
          );
        }
      }

      const history = {
        label: options?.label ?? "Edit layer",
        coalesceKey: options?.coalesceKey,
        coalesceMs: options?.coalesceMs,
      };
      const prepare = options?.prepareContent;
      // Read, server patch, follow-up write and history hold the file's queue, so no save lands between them.
      const saved = await serializeStudioFileMutations(writeProjectFile, [targetPath], async () => {
        const originalContent = await readTarget();
        if (originalContent === null) return null;
        const patchData = await postPatchElement(pid, targetPath, patchBody, showToast);
        if (!patchData.changed) return { patchData, patchedContent: null, finalContent: null };

        const patchedContent =
          typeof patchData.content === "string" ? patchData.content : originalContent;
        const finalContent = prepare
          ? await writePreparedContent(
              targetPath,
              patchedContent,
              prepare,
              writeProjectFile,
              showToast,
            )
          : patchedContent;

        await editHistory.recordEdit({
          ...history,
          files: { [targetPath]: { before: originalContent, after: finalContent } },
        });
        return { patchData, patchedContent, finalContent };
      });
      if (saved === null) return;
      const { patchData, patchedContent, finalContent } = saved;

      if (finalContent === null) {
        if (patchData.matched === false) {
          const targetKey = selection.selector ?? selection.id ?? "selection";
          if (!reportedUnresolvableRef.current.has(targetKey)) {
            reportedUnresolvableRef.current.add(targetKey);
            trackStudioEvent("save_skipped_unresolvable", {
              target_id: selection.id ?? undefined,
              target_selector: selection.selector ?? undefined,
              target_source_file: selection.sourceFile ?? undefined,
              composition: activeCompPath ?? undefined,
            });
          }
          throw new DomEditPersistUnresolvableError(targetPath);
        }
        warnDomEditPersistNoOp(selection, operations);
        return completePersistence(
          typeof patchData.path === "string" && typeof patchData.version === "string"
            ? { sourceFile: patchData.path, version: patchData.version, changed: false }
            : undefined,
          false,
        );
      }
      forceReloadSdkSession?.();

      if (!options?.skipRefresh) {
        reloadPreview();
      }
      return completePersistence(
        finalContent === patchedContent &&
          typeof patchData.path === "string" &&
          typeof patchData.version === "string"
          ? { sourceFile: patchData.path, version: patchData.version, changed: true }
          : undefined,
        true,
      );
    },
    [
      activeCompPath,
      editHistory,
      writeProjectFile,
      projectIdRef,
      reloadPreview,
      showToast,
      forceReloadSdkSession,
      onTrySdkPersist,
      previewIframeRef,
    ],
  );

  const persistDomEditOperations: PersistDomEditOperations = useCallback(
    (selection, operations, options) => {
      const expectedProjectId = projectIdRef.current;
      if (!expectedProjectId) return Promise.reject(new Error("No active project"));
      return queueDomEditSave(() =>
        performPersistDomEditOperations(selection, operations, options, expectedProjectId),
      );
    },
    [performPersistDomEditOperations, projectIdRef, queueDomEditSave],
  );

  const commitDomEditPatchBatches: CommitDomEditPatchBatches = useCallback(
    (batches, options) => {
      const expectedProjectId = projectIdRef.current;
      if (!expectedProjectId) return Promise.reject(new Error("No active project"));
      return queueDomEditSave(
        // One queued transaction owns validation, persistence, history, reload,
        // and its durable result; splitting those phases risks partial commits.
        // fallow-ignore-next-line complexity
        async () => {
          if (projectIdRef.current !== expectedProjectId) {
            throw new Error("Active project changed before the edit could be saved");
          }
          const pid = expectedProjectId;
          const unsafeFields = batches.flatMap((batch) =>
            batch.patches.flatMap((patch) => findUnsafeDomPatchValues(patch)),
          );
          if (unsafeFields.length > 0) {
            showToast("Couldn't save edit because it contains invalid layout values", "error");
            throw new DomEditPersistUnsafeValueError(
              `DOM patch contains unsafe values: ${formatUnsafeFieldList(unsafeFields)}`,
              { alreadyToasted: true },
            );
          }

          const sourceFiles = batches.map((batch) => batch.sourceFile);
          // The server patch and its history entry hold every touched file's queue.
          const { allMatched, changed } = await serializeStudioFileMutations(
            writeProjectFile,
            sourceFiles,
            async () => {
              const atomicResult = await patchElementBatches(pid, batches);
              const files = Object.fromEntries(
                atomicResult.files
                  .filter((result) => result.changed)
                  .map((result) => [
                    result.sourceFile,
                    { before: result.before, after: result.after },
                  ]),
              );
              const anyChanged = Object.keys(files).length > 0;
              if (anyChanged) {
                await editHistory.recordEdit({
                  label: options.label,
                  coalesceKey: options.coalesceKey,
                  coalesceMs: options.coalesceMs,
                  files,
                });
              }
              return {
                allMatched:
                  atomicResult.durable && atomicResult.files.every((result) => result.allMatched),
                changed: anyChanged,
              };
            },
          );
          if (changed) forceReloadSdkSession?.();
          const durable = allMatched;
          // A z-only reorder already applied its inline styles to the live iframe
          // DOM (and the store) synchronously, so remounting the iframe here only
          // produces a visible blink. Skip the reload when the caller asked for it
          // AND the persist is provably in sync: style-only ops, every target
          // matched. Any unmatched patch means the live DOM now shows state disk
          // doesn't hold — reload so the preview reconverges.
          const skipSafe =
            options.skipReload === true && batchesAreInlineStyleOnly(batches) && durable;
          if (!durable || (changed && !skipSafe)) reloadPreview();
          return { durable, allMatched, changed };
        },
      ).catch((error) => {
        if (error instanceof AtomicElementPatchConvergenceError) reloadPreview();
        const alreadyToasted =
          (error instanceof StudioSaveHttpError ||
            error instanceof DomEditPersistUnsafeValueError) &&
          error.alreadyToasted;
        if (!alreadyToasted) {
          showToast(error instanceof Error ? error.message : "Failed to reorder layers", "error");
        }
        trackStudioSaveFailure({
          source: "dom_edit",
          error,
          filePath: batches.map((batch) => batch.sourceFile).join(","),
          mutationType: "z-reorder",
          label: options.label,
        });
        throw error;
      });
    },
    [
      editHistory,
      forceReloadSdkSession,
      projectIdRef,
      queueDomEditSave,
      reloadPreview,
      showToast,
      writeProjectFile,
    ],
  );

  // ── Text & style commits (delegated to useDomEditTextCommits) ──

  const {
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
  } = useDomEditTextCommits({
    readOnlyPreview,
    activeCompPath,
    previewIframeRef,
    domEditSelection,
    applyDomSelection,
    refreshDomEditSelectionFromPreview,
    buildDomSelectionFromTarget,
    persistDomEditOperations,
    resolveImportedFontAsset,
    showToast,
  });

  // ── Position patch helper (shared by geometry + lifecycle hooks) ──

  const commitPositionPatchToHtml = useDomEditPositionPatchCommit({
    activeCompPath,
    persistDomEditOperations,
    showToast,
  });

  // ── Geometry commits (path offset, box size, rotation) ──

  const {
    handleDomPathOffsetCommit,
    handleDomBoxSizeCommit,
    handleDomRotationCommit,
    handleDomManualEditsReset,
  } = useDomGeometryCommits({
    previewIframeRef,
    showToast,
    commitPositionPatchToHtml,
    readOnlyPreview,
  });

  // ── Element lifecycle (delete, z-index reorder) ──

  const { handleDomEditElementsDelete, handleDomZIndexReorderCommit } = useElementLifecycleOps({
    activeCompPath,
    showToast,
    writeProjectFile,
    editHistory,
    projectIdRef,
    reloadPreview,
    clearDomSelection,
    onTrySdkDelete,
    onReorderShadow,
    forceReloadSdkSession,
    commitDomEditPatchBatches,
  });

  return {
    resolveImportedFontAsset,
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
    handleDomPathOffsetCommit,
    handleDomBoxSizeCommit,
    handleDomRotationCommit,
    handleDomManualEditsReset,
    handleDomEditElementsDelete,
    handleDomZIndexReorderCommit,
  };
}
