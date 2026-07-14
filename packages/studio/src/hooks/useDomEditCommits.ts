import { useCallback, useRef } from "react";
import { findUnsafeDomPatchValues } from "@hyperframes/core/studio-api/finite-mutation";
import { FONT_EXT } from "../utils/mediaTypes";

import { trackStudioEvent } from "../utils/studioTelemetry";
import { primaryFontFamilyValue } from "../utils/studioFontHelpers";
import {
  createStudioSaveHttpError,
  StudioSaveHttpError,
  trackStudioSaveFailure,
} from "../utils/studioSaveDiagnostics";
import { buildDomEditPatchTarget, type DomEditSelection } from "../components/editor/domEditing";
import { fontFamilyFromAssetPath, type ImportedFontAsset } from "../components/editor/fontAssets";
import type { EditHistoryKind } from "../utils/editHistory";
import type {
  CommitDomEditPatchBatches,
  DomEditPatchBatch,
  PersistDomEditOperations,
} from "./domEditCommitTypes";
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
import { formatFieldsSuffix } from "./gsapScriptCommitHelpers";
import { readProjectFileContent } from "../utils/studioFileHistory";

// ── Helpers ──

function formatUnsafeFieldList(fields: Array<{ path: string }>): string {
  return fields.map((field) => field.path).join(", ");
}

function getErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readErrorResponseBody(
  response: Response,
): Promise<{ error?: string; fields?: string[] } | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  return (await response.json().catch(() => null)) as { error?: string; fields?: string[] } | null;
}

function formatPatchRejectionMessage(body: { error?: string; fields?: string[] } | null): string {
  if (!body?.error) return "Couldn't save edit";
  return `Couldn't save edit: ${body.error}${formatFieldsSuffix(body.fields)}`;
}

interface RecordEditInput {
  label: string;
  kind: EditHistoryKind;
  coalesceKey?: string;
  coalesceMs?: number;
  files: Record<string, { before: string; after: string }>;
}

/** Human-readable identifier for a batch patch target (for the unmatched warning). */
function describeBatchPatchTarget(patch: DomEditPatchBatch["patches"][number]): string {
  return patch.target.id ?? patch.target.hfId ?? patch.target.selector ?? "(unaddressed)";
}

/**
 * Surface server-reported unmatched patches. The matched subset already
 * persisted, so this must NOT throw (a throw would roll back applied state) —
 * warn and emit save-failure telemetry with a distinct reason instead.
 */
function reportUnmatchedBatchPatches(batch: DomEditPatchBatch, matched: boolean[]): void {
  const unmatchedIds = batch.patches
    .filter((_, index) => matched[index] === false)
    .map(describeBatchPatchTarget);
  if (unmatchedIds.length === 0) return;
  console.warn(
    `[studio] z-index reorder: server could not match ${unmatchedIds.length} patch target(s) in ` +
      `${batch.sourceFile} (their z-order will revert on reload):`,
    unmatchedIds.join(", "),
  );
  trackStudioSaveFailure({
    source: "dom_edit",
    error: new Error(`Batch patch target(s) unmatched: ${unmatchedIds.join(", ")}`),
    filePath: batch.sourceFile,
    mutationType: "z-reorder-unmatched",
  });
}

async function patchElementBatch(projectId: string, batch: DomEditPatchBatch) {
  const before = await readProjectFileContent(projectId, batch.sourceFile);
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/file-mutations/patch-elements-batch/${encodeURIComponent(batch.sourceFile)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patches: batch.patches }),
    },
  );
  if (!response.ok) {
    const rejection = await readErrorResponseBody(response);
    throw new StudioSaveHttpError(formatPatchRejectionMessage(rejection), response.status);
  }
  const result = (await response.json()) as {
    changed?: boolean;
    matched?: boolean[];
    content?: string;
  };
  if (Array.isArray(result.matched)) reportUnmatchedBatchPatches(batch, result.matched);
  return {
    sourceFile: batch.sourceFile,
    changed: result.changed === true,
    // Skip-reload safety: the persist is only provably in sync with the live
    // DOM when the server confirmed EVERY patch target matched. A missing /
    // short matched[] is treated as unknown (false) so the caller falls back
    // to reloading rather than silently diverging from disk.
    allMatched:
      Array.isArray(result.matched) &&
      result.matched.length === batch.patches.length &&
      result.matched.every(Boolean),
    before,
    after: typeof result.content === "string" ? result.content : before,
  };
}

