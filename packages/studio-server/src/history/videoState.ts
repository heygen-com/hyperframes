import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { replaceFileAtomically } from "@hyperframes/core/atomic-file";
import { pinProjectRecord } from "../helpers/safePath.js";
import { listProjectFilesAsync } from "../helpers/projectSignature.js";
import { readId } from "./historyId.js";
import { takeHistoryOwnership } from "./ownerLock.js";
import {
  planArtifactCleanup,
  finishArtifactCleanup,
  type PendingArtifactCleanup,
} from "./artifactCleanup.js";
import {
  ownSnapshotRun,
  releaseSnapshotRun,
  planSnapshotCleanup,
  finishSnapshotCleanup,
  type SnapshotRun,
} from "./snapshotRuns.js";
import type { HistoryEntry, HistoryWho, HistoryTarget } from "./historyLog.js";

export interface FileVersion {
  hash: string;
  content: string;
}

export interface RevisionState {
  targets?: HistoryTarget[];
  actor: HistoryWho;
  label: string;
  startedAt: number;
  endedAt: number;
  undoes?: string;
  restoredTo?: string;
  files: Record<string, { before: string | null; after: string | null }>;
}

export interface ArtifactInput {
  kind: "check" | "snapshot";
  id: string;
  scope: string;
  report?: string;
  image?: string;
  time?: number;
  metadata?: Record<string, unknown>;
}

export interface ArtifactRecord extends Omit<ArtifactInput, "kind"> {
  status?: "cleaned";
  cleanedAfterRender?: string;
  createdAt: number;
  contentHash: string;
  revision: string | null;
  inputFingerprint: string;
  inputScope: "local-project-files";
  attribution: "recorded-revision" | "unversioned" | "inputs-changed";
}

interface ArtifactCollection {
  latest: { revision: string | null; id: string } | null;
  revisions: Record<string, ArtifactRecord[]>;
  unversioned: ArtifactRecord[];
}

export interface RenderRecord {
  revision?: string | null;
  id: string;
  completedAt: number;
  output: string;
  status: "completed" | "completed_with_warnings";
}

export interface VideoState {
  version: 1;
  historyId: string | null;
  currentRevision: string | null;
  pendingChanges: boolean;
  files: Record<string, FileVersion>;
  revisions: Record<string, RevisionState>;
  checks: ArtifactCollection;
  snapshots: ArtifactCollection;
  renders?: { latest: RenderRecord | null; retainedRevisions?: string[] };
  pendingArtifactCleanup?: PendingArtifactCleanup[];
}

function statePath(dir: string): string {
  return projectRecordPath(dir, ".hyperframes/video-state.json", "Video state");
}

function backupPath(dir: string): string {
  return projectRecordPath(dir, ".hyperframes/video-state.json.bak", "Video state backup");
}

function projectRecordPath(dir: string, record: string, label: string): string {
  const path = pinProjectRecord(dir, record);
  if (!path) throw new Error(`${label} must stay inside the project.`);
  return path;
}

/**
 * The state file exists but cannot be understood. It is never replaced with an empty state: doing that
 * loses every check, snapshot, revision and file record the production has.
 */
export class VideoStateCorruptError extends Error {
  constructor(
    readonly statePath: string,
    readonly backupPath: string,
    readonly detail: string,
    options?: ErrorOptions,
  ) {
    super(
      `The project's video state is unreadable (${detail}).\n` +
        `It was not reset, because starting over would lose its checks, snapshots, revisions and file records.\n` +
        `Restore ${statePath} from a backup or version control, or delete it to start a fresh history.\n` +
        `The last state this version published is copied to ${backupPath}.`,
      options,
    );
    this.name = "VideoStateCorruptError";
  }
}
const collection = (): ArtifactCollection => ({ latest: null, revisions: {}, unversioned: [] });
const emptyState = (): VideoState => ({
  version: 1,
  historyId: null,
  currentRevision: null,
  pendingChanges: true,
  files: {},
  revisions: {},
  checks: collection(),
  snapshots: collection(),
});

