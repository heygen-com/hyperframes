import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { readStudioFileChangePath } from "../components/editor/manualEdits";
import { StudioFileConflictError } from "../utils/studioSaveDiagnostics";
import type { ExternalConflictSnapshot } from "../utils/externalConflictStorage";
import { isSelfWriteEcho } from "./sdkSelfWriteRegistry";
import { consumeStudioWriteToken } from "../utils/studioFileVersion";
import { logReload } from "../utils/reloadDebug";

type ExternalChangeDrainResult =
  | { status: "clean" }
  | { status: "conflict"; error: StudioFileConflictError }
  | { status: "failed"; error: unknown };

export type ExternalFileChangeBlockedState =
  | {
      status: "conflict";
      generation: number;
      error: StudioFileConflictError;
      payload: unknown;
    }
  | {
      status: "failed";
      generation: number;
      path: string;
      error: unknown;
      payload: unknown;
      studioContent: string | null;
      recovered: boolean;
    };

interface ExternalFileChangeCoordinatorOptions {
  projectId: string | null;
  activeCompPath: string | null;
  recoveryFilePath?: string | null;
  pendingTimelineEditPathRef: MutableRefObject<Set<string>>;
  drainPendingChanges: () => Promise<ExternalChangeDrainResult>;
  getPendingCandidate?: () => { path: string; content: string } | null;
  discardPendingChanges: () => void;
  reloadPreview: () => void;
  reloadSdkSession: (path: string) => void;
  persistConflictSnapshot: (projectId: string, conflict: StudioFileConflictError) => Promise<void>;
  persistFailureSnapshot?: (
    projectId: string,
    filePath: string,
    studioContent: string,
    externalVersion: string | null,
    externalContent: string | null,
    error: unknown,
  ) => Promise<void>;
  loadConflictSnapshot?: (
    projectId: string,
    filePath: string,
  ) => Promise<ExternalConflictSnapshot | null>;
  deleteConflictSnapshot?: (projectId: string, filePath: string) => Promise<void>;
  overwriteConflict: (conflict: StudioFileConflictError) => Promise<void>;
  readProjectFile: (path: string) => Promise<string>;
  onUseExternalFile?: (path: string, content: string) => void;
  resetSaveQueues?: () => void;
}

export interface ExternalFileChangeCoordinatorHandle {
  blocked: ExternalFileChangeBlockedState | null;
  retry: () => Promise<void>;
  useExternalFile: () => Promise<void>;
  keepStudioFile: () => Promise<void>;
}

interface HotTestAdapter {
  on(event: string, handler: (payload?: unknown) => void): void;
  off(event: string, handler: (payload?: unknown) => void): void;
}

function testHotAdapter(): HotTestAdapter | null {
  const value = (globalThis as { __HF_STUDIO_HOT_TEST_ADAPTER__?: unknown })
    .__HF_STUDIO_HOT_TEST_ADAPTER__;
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<HotTestAdapter>;
  return typeof candidate.on === "function" && typeof candidate.off === "function"
    ? (candidate as HotTestAdapter)
    : null;
}

function readFileChangeContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.content === "string") return record.content;
  return "data" in record ? readFileChangeContent(record.data) : null;
}

function readFileChangeVersion(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.version === "string") return record.version;
  return "data" in record ? readFileChangeVersion(record.data) : null;
}

function readFileChangeWriteToken(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.writeToken === "string") return record.writeToken;
  return "data" in record ? readFileChangeWriteToken(record.data) : null;
}

function eventIdentity(path: string, payload: unknown): string | null {
  const version = readFileChangeVersion(payload);
  if (version) return `${path}\0${version}`;
  const content = readFileChangeContent(payload);
  return content == null ? null : `${path}\0${content.length}\0${content}`;
}