/**
 * A batch is reload-skippable only when it is style-only: every operation is an
 * `inline-style` write. The z-reorder commit applies those exact styles to the
 * live iframe DOM synchronously, so persisting them adds nothing the preview
 * doesn't already show. Any other op type (attribute / text-content / …) can
 * have server-side semantics the live DOM hasn't mirrored — reload for those.
 */
function batchesAreInlineStyleOnly(batches: DomEditPatchBatch[]): boolean {
  return batches.every((batch) =>
    batch.patches.every((patch) => patch.operations.every((op) => op.type === "inline-style")),
  );
}

export interface UseDomEditCommitsParams {
  activeCompPath: string | null;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  showToast: (message: string, tone?: "error" | "info") => void;
  queueDomEditSave: (save: () => Promise<void>) => Promise<void>;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  domEditSaveTimestampRef: React.MutableRefObject<number>;
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
  /** Stage 7 Step 3c: called before the server-side patch path; returns true if SDK handled it. */
  onTrySdkPersist?: (
    selection: DomEditSelection,
    operations: PatchOperation[],
    originalContent: string,
    targetPath: string,
    options?: { label?: string; coalesceKey?: string; skipRefresh?: boolean },
  ) => Promise<boolean>;
  /** Stage 7 §3.1: called before the server-side delete path; returns true if SDK handled it. */
  onTrySdkDelete?: (hfId: string, originalContent: string, targetPath: string) => Promise<boolean>;
  /** Resolver-shadow tripwire for z-index reorder targets (telemetry-only, decoupled from cutover). */
  onReorderShadow?: (targets: string[]) => void;
}

