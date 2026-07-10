import type { MutableRefObject } from "react";
import { openComposition, type Composition } from "@hyperframes/sdk";
import type { EditHistoryKind } from "./editHistory";
import { hashContent, markSelfWrite } from "../hooks/sdkSelfWriteRegistry";
import { trackStudioEvent } from "./studioTelemetry";
import { serializeStudioFileMutation } from "./studioFileMutationCoordinator";

export type CutoverResult =
  | { status: "declined"; reason: string }
  | { status: "committed"; version: string }
  | { status: "failed"; error: Error };

export interface SdkSessionPublication {
  candidate: Composition;
  expectedSession: Composition;
  targetPath: string;
}

export type SdkSessionPublicationResult =
  | "published"
  | "rejected-active-target"
  | "rejected-inactive-target";

export type PublishSdkSession = (publication: SdkSessionPublication) => SdkSessionPublicationResult;

export interface CutoverDeps {
  editHistory: {
    recordEdit: (entry: {
      label: string;
      kind: EditHistoryKind;
      coalesceKey?: string;
      coalesceMs?: number;
      files: Record<string, { before: string; after: string }>;
    }) => Promise<void>;
  };
  /**
   * Must be bound to one project. Its identity plus path scopes the shared
   * mutation queue used by every whole-file writer in that project.
   */
  writeProjectFile: (path: string, content: string) => Promise<void>;
  reloadPreview: () => void;
  domEditSaveTimestampRef: MutableRefObject<number>;
  refresh?: (after: string) => void;
  compositionPath?: string | null;
  readProjectFile?: (path: string) => Promise<string>;
  /**
   * Takes ownership only when it returns `published`. Rejection identifies
   * whether target-sensitive preview refresh is still safe. MUST NOT throw
   * after installation; rejection leaves ownership with the caller.
   */
  publishSession?: PublishSdkSession;
  /** Test seam; production clones with openComposition. */
  createCandidateSession?: (serialized: string, live: Composition) => Promise<Composition>;
}

export interface CutoverOptions {
  label?: string;
  coalesceKey?: string;
  /** Coalesce window (ms); Infinity folds across a slow round-trip. */
  coalesceMs?: number;
  skipRefresh?: boolean;
}

interface CandidateEdit {
  live: Composition;
  candidate: Composition;
  serializedBefore: string;
  after: string;
}

export function declinedCutover(reason: string): CutoverResult {
  return { status: "declined", reason };
}

export function asCutoverError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Only an explicit decline may enter the legacy mutation backend. */
export function cutoverCommittedOrThrow(result: CutoverResult): boolean {
  if (result.status === "failed") throw result.error;
  return result.status === "committed";
}

/** A supplied authoritative reader fails closed; only its absence uses the snapshot fallback. */
async function captureOnDiskBefore(
  deps: CutoverDeps,
  targetPath: string,
  serializedFallback: string,
): Promise<string> {
  if (!deps.readProjectFile) return serializedFallback;
  return deps.readProjectFile(targetPath);
}

function disposeCandidate(candidate: Composition | undefined, live: Composition): void {
  if (candidate && candidate !== live) candidate.dispose();
}

function createCandidateSession(
  serializedBefore: string,
  live: Composition,
  deps: CutoverDeps,
): Promise<Composition> {
  return deps.createCandidateSession
    ? deps.createCandidateSession(serializedBefore, live)
    : openComposition(serializedBefore, { history: false });
}

function candidatePublisherAvailable(
  candidate: Composition,
  live: Composition,
  deps: CutoverDeps,
): boolean {
  return candidate === live || deps.publishSession !== undefined;
}

async function buildCandidateEdit(
  live: Composition,
  deps: CutoverDeps,
  mutate: (candidate: Composition) => void,
  sourceSnapshot?: string,
): Promise<CandidateEdit | CutoverResult> {
  let candidate: Composition | undefined;
  try {
    const serializedBefore = sourceSnapshot ?? live.serialize();
    candidate = await createCandidateSession(serializedBefore, live, deps);
    candidate.batch(() => mutate(candidate!));
    const after = candidate.serialize();
    if (after === serializedBefore) {
      disposeCandidate(candidate, live);
      return declinedCutover("no_change");
    }
    if (!candidatePublisherAvailable(candidate, live, deps)) {
      disposeCandidate(candidate, live);
      return { status: "failed", error: new Error("SDK candidate publisher is unavailable") };
    }
    return { live, candidate, serializedBefore, after };
  } catch (error) {
    disposeCandidate(candidate, live);
    return { status: "failed", error: asCutoverError(error) };
  }
}

function isCutoverResult(value: CandidateEdit | CutoverResult): value is CutoverResult {
  return "status" in value;
}

async function rollbackWrite(
  targetPath: string,
  originalContent: string,
  deps: CutoverDeps,
  cause: Error,
): Promise<Error> {
  try {
    deps.domEditSaveTimestampRef.current = Date.now();
    markSelfWrite(targetPath, originalContent);
    await deps.writeProjectFile(targetPath, originalContent);
    return cause;
  } catch (rollbackError) {
    return new AggregateError(
      [cause, asCutoverError(rollbackError)],
      `SDK edit failed and rollback could not restore ${targetPath}`,
    );
  }
}