export function useExternalFileChangeCoordinator({
  projectId,
  activeCompPath,
  recoveryFilePath = activeCompPath,
  pendingTimelineEditPathRef,
  drainPendingChanges,
  getPendingCandidate,
  discardPendingChanges,
  reloadPreview,
  reloadSdkSession,
  persistConflictSnapshot,
  persistFailureSnapshot,
  loadConflictSnapshot,
  deleteConflictSnapshot,
  overwriteConflict,
  readProjectFile,
  onUseExternalFile,
  resetSaveQueues,
}: ExternalFileChangeCoordinatorOptions): ExternalFileChangeCoordinatorHandle {
  const [blocked, setBlocked] = useState<ExternalFileChangeBlockedState | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const lastEventIdentityRef = useRef<string | null>(null);
  const blockedRef = useRef(blocked);
  const snapshotWriteTailRef = useRef<Promise<void>>(Promise.resolve());
  blockedRef.current = blocked;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    setBlocked(null);
    lastEventIdentityRef.current = null;
  }, [projectId, activeCompPath]);

  useEffect(() => {
    if (!projectId || !recoveryFilePath || !loadConflictSnapshot) return;
    const generation = ++generationRef.current;
    let cancelled = false;
    void loadConflictSnapshot(projectId, recoveryFilePath)
      .then((snapshot) => {
        if (cancelled || !snapshot || !mountedRef.current || generation !== generationRef.current) {
          return;
        }
        const payload = {
          path: snapshot.filePath,
          version: snapshot.externalVersion,
          content: snapshot.externalContent,
        };
        if (snapshot.kind === "failed") {
          setBlocked({
            status: "failed",
            generation,
            path: snapshot.filePath,
            error: new Error(snapshot.failureMessage),
            payload,
            studioContent: snapshot.studioContent,
            recovered: true,
          });
        } else {
          const error = new StudioFileConflictError({
            filePath: snapshot.filePath,
            currentVersion: snapshot.externalVersion,
            currentContent: snapshot.externalContent,
            attemptedContent: snapshot.studioContent,
          });
          setBlocked({ status: "conflict", generation, error, payload });
        }
      })
      .catch(() => {
        // Storage may be unavailable in restricted browser contexts. A failed
        // best-effort restore must not create an unhandled rejection or block
        // a project that has no known recovery record.
      });
    return () => {
      cancelled = true;
    };
  }, [loadConflictSnapshot, projectId, recoveryFilePath]);

  const reloadAcceptedGeneration = useCallback(
    (path: string) => {
      logReload("reload", { path, by: "external-change coordinator" });
      reloadPreview();
      reloadSdkSession(path);
    },
    [reloadPreview, reloadSdkSession],
  );

  const persistSnapshotInOrder = useCallback(async (write: () => Promise<void>) => {
    const next = snapshotWriteTailRef.current.catch(() => undefined).then(write);
    snapshotWriteTailRef.current = next.then(
      () => undefined,
      () => undefined,
    );
    await next;
  }, []);

  const processChange = useCallback(
    // fallow-ignore-next-line complexity
    async (payload: unknown, allowDuplicate = false) => {
      const path = readStudioFileChangePath(payload);
      if (!path || !projectId) return;
      const pendingTimelinePaths = pendingTimelineEditPathRef.current;
      // The old path-only suppression could drop a real agent/user write that
      // raced ahead of the timeline write receipt. Clear the legacy marker but
      // decide ownership only from the exact write token/content below.
      pendingTimelinePaths.delete(path);

      const content = readFileChangeContent(payload);
      const token = readFileChangeWriteToken(payload);
      logReload("file-change", { path, token: token ?? null, hasContent: content != null });
      if (consumeStudioWriteToken(token)) {
        logReload("suppressed", { path, why: "own write token" });
        return;
      }
      if (content != null && isSelfWriteEcho(path, content)) {
        logReload("suppressed", { path, why: "own content echo" });
        return;
      }

      const identity = eventIdentity(path, payload);
      if (!allowDuplicate && identity != null && identity === lastEventIdentityRef.current) {
        logReload("suppressed", { path, why: "duplicate event" });
        return;
      }
      lastEventIdentityRef.current = identity;
      const generation = ++generationRef.current;
      const result = await drainPendingChanges();
      if (!mountedRef.current || generation !== generationRef.current) return;

      if (result.status === "clean") {
        const previousBlocked = blockedRef.current;
        if (previousBlocked?.status === "failed" && deleteConflictSnapshot) {
          try {
            await deleteConflictSnapshot(projectId, path);
          } catch (error) {
            if (mountedRef.current && generation === generationRef.current) {
              setBlocked({ ...previousBlocked, generation, error });
            }
            return;
          }
        }
        if (!mountedRef.current || generation !== generationRef.current) return;
        setBlocked(null);
        reloadAcceptedGeneration(path);
        return;
      }
      if (result.status === "failed") {
        const candidate = getPendingCandidate?.();
        const studioContent = candidate?.path === path ? candidate.content : null;
        let error = result.error;
        if (studioContent != null && persistFailureSnapshot) {
          try {
            await persistSnapshotInOrder(() =>
              persistFailureSnapshot(
                projectId,
                path,
                studioContent,
                readFileChangeVersion(payload),
                content,
                result.error,
              ),
            );
          } catch (snapshotError) {
            error = new Error(
              `Studio could not save the edit or its recovery snapshot: ${
                snapshotError instanceof Error ? snapshotError.message : String(snapshotError)
              }`,
              { cause: result.error },
            );
          }
        }
        if (!mountedRef.current || generation !== generationRef.current) return;
        setBlocked({
          status: "failed",
          generation,
          path,
          error,
          payload,
          studioContent,
          recovered: false,
        });
        return;
      }
      try {
        await persistSnapshotInOrder(() => persistConflictSnapshot(projectId, result.error));
      } catch (error) {
        if (!mountedRef.current || generation !== generationRef.current) return;
        setBlocked({
          status: "failed",
          generation,
          path,
          error,
          payload,
          studioContent: result.error.attemptedContent,
          recovered: false,
        });
        return;
      }
      if (!mountedRef.current || generation !== generationRef.current) return;
      setBlocked({ status: "conflict", generation, error: result.error, payload });
    },
    [
      projectId,
      pendingTimelineEditPathRef,
      drainPendingChanges,
      deleteConflictSnapshot,
      getPendingCandidate,
      persistConflictSnapshot,
      persistFailureSnapshot,
      persistSnapshotInOrder,
      reloadAcceptedGeneration,
    ],
  );

  useEffect(() => {
    const handler = (payload?: unknown) => processChange(payload);
    const adapter = testHotAdapter();
    if (adapter) {
      adapter.on("hf:file-change", handler);
      return () => adapter.off("hf:file-change", handler);
    }
    if (import.meta.hot) {
      import.meta.hot.on("hf:file-change", handler);
      return () => import.meta.hot?.off?.("hf:file-change", handler);
    }
    const eventSource = new EventSource("/api/events");
    eventSource.addEventListener("file-change", handler);
    return () => eventSource.close();
  }, [processChange]);

  const retry = useCallback(async () => {
    const current = blockedRef.current;
    if (!current || current.status === "conflict" || current.recovered) return;
    resetSaveQueues?.();
    lastEventIdentityRef.current = null;
    await processChange(current.payload, true);
  }, [processChange, resetSaveQueues]);

  const useExternalFile = useCallback(
    // fallow-ignore-next-line complexity
    async () => {
      const current = blockedRef.current;
      if (!current || !projectId || current.generation !== generationRef.current) return;
      const path = current.status === "conflict" ? current.error.filePath : current.path;
      const external =
        current.status === "conflict" && current.error.currentContent != null
          ? current.error.currentContent
          : await readProjectFile(path);
      if (current.generation !== generationRef.current) return;
      discardPendingChanges();
      resetSaveQueues?.();
      onUseExternalFile?.(path, external);
      await deleteConflictSnapshot?.(projectId, path);
      setBlocked(null);
      reloadAcceptedGeneration(path);
    },
    [
      deleteConflictSnapshot,
      discardPendingChanges,
      onUseExternalFile,
      projectId,
      readProjectFile,
      reloadAcceptedGeneration,
      resetSaveQueues,
    ],
  );

  // fallow-ignore-next-line complexity
  const keepStudioFile = useCallback(async () => {
    const current = blockedRef.current;
    if (!current || !projectId) return;
    if (current.generation !== generationRef.current) return;
    let conflict: StudioFileConflictError;
    if (current.status === "conflict") {
      conflict = current.error;
    } else {
      if (!current.recovered || current.studioContent == null) return;
      try {
        const currentContent =
          readFileChangeContent(current.payload) ?? (await readProjectFile(current.path));
        conflict = new StudioFileConflictError({
          filePath: current.path,
          currentVersion: readFileChangeVersion(current.payload),
          currentContent,
          attemptedContent: current.studioContent,
        });
      } catch (error) {
        if (current.generation === generationRef.current) setBlocked({ ...current, error });
        return;
      }
    }
    try {
      await overwriteConflict(conflict);
    } catch (error) {
      if (current.generation === generationRef.current) {
        setBlocked({
          status: "failed",
          generation: current.generation,
          path: conflict.filePath,
          error,
          payload: current.payload,
          studioContent: conflict.attemptedContent,
          recovered: current.status === "failed" && current.recovered,
        });
      }
      return;
    }
    if (current.generation !== generationRef.current) return;
    discardPendingChanges();
    resetSaveQueues?.();
    await deleteConflictSnapshot?.(projectId, conflict.filePath);
    setBlocked(null);
    reloadAcceptedGeneration(conflict.filePath);
  }, [
    deleteConflictSnapshot,
    discardPendingChanges,
    overwriteConflict,
    projectId,
    readProjectFile,
    reloadAcceptedGeneration,
    resetSaveQueues,
  ]);

  return { blocked, retry, useExternalFile, keepStudioFile };
}