function readState(dir: string): VideoState {
  const path = statePath(dir);
  if (!existsSync(path)) return emptyState();
  return parseState(dir, path, readFileSync(path, "utf8"));
}

function parseState(dir: string, path: string, text: string): VideoState {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw corruptState(dir, path, "not valid JSON", error);
  }
  if (!isVideoState(value)) throw corruptState(dir, path, "unexpected schema or version");
  return value;
}

function corruptState(
  dir: string,
  path: string,
  detail: string,
  cause?: unknown,
): VideoStateCorruptError {
  return new VideoStateCorruptError(path, backupPath(dir), detail, { cause });
}

function isVideoState(value: unknown): value is VideoState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<VideoState>;
  return Boolean(
    state.version === 1 && state.checks && state.snapshots && state.revisions && state.files,
  );
}

async function updateState(dir: string, update: (state: VideoState) => void): Promise<void> {
  const lock = pinProjectRecord(dir, ".hyperframes/video-state-lock");
  if (!lock) throw new Error("Video state lock must stay inside the project.");
  const release = await takeHistoryOwnership(lock, 5000);
  try {
    let state: VideoState;
    try {
      state = readState(dir);
    } catch (error) {
      if (!(error instanceof VideoStateCorruptError)) throw error;
      state = recoverState(dir, error);
    }
    update(state);
    publishState(dir, state);
  } finally {
    release();
  }
}

/**
 * Puts the last published state back over a damaged one, keeping the damaged bytes beside it. Without a
 * readable backup the update fails and nothing is rewritten, so the records are still there to recover.
 */
function recoverState(dir: string, error: VideoStateCorruptError): VideoState {
  let recovered: VideoState;
  try {
    recovered = parseState(dir, error.backupPath, readFileSync(error.backupPath, "utf8"));
  } catch (backupError) {
    throw corruptState(
      dir,
      error.statePath,
      `${error.detail}, and no readable backup could be restored`,
      backupError,
    );
  }
  const aside = `${error.statePath}.invalid-${randomUUID()}`;
  copyFileSync(error.statePath, aside);
  replaceFileAtomically(error.statePath, readFileSync(error.backupPath), 0o644);
  console.warn(
    `[hyperframes] video-state.json was unreadable (${error.detail}); restored the last published state. ` +
      `The damaged file is kept at ${aside}.`,
  );
  return recovered;
}

/**
 * The backup is new: it is written after the state it copies, so a power cut during the state write leaves
 * the previous file as the backup. A failed backup write never fails the update that already succeeded.
 */
function publishState(dir: string, state: VideoState): void {
  const path = statePath(dir);
  replaceFileAtomically(path, JSON.stringify(state, null, 2) + "\n", 0o644);
  try {
    copyFileSync(path, backupPath(dir));
  } catch {
    // Best effort: the state itself is already durable; only the ability to recover it is lost.
  }
}

export async function writeHistoryState(
  projectDir: string,
  historyId: string,
  historyDirectory: string,
  entries: readonly HistoryEntry[],
  currentFiles: ReadonlyMap<string, string>,
  committedFiles: ReadonlyMap<string, string>,
): Promise<void> {
  const blob = (hash: string | null) =>
    hash === null ? null : resolve(historyDirectory, "blobs", hash.slice(0, 2), hash);
  await updateState(projectDir, (state) => {
    if (state.historyId && state.historyId !== historyId) {
      state.checks = collection();
      state.snapshots = collection();
    }
    state.historyId = historyId;
    state.currentRevision = entries.at(-1)?.id ?? null;
    state.pendingChanges =
      currentFiles.size !== committedFiles.size ||
      [...currentFiles].some(([path, hash]) => committedFiles.get(path) !== hash);
    state.files = Object.fromEntries(
      [...currentFiles].map(([path, hash]) => [path, { hash, content: blob(hash)! }]),
    );
    state.revisions = Object.fromEntries(
      entries.map((entry) => [entry.id, revisionState(entry, blob)]),
    );
    dropArtifactsOfGoneRevisions(state);
  });
}