async function writeAndRecord(
  after: string,
  targetPath: string,
  originalContent: string,
  deps: CutoverDeps,
  options?: CutoverOptions,
): Promise<Error | null> {
  deps.domEditSaveTimestampRef.current = Date.now();
  markSelfWrite(targetPath, after);
  try {
    await deps.writeProjectFile(targetPath, after);
  } catch (error) {
    return asCutoverError(error);
  }
  try {
    await deps.editHistory.recordEdit({
      label: options?.label ?? "Edit layer",
      kind: "manual",
      ...(options?.coalesceKey ? { coalesceKey: options.coalesceKey } : {}),
      ...(options?.coalesceMs != null ? { coalesceMs: options.coalesceMs } : {}),
      files: { [targetPath]: { before: originalContent, after } },
    });
    return null;
  } catch (error) {
    return rollbackWrite(targetPath, originalContent, deps, asCutoverError(error));
  }
}

function refreshCommittedEdit(after: string, deps: CutoverDeps, options?: CutoverOptions): void {
  try {
    if (deps.refresh) deps.refresh(after);
    else if (!options?.skipRefresh) deps.reloadPreview();
  } catch (error) {
    trackStudioEvent("sdk_cutover_refresh_failed", { error: asCutoverError(error).message });
  }
}

async function commitCandidateEdit(
  edit: CandidateEdit,
  targetPath: string,
  originalContent: string,
  deps: CutoverDeps,
  options?: CutoverOptions,
): Promise<CutoverResult> {
  const writeError = await writeAndRecord(edit.after, targetPath, originalContent, deps, options);
  if (writeError) {
    if (edit.candidate !== edit.live) edit.candidate.dispose();
    return { status: "failed", error: writeError };
  }
  let refreshTarget = true;
  try {
    if (edit.candidate !== edit.live) {
      const publication = deps.publishSession!({
        candidate: edit.candidate,
        expectedSession: edit.live,
        targetPath,
      });
      if (publication !== "published") edit.candidate.dispose();
      if (publication === "rejected-inactive-target") refreshTarget = false;
    }
  } catch (error) {
    // Persistence and history are already committed. A publisher can throw
    // after installing the candidate, so rolling back disk or disposing the
    // candidate here can make all three authorities disagree (or dispose the
    // now-live session). Production publishers are non-throwing; keep the
    // durable commit authoritative and surface this post-commit fault.
    trackStudioEvent("sdk_cutover_publish_failed", {
      path: targetPath,
      error: asCutoverError(error).message,
    });
  }
  if (refreshTarget) refreshCommittedEdit(edit.after, deps, options);
  return { status: "committed", version: hashContent(edit.after) };
}

export async function persistSdkCandidateMutation(
  live: Composition,
  targetPath: string,
  originalContent: string,
  deps: CutoverDeps,
  mutate: (candidate: Composition) => void,
  options?: CutoverOptions,
  sourceSnapshot?: string,
): Promise<CutoverResult> {
  return serializeStudioFileMutation(
    deps.writeProjectFile,
    targetPath,
    async (): Promise<CutoverResult> => {
      // Re-read only after acquiring the path queue. This makes each candidate
      // clone the latest committed bytes, even when React has not yet re-rendered
      // and the caller still holds the preceding live-session object.
      const serializedFallback = sourceSnapshot ?? originalContent;
      let onDiskBefore: string;
      try {
        onDiskBefore = await captureOnDiskBefore(deps, targetPath, serializedFallback);
      } catch (error) {
        return { status: "failed", error: asCutoverError(error) };
      }
      // Preserve the live-session path for adapters without a reader (notably
      // isolated consumers/tests). Production Studio supplies a reader so
      // queued edits always clone the latest durable source.
      const candidateSource = deps.readProjectFile ? onDiskBefore : sourceSnapshot;
      const candidate = await buildCandidateEdit(live, deps, mutate, candidateSource);
      if (isCutoverResult(candidate)) return candidate;
      return commitCandidateEdit(candidate, targetPath, onDiskBefore, deps, options);
    },
  );
}

/** Transactional writer for non-SDK islands and throwaway composition sessions. */
export async function persistSdkSerialize(
  buildAfter: (onDiskBefore: string) => string | Promise<string>,
  targetPath: string,
  originalContent: string,
  deps: CutoverDeps,
  options?: CutoverOptions,
): Promise<void> {
  await serializeStudioFileMutation(deps.writeProjectFile, targetPath, async () => {
    const onDiskBefore = await captureOnDiskBefore(deps, targetPath, originalContent);
    const after = await buildAfter(onDiskBefore);
    if (after === onDiskBefore) return;
    const error = await writeAndRecord(after, targetPath, onDiskBefore, deps, options);
    if (error) throw error;
    refreshCommittedEdit(after, deps, options);
  });
}
