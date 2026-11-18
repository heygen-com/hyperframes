import type { StudioFileConflictError } from "./studioSaveDiagnostics";
import { studioApiFetch } from "./studioApiFetch";

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

function draftUrl(projectId: string, filePath: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/recovery-drafts/${encodeURIComponent(filePath)}`;
}

async function draftRequest(
  projectId: string,
  filePath: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await studioApiFetch(draftUrl(projectId, filePath), init);
  if (!res.ok) throw new Error(`Recovery draft storage failed (${res.status})`);
  return res;
}

/** Kept by the project's own server: an origin-wide browser store is shared with every project on the port. */
const projectStorage: ExternalConflictStorage = {
  async get(projectId, filePath) {
    const { draft } = (await (await draftRequest(projectId, filePath)).json()) as {
      draft: ExternalConflictSnapshot | null;
    };
    return draft?.projectId === projectId && draft.filePath === filePath ? draft : null;
  },
  async set(snapshot) {
    await draftRequest(snapshot.projectId, snapshot.filePath, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snapshot),
    });
  },
  async delete(projectId, filePath) {
    await draftRequest(projectId, filePath, { method: "DELETE" });
  },
};

/** Saved before destructive recovery is offered; on a rejection the draft stays only in memory and the user is told. */
export async function persistExternalConflictSnapshot(
  projectId: string,
  conflict: StudioFileConflictError,
): Promise<void> {
  await projectStorage.set({
    kind: "conflict",
    projectId,
    filePath: conflict.filePath,
    externalVersion: conflict.currentVersion,
    externalContent: conflict.currentContent,
    studioContent: conflict.attemptedContent,
    createdAt: Date.now(),
  });
}

/** Studio's final candidate after its file write failed; awaited like persistExternalConflictSnapshot. */
export async function persistExternalFailureSnapshot(
  projectId: string,
  filePath: string,
  studioContent: string,
  externalVersion: string | null,
  externalContent: string | null,
  error: unknown,
): Promise<void> {
  await projectStorage.set({
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

export async function loadExternalConflictSnapshot(
  projectId: string,
  filePath: string,
): Promise<ExternalConflictSnapshot | null> {
  return projectStorage.get(projectId, filePath);
}

export async function deleteExternalConflictSnapshot(
  projectId: string,
  filePath: string,
): Promise<void> {
  await projectStorage.delete(projectId, filePath);
}
