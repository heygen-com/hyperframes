import { createEmptyEditHistory, type EditHistoryState } from "./editHistory";

export interface EditHistoryStorageAdapter {
  get(projectId: string): Promise<EditHistoryState | null>;
  set(projectId: string, state: EditHistoryState): Promise<void>;
  delete(projectId: string): Promise<void>;
}

const DB_NAME = "hyperframes-studio-edit-history";
const DB_VERSION = 1;
const STORE_NAME = "project-history";

export function createMemoryEditHistoryStorage(): EditHistoryStorageAdapter {
  const states = new Map<string, EditHistoryState>();
  return {
    async get(projectId) {
      return states.get(projectId) ?? null;
    },
    async set(projectId, state) {
      states.set(projectId, structuredClone(state));
    },
    async delete(projectId) {
      states.delete(projectId);
    },
  };
}

function openEditHistoryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("IndexedDB is not available"));
      return;
    }

    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onerror = () => reject(request.error ?? new Error("Failed to open edit history db"));
    request.onsuccess = () => resolve(request.result);
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openEditHistoryDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const request = callback(tx.objectStore(STORE_NAME));
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
        request.onsuccess = () => resolve(request.result);
        tx.oncomplete = () => db.close();
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error("IndexedDB transaction failed"));
        };
      }),
  );
}

export function createIndexedDbEditHistoryStorage(): EditHistoryStorageAdapter {
  return {
    async get(projectId) {
      return (
        (await withStore<EditHistoryState | undefined>("readonly", (store) =>
          store.get(projectId),
        )) ?? null
      );
    },
    async set(projectId, state) {
      await withStore<IDBValidKey>("readwrite", (store) => store.put(state, projectId));
    },
    async delete(projectId) {
      await withStore<undefined>("readwrite", (store) => store.delete(projectId));
    },
  };
}

export async function loadEditHistoryState(
  storage: EditHistoryStorageAdapter,
  projectId: string,
): Promise<EditHistoryState> {
  const state = await storage.get(projectId);
  return state ?? createEmptyEditHistory();
}

export async function saveEditHistoryState(
  storage: EditHistoryStorageAdapter,
  projectId: string,
  state: EditHistoryState,
): Promise<void> {
  await storage.set(projectId, state);
}
