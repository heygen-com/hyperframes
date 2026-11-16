import type { StudioFileConflictError } from "./studioSaveDiagnostics";

interface ExternalRecoverySnapshotBase {
  projectId: string;
  filePath: string;
  externalVersion: string | null;
  externalContent: string | null;
  studioContent: string;
  createdAt: number;
}

export type ExternalConflictSnapshot =
  | (ExternalRecoverySnapshotBase & { kind: "conflict" })
  | (ExternalRecoverySnapshotBase & { kind: "failed"; failureMessage: string });

export interface ExternalConflictStorage {
  get(projectId: string, filePath: string): Promise<ExternalConflictSnapshot | null>;
  set(snapshot: ExternalConflictSnapshot): Promise<void>;
  delete(projectId: string, filePath: string): Promise<void>;
}

const DB_NAME = "hyperframes-studio-external-conflicts";
const DB_VERSION = 1;
const STORE_NAME = "file-conflicts";
/** Unresolved drafts are offered for recovery for 30 days, then discarded. */
const SNAPSHOT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function key(projectId: string, filePath: string): string {
  return `${projectId}\0${filePath}`;
}

export function createMemoryExternalConflictStorage(): ExternalConflictStorage {
  const snapshots = new Map<string, ExternalConflictSnapshot>();
  return {
    async get(projectId, filePath) {
      const snapshot = snapshots.get(key(projectId, filePath));
      return snapshot ? structuredClone(snapshot) : null;
    },
    async set(snapshot) {
      snapshots.set(key(snapshot.projectId, snapshot.filePath), structuredClone(snapshot));
    },
    async delete(projectId, filePath) {
      snapshots.delete(key(projectId, filePath));
    },
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("IndexedDB is unavailable; conflict recovery snapshot was not saved"));
      return;
    }
    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onerror = () => reject(request.error ?? new Error("Failed to open conflict storage"));
    request.onsuccess = () => resolve(request.result);
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const request = callback(transaction.objectStore(STORE_NAME));
        let result!: T;
        request.onerror = () => reject(request.error ?? new Error("Conflict storage failed"));
        request.onsuccess = () => {
          result = request.result;
        };
        transaction.oncomplete = () => {
          db.close();
          resolve(result);
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error ?? new Error("Conflict storage transaction failed"));
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error ?? new Error("Conflict storage transaction was aborted"));
        };
      }),
  );
}

function createIndexedDbExternalConflictStorage(): ExternalConflictStorage {
  return {
    async get(projectId, filePath) {
      return (
        (await withStore<ExternalConflictSnapshot | undefined>("readonly", (store) =>
          store.get(key(projectId, filePath)),
        )) ?? null
      );
    },
    async set(snapshot) {
      await withStore<IDBValidKey>("readwrite", (store) =>
        store.put(snapshot, key(snapshot.projectId, snapshot.filePath)),
      );
    },
    async delete(projectId, filePath) {
      await withStore<undefined>("readwrite", (store) => store.delete(key(projectId, filePath)));
    },
  };
}

const indexedDbStorage = createIndexedDbExternalConflictStorage();

/**
 * Persist a conflict before offering destructive recovery actions.
 * Callers must await this promise: rejection means the Studio draft was not saved durably and
 * must remain available in memory while the storage failure is surfaced to the user.
 */
export async function persistExternalConflictSnapshot(
  projectId: string,
  conflict: StudioFileConflictError,
): Promise<void> {
  await indexedDbStorage.set({
    kind: "conflict",
    projectId,
    filePath: conflict.filePath,
    externalVersion: conflict.currentVersion,
    externalContent: conflict.currentContent,
    studioContent: conflict.attemptedContent,
    createdAt: Date.now(),
  });
}

/**
 * Persist the final Studio candidate after its file write fails.
 * Callers must await this promise: rejection means the Studio draft was not saved durably and
 * must remain available in memory while the storage failure is surfaced to the user.
 */
export async function persistExternalFailureSnapshot(
  projectId: string,
  filePath: string,
  studioContent: string,
  externalVersion: string | null,
  externalContent: string | null,
  error: unknown,
): Promise<void> {
  await indexedDbStorage.set({
    kind: "failed",
    projectId,
    filePath,
    externalVersion,
    externalContent,
    studioContent,
    failureMessage: error instanceof Error ? error.message : String(error),
    createdAt: Date.now(),
  });
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * The IndexedDB store is shared by every project served from this origin, so a record is
 * only recovered when it names the exact key it was stored under, has the shape Studio
 * writes, and is younger than {@link SNAPSHOT_MAX_AGE_MS}.
 */
function isRecoverableSnapshot(
  record: unknown,
  projectId: string,
  filePath: string,
  now: number,
): record is ExternalConflictSnapshot {
  if (typeof record !== "object" || record === null) return false;
  const snapshot = record as Record<string, unknown>;
  if (snapshot.projectId !== projectId || snapshot.filePath !== filePath) return false;
  if (typeof snapshot.studioContent !== "string") return false;
  if (!isStringOrNull(snapshot.externalVersion) || !isStringOrNull(snapshot.externalContent)) {
    return false;
  }
  const createdAt = snapshot.createdAt;
  if (typeof createdAt !== "number" || !(Math.abs(now - createdAt) <= SNAPSHOT_MAX_AGE_MS)) {
    return false;
  }
  if (snapshot.kind === "conflict") return true;
  return snapshot.kind === "failed" && typeof snapshot.failureMessage === "string";
}

/** Returns the draft stored for this project and file, deleting any record that fails validation. */
export async function loadExternalConflictSnapshot(
  projectId: string,
  filePath: string,
): Promise<ExternalConflictSnapshot | null> {
  const record: unknown = await indexedDbStorage.get(projectId, filePath);
  if (record == null) return null;
  if (isRecoverableSnapshot(record, projectId, filePath, Date.now())) return record;
  await indexedDbStorage.delete(projectId, filePath).catch(() => undefined);
  return null;
}

export async function deleteExternalConflictSnapshot(
  projectId: string,
  filePath: string,
): Promise<void> {
  await indexedDbStorage.delete(projectId, filePath);
}
