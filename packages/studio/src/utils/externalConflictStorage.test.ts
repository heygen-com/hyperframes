import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryExternalConflictStorage,
  deleteExternalConflictSnapshot,
  loadExternalConflictSnapshot,
  persistExternalConflictSnapshot,
  type ExternalConflictSnapshot,
} from "./externalConflictStorage";
import { StudioFileConflictError } from "./studioSaveDiagnostics";

const DAY_MS = 24 * 60 * 60 * 1000;

function rawStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("hyperframes-studio-external-conflicts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("file-conflicts");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("file-conflicts", mode);
      const result = callback(transaction.objectStore("file-conflicts"));
      transaction.oncomplete = () => {
        db.close();
        resolve(result.result);
      };
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

const plantRecord = (projectId: string, filePath: string, record: unknown) =>
  rawStore("readwrite", (store) => store.put(record, `${projectId}\0${filePath}`));

const readRawRecord = (projectId: string, filePath: string) =>
  rawStore<unknown>("readonly", (store) => store.get(`${projectId}\0${filePath}`));

function genuineRecord(overrides: Partial<ExternalConflictSnapshot> = {}) {
  return {
    kind: "conflict",
    projectId: "project-b",
    filePath: "index.html",
    externalVersion: "v2",
    externalContent: "external",
    studioContent: "studio",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("external conflict snapshots", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("durably records both complete file versions before resolution", async () => {
    const storage = createMemoryExternalConflictStorage();
    const snapshot: ExternalConflictSnapshot = {
      kind: "conflict",
      projectId: "project-a",
      filePath: "index.html",
      externalVersion: "v2",
      externalContent: "external full file",
      studioContent: "studio full file",
      createdAt: 100,
    };

    await storage.set(snapshot);
    expect(await storage.get("project-a", "index.html")).toEqual(snapshot);
    await storage.delete("project-a", "index.html");
    expect(await storage.get("project-a", "index.html")).toBeNull();
  });

  it("records a failed final Studio candidate for remount recovery", async () => {
    const storage = createMemoryExternalConflictStorage();
    const snapshot: ExternalConflictSnapshot = {
      kind: "failed",
      projectId: "project-a",
      filePath: "index.html",
      externalVersion: null,
      externalContent: null,
      studioContent: "recover me",
      failureMessage: "network unavailable",
      createdAt: 101,
    };

    await storage.set(snapshot);
    expect(await storage.get("project-a", "index.html")).toEqual(snapshot);
  });

  it("persists, loads, and deletes a snapshot through the production IndexedDB adapter", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1234);
    const conflict = new StudioFileConflictError({
      filePath: "index.html",
      currentVersion: "v2",
      currentContent: "external full file",
      attemptedContent: "studio full file",
    });

    await persistExternalConflictSnapshot("indexeddb-project", conflict);
    await expect(loadExternalConflictSnapshot("indexeddb-project", "index.html")).resolves.toEqual({
      kind: "conflict",
      projectId: "indexeddb-project",
      filePath: "index.html",
      externalVersion: "v2",
      externalContent: "external full file",
      studioContent: "studio full file",
      createdAt: 1234,
    });
    await deleteExternalConflictSnapshot("indexeddb-project", "index.html");
    await expect(
      loadExternalConflictSnapshot("indexeddb-project", "index.html"),
    ).resolves.toBeNull();
  });

  it.each([
    ["another project's id", { projectId: "project-a" }],
    ["another file's path", { filePath: "other.html" }],
    ["a creation time over 30 days old", { createdAt: Date.now() - 31 * DAY_MS }],
    ["a creation time over 30 days ahead", { createdAt: Date.now() + 31 * DAY_MS }],
    ["no creation time", { createdAt: undefined }],
  ])("refuses and deletes a stored record with %s", async (_label, overrides) => {
    await plantRecord("project-b", "index.html", { ...genuineRecord(), ...overrides });

    await expect(loadExternalConflictSnapshot("project-b", "index.html")).resolves.toBeNull();
    await expect(readRawRecord("project-b", "index.html")).resolves.toBeUndefined();
  });

  it("recovers a genuine draft up to 30 days old", async () => {
    const record = genuineRecord({ createdAt: Date.now() - 29 * DAY_MS });
    await plantRecord("project-b", "index.html", record);
    await expect(loadExternalConflictSnapshot("project-b", "index.html")).resolves.toEqual(record);
  });

  it("rejects persistence when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const conflict = new StudioFileConflictError({
      filePath: "index.html",
      currentVersion: "v2",
      currentContent: "external",
      attemptedContent: "studio",
    });

    await expect(persistExternalConflictSnapshot("project-a", conflict)).rejects.toThrow(
      "IndexedDB is unavailable; conflict recovery snapshot was not saved",
    );
  });
});