function revisionState(
  entry: HistoryEntry,
  blob: (hash: string | null) => string | null,
): RevisionState {
  const targets = entry.targets?.filter((target) =>
    entry.files.some((file) => file.path === target.file),
  );
  return {
    actor: entry.who,
    ...(targets?.length && { targets }),
    label: entry.label,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    ...(entry.undoes && { undoes: entry.undoes }),
    ...(entry.restoredTo && { restoredTo: entry.restoredTo }),
    files: Object.fromEntries(
      entry.files.map((file) => [
        file.path,
        { before: blob(file.before), after: blob(file.after) },
      ]),
    ),
  };
}

function dropArtifactsOfGoneRevisions(state: VideoState): void {
  const kept = (revision: string) =>
    Boolean(state.revisions[revision]) ||
    Boolean(state.renders?.retainedRevisions?.includes(revision));
  for (const artifacts of [state.checks, state.snapshots]) {
    for (const revision of Object.keys(artifacts.revisions)) {
      if (!kept(revision)) delete artifacts.revisions[revision];
    }
    if (artifacts.latest?.revision && !state.revisions[artifacts.latest.revision])
      artifacts.latest = null;
  }
}

async function fileHashes(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const { path } of (await listProjectFilesAsync(dir)).sort((a, b) =>
    a.path.localeCompare(b.path),
  )) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(join(dir, path))) hash.update(chunk);
    files[path] = hash.digest("hex");
  }
  return files;
}

export interface ArtifactCapture {
  revision: string | null;
  fingerprint: string;
}

export async function beginArtifactCapture(projectDir: string): Promise<ArtifactCapture> {
  const files = await fileHashes(projectDir);
  const state = readState(projectDir);
  const matches =
    state.historyId !== null &&
    readId(projectDir) === state.historyId &&
    !state.pendingChanges &&
    Object.entries(state.files).every(([path, file]) => files[path] === file.hash) &&
    Object.keys(files)
      .filter((path) => !path.split("/").some((part) => part.startsWith(".")))
      .every((path) => state.files[path]?.hash === files[path]);
  return {
    revision: matches ? state.currentRevision : null,
    fingerprint: createHash("sha256").update(JSON.stringify(files)).digest("hex"),
  };
}

export async function recordArtifact(
  projectDir: string,
  capture: ArtifactCapture,
  artifact: ArtifactInput,
): Promise<ArtifactRecord[]> {
  return recordArtifacts(projectDir, capture, [artifact]);
}

export async function recordArtifacts(
  projectDir: string,
  capture: ArtifactCapture,
  artifactsToRecord: readonly ArtifactInput[],
): Promise<ArtifactRecord[]> {
  const records: ArtifactRecord[] = [];
  const hashes = new Map<string, string>();
  for (const artifact of artifactsToRecord) {
    const path = artifact.kind === "check" ? artifact.report : artifact.image;
    if (!path || !isAbsolute(path)) throw new Error("Artifact needs an absolute output path.");
    hashes.set(artifact.id, createHash("sha256").update(readFileSync(path)).digest("hex"));
  }
  const after = await beginArtifactCapture(projectDir);
  const unchanged = after.fingerprint === capture.fingerprint;
  let cleanup: SnapshotRun[] = [];
  await updateState(projectDir, (state) => {
    const revision = unchanged ? knownRevision(state, capture.revision) : null;
    const attribution = attributionOf(unchanged, revision);
    for (const artifact of artifactsToRecord) {
      const { kind, ...fields } = artifact;
      const record: ArtifactRecord = {
        ...fields,
        createdAt: Date.now(),
        contentHash: hashes.get(artifact.id)!,
        revision,
        inputFingerprint: capture.fingerprint,
        inputScope: "local-project-files",
        attribution,
      };
      const artifacts = kind === "check" ? state.checks : state.snapshots;
      dropSupersededArtifacts(artifacts, artifact);
      const list = revision ? (artifacts.revisions[revision] ??= []) : artifacts.unversioned;
      list.push(record);
      records.push(record);
      artifacts.latest = { revision, id: record.id };
    }
    cleanup = planSnapshotCleanup(projectDir, state);
  });
  finishSnapshotCleanup(projectDir, cleanup);
  return records;
}