export function useDomEditCommits({
  activeCompPath,
  previewIframeRef,
  showToast,
  queueDomEditSave,
  writeProjectFile,
  domEditSaveTimestampRef,
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
      if (!asset) return null;
      return {
        family: fontFamilyFromAssetPath(asset),
        path: asset,
        url: `/api/projects/${projectId}/preview/${asset}`,
      };
    },
    [fileTree, projectId, importedFontAssetsRef],
  );

  const reportedUnresolvableRef = useRef(new Set<string>());

  // fallow-ignore-next-line complexity
  const persistDomEditOperations: PersistDomEditOperations = useCallback(
    // fallow-ignore-next-line complexity
    async (selection, operations, options) => {
      const pid = projectIdRef.current;
      if (!pid) throw new Error("No active project");
      if (options?.shouldSave && !options.shouldSave()) return;

      const targetPath = selection.sourceFile || activeCompPath || "index.html";

      const readResponse = await fetch(
        `/api/projects/${pid}/files/${encodeURIComponent(targetPath)}`,
      );
      if (!readResponse.ok) {
        throw await createStudioSaveHttpError(readResponse, `Failed to read ${targetPath}`);
      }
      const readData = (await readResponse.json()) as { content?: string };
      const originalContent = readData.content;
      if (typeof originalContent !== "string") {
        throw new Error(`Missing file contents for ${targetPath}`);
      }

      if (options?.shouldSave && !options.shouldSave()) return;

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
      if (
        onTrySdkPersist &&
        !options?.prepareContent &&
        (await onTrySdkPersist(selection, operations, originalContent, targetPath, {
          label: options?.label,
          coalesceKey: options?.coalesceKey,
          skipRefresh: options?.skipRefresh,
        }))
      ) {
        // SDK handled it — its in-memory doc is already current, so do NOT
        // forceReload (that would echo-reload the session we just wrote).
        return;
      }

      // Mark the save timestamp before the file write so the SSE file-change
      // handler suppresses the reload even if the event arrives before the
      // response (the server writes the file and emits SSE during the fetch).
      domEditSaveTimestampRef.current = Date.now();

      const patchResponse = await fetch(
        `/api/projects/${pid}/file-mutations/patch-element/${encodeURIComponent(targetPath)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        },
      );
      if (!patchResponse.ok) {
        showToast(formatPatchRejectionMessage(await readErrorResponseBody(patchResponse)), "error");
        throw await createStudioSaveHttpError(patchResponse, `Failed to patch ${targetPath}`, {
          alreadyToasted: true,
        });
      }

      const patchData = (await patchResponse.json()) as {
        ok?: boolean;
        changed?: boolean;
        matched?: boolean;
        content?: string;
      };

      if (!patchData.changed) {
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
        return;
      }

      const patchedContent =
        typeof patchData.content === "string" ? patchData.content : originalContent;

      let finalContent = patchedContent;
      if (options?.prepareContent) {
        const preparedContent = options.prepareContent(patchedContent, targetPath);
        if (preparedContent !== patchedContent) {
          try {
            await writeProjectFile(targetPath, preparedContent);
            finalContent = preparedContent;
          } catch (error) {
            // The patch above already landed on disk — only the prepareContent
            // embellishment (e.g. an injected @font-face) failed to write. Keep
            // the already-persisted patchedContent instead of throwing, which
            // would otherwise revert a change the server already committed.
            showToast(
              `Saved, but couldn't finish updating ${targetPath}: ${getErrorDetail(error)}`,
              "error",
            );
          }
        }
      }

      await editHistory.recordEdit({
        label: options?.label ?? "Edit layer",
        kind: "manual",
        coalesceKey: options?.coalesceKey,
        coalesceMs: options?.coalesceMs,
        files: { [targetPath]: { before: originalContent, after: finalContent } },
      });
      forceReloadSdkSession?.();

      if (!options?.skipRefresh) {
        reloadPreview();
      }
    },
    [
      activeCompPath,
      editHistory,
      writeProjectFile,
      projectIdRef,
      domEditSaveTimestampRef,
      reloadPreview,
      showToast,
      forceReloadSdkSession,
      onTrySdkPersist,
    ],
  );

  const commitDomEditPatchBatches: CommitDomEditPatchBatches = useCallback(
    (batches, options) =>
      queueDomEditSave(async () => {
        const pid = projectIdRef.current;
        if (!pid) throw new Error("No active project");
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

        domEditSaveTimestampRef.current = Date.now();
        const results = await Promise.all(batches.map((batch) => patchElementBatch(pid, batch)));
        const files = Object.fromEntries(
          results
            .filter((result) => result.changed)
            .map((result) => [result.sourceFile, { before: result.before, after: result.after }]),
        );
        if (Object.keys(files).length === 0) return;
        await editHistory.recordEdit({
          label: options.label,
          kind: "manual",
          coalesceKey: options.coalesceKey,
          files,
        });
        forceReloadSdkSession?.();
        // A z-only reorder already applied its inline styles to the live iframe
        // DOM (and the store) synchronously, so remounting the iframe here only
        // produces a visible blink. Skip the reload when the caller asked for it
        // AND the persist is provably in sync: style-only ops, every target
        // matched. Any unmatched patch means the live DOM now shows state disk
        // doesn't hold — reload so the preview reconverges. (The SSE/file-watcher
        // reload is independently suppressed by domEditSaveTimestampRef above.)
        const skipSafe =
          options.skipReload === true &&
          batchesAreInlineStyleOnly(batches) &&
          results.every((result) => result.allMatched);
        if (!skipSafe) reloadPreview();
      }).catch((error) => {
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
      }),
    [
      domEditSaveTimestampRef,
      editHistory,
      forceReloadSdkSession,
      projectIdRef,
      queueDomEditSave,
      reloadPreview,
      showToast,
    ],
  );

  // ── Text & style commits (delegated to useDomEditTextCommits) ──

  const {
    handleDomStyleCommit,
    handleDomAttributeCommit,
    handleDomAttributeLiveCommit,
    handleDomHtmlAttributeCommit,
    handleDomTextCommit,
    commitDomTextFields,
    handleDomTextFieldStyleCommit,
    handleDomAddTextField,
    handleDomRemoveTextField,
  } = useDomEditTextCommits({
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
    queueDomEditSave,
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
  });

  // ── Element lifecycle (delete, z-index reorder) ──

  const { handleDomEditElementDelete, handleDomZIndexReorderCommit } = useElementLifecycleOps({
    activeCompPath,
    showToast,
    writeProjectFile,
    domEditSaveTimestampRef,
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
    handleDomAttributeCommit,
    handleDomAttributeLiveCommit,
    handleDomHtmlAttributeCommit,
    handleDomTextCommit,
    commitDomTextFields,
    handleDomTextFieldStyleCommit,
    handleDomAddTextField,
    handleDomRemoveTextField,
    handleDomPathOffsetCommit,
    handleDomBoxSizeCommit,
    handleDomRotationCommit,
    handleDomManualEditsReset,
    handleDomEditElementDelete,
    handleDomZIndexReorderCommit,
  };
}