function knownRevision(state: VideoState, revision: string | null | undefined): string | null {
  return revision && state.revisions[revision] ? revision : null;
}

function attributionOf(unchanged: boolean, revision: string | null): ArtifactRecord["attribution"] {
  if (!unchanged) return "inputs-changed";
  return revision ? "recorded-revision" : "unversioned";
}

// An explicit output path can be reused; never retain a reference to overwritten evidence.
function supersedes(artifact: ArtifactInput, previous: ArtifactRecord): boolean {
  if (previous.status !== "cleaned" && !existsSync(previous.image ?? previous.report ?? ""))
    return true;
  if (previous.id === artifact.id) return true;
  if (artifact.image && previous.image === artifact.image) return true;
  return Boolean(artifact.report && previous.report === artifact.report);
}

function dropSupersededArtifacts(artifacts: ArtifactCollection, artifact: ArtifactInput): void {
  for (const list of [...Object.values(artifacts.revisions), artifacts.unversioned]) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (supersedes(artifact, list[i]!)) list.splice(i, 1);
    }
  }
}

function listsOf(artifacts: ArtifactCollection): ArtifactRecord[][] {
  return [...Object.values(artifacts.revisions), artifacts.unversioned];
}

export async function forgetRecordedArtifacts(
  projectDir: string,
  paths: readonly string[],
): Promise<void> {
  const gone = new Set(paths.map((path) => resolve(path)));
  if (gone.size === 0) return;
  await updateState(projectDir, (state) => {
    for (const artifacts of [state.checks, state.snapshots]) {
      for (const list of listsOf(artifacts)) {
        for (let i = list.length - 1; i >= 0; i--) {
          const record = list[i]!;
          const path = record.image ?? record.report;
          if (path && gone.has(resolve(path))) list.splice(i, 1);
        }
      }
      if (
        artifacts.latest &&
        !listsOf(artifacts).some((list) =>
          list.some((record) => record.id === artifacts.latest?.id),
        )
      ) {
        artifacts.latest = null;
      }
    }
  });
}

export function artifactDirectory(projectDir: string, kind: "checks" | "snapshots"): string {
  const path = join(resolve(projectDir), ".hyperframes", "artifacts", kind, randomUUID());
  if (kind === "snapshots") ownSnapshotRun(projectDir, path);
  return path;
}

function retainRevision(retained: readonly string[], revision: string | null): string[] {
  if (!revision) return [...retained];
  return [revision, ...retained.filter((id) => id !== revision)].slice(0, 2);
}

export async function recordRenderSuccess(
  projectDir: string,
  output: string,
  status: RenderRecord["status"] = "completed",
  capture?: ArtifactCapture,
): Promise<RenderRecord> {
  const outputFile = statSync(output);
  if (
    (!outputFile.isFile() && !outputFile.isDirectory()) ||
    (outputFile.isFile() && outputFile.size === 0)
  )
    throw new Error("Render output is missing or empty.");
  const after = capture ? await beginArtifactCapture(projectDir) : null;
  const record: RenderRecord = {
    id: randomUUID(),
    completedAt: Date.now(),
    output: resolve(output),
    status,
  };
  const unchanged = Boolean(capture && after?.fingerprint === capture.fingerprint);
  await updateState(projectDir, (state) => {
    record.revision = unchanged ? knownRevision(state, capture?.revision) : null;
    state.renders = {
      latest: record,
      retainedRevisions: retainRevision(state.renders?.retainedRevisions ?? [], record.revision),
    };
    if (outputFile.isFile() && record.revision && !state.pendingChanges)
      planArtifactCleanup(projectDir, state, record);
  });
  await updateState(projectDir, (state) => {
    finishArtifactCleanup(projectDir, state);
  });
  return record;
}

export async function finishSnapshotRun(projectDir: string, path: string): Promise<void> {
  releaseSnapshotRun(projectDir, path);
  let cleanup: SnapshotRun[] = [];
  await updateState(projectDir, (state) => {
    cleanup = planSnapshotCleanup(projectDir, state);
  });
  finishSnapshotCleanup(projectDir, cleanup);
}
