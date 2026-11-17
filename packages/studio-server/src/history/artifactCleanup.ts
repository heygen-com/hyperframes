import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { namesAnotherNetworkRoot } from "@hyperframes/parsers/asset-resolution";
import { pinProjectRecord, realFilePath } from "../helpers/safePath.js";
import type { ArtifactRecord, RenderRecord, VideoState } from "./videoState.js";

export interface PendingArtifactCleanup {
  path: string;
  hash: string;
  revision: string;
  id: string;
  kind: "checks" | "snapshots";
}

const kinds = ["checks", "snapshots"] as const;
const records = (state: VideoState, kind: PendingArtifactCleanup["kind"]) => [
  ...Object.values(state[kind].revisions).flat(),
  ...state[kind].unversioned,
];
const protectedRevisions = (state: VideoState) =>
  new Set([state.currentRevision, ...(state.renders?.retainedRevisions ?? [])]);

const canonicalUnlessOnAnotherShare = (projectDir: string, path: string): string =>
  namesAnotherNetworkRoot(projectDir, path) ? resolve(path) : realFilePath(path);

export const recordedFileGone = (projectDir: string, path: string): boolean =>
  namesAnotherNetworkRoot(projectDir, path) || !existsSync(path);

function spelledInsideArtifactsFolder(
  projectDir: string,
  path: string,
  kind: PendingArtifactCleanup["kind"],
): boolean {
  if (!isAbsolute(path) || namesAnotherNetworkRoot(projectDir, path)) return false;
  if (parse(resolve(path)).root.toLowerCase() !== parse(resolve(projectDir)).root.toLowerCase())
    return false;
  const parts = resolve(path)
    .split(sep)
    .map((part) => part.toLowerCase());
  return parts.some(
    (part, i) =>
      part === ".hyperframes" &&
      parts[i + 1] === "artifacts" &&
      parts[i + 2] === kind &&
      i + 3 < parts.length,
  );
}

function managedPath(
  projectDir: string,
  path: string,
  kind: PendingArtifactCleanup["kind"],
): boolean {
  if (!spelledInsideArtifactsFolder(projectDir, path, kind)) return false;
  const canonicalProject = realFilePath(resolve(projectDir));
  const canonicalPath = realFilePath(path);
  const root = join(canonicalProject, ".hyperframes", "artifacts", kind);
  const rel = relative(root, canonicalPath);
  return (
    isAbsolute(path) &&
    rel !== "" &&
    rel !== ".." &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel) &&
    pinProjectRecord(canonicalProject, relative(canonicalProject, canonicalPath)) === canonicalPath
  );
}

function updateLatest(state: VideoState): void {
  for (const kind of kinds) {
    const available = records(state, kind).filter((record) => record.status !== "cleaned");
    if (
      available.some(
        (record) =>
          record.id === state[kind].latest?.id && record.revision === state[kind].latest?.revision,
      )
    )
      continue;
    const latest = available.sort((a, b) => b.createdAt - a.createdAt)[0];
    state[kind].latest = latest ? { revision: latest.revision, id: latest.id } : null;
  }
}

export function planArtifactCleanup(
  projectDir: string,
  state: VideoState,
  render: RenderRecord,
): void {
  const protectedIds = protectedRevisions(state);
  const candidates: Array<{
    kind: PendingArtifactCleanup["kind"];
    record: ArtifactRecord;
    path: string;
  }> = [];
  const keepPaths = new Set<string>();
  const removable = (record: ArtifactRecord, path: string, kind: PendingArtifactCleanup["kind"]) =>
    Boolean(record.revision) &&
    !protectedIds.has(record.revision!) &&
    record.createdAt <= render.completedAt &&
    managedPath(projectDir, path, kind);
  for (const kind of kinds) {
    for (const record of records(state, kind)) {
      const path = record.image ?? record.report;
      if (!path || record.status === "cleaned") continue;
      if (removable(record, path, kind)) candidates.push({ kind, record, path });
      else keepPaths.add(canonicalUnlessOnAnotherShare(projectDir, path));
    }
  }
  for (const { kind, record, path } of candidates) {
    if (!keepPaths.has(realFilePath(path))) markCleaned(state, kind, record, path, render.id);
  }
  updateLatest(state);
}

function markCleaned(
  state: VideoState,
  kind: PendingArtifactCleanup["kind"],
  record: ArtifactRecord,
  path: string,
  renderId: string,
): void {
  (state.pendingArtifactCleanup ??= []).push({
    path,
    hash: record.contentHash,
    revision: record.revision!,
    id: record.id,
    kind,
  });
  delete record.image;
  delete record.report;
  record.status = "cleaned";
  record.cleanedAfterRender = renderId;
}

function restoreCleaned(state: VideoState, item: PendingArtifactCleanup): void {
  const record = state[item.kind].revisions[item.revision]?.find(
    (candidate) => candidate.id === item.id,
  );
  if (record?.status !== "cleaned") return;
  if (item.kind === "checks") record.report = item.path;
  else record.image = item.path;
  delete record.status;
  delete record.cleanedAfterRender;
}

function stillPendingAfterUnlink(item: PendingArtifactCleanup): boolean {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(item.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    const hash = createHash("sha256").update(readFileSync(descriptor)).digest("hex");
    if (hash !== item.hash) return false;
    const current = lstatSync(item.path);
    if (current.dev !== stat.dev || current.ino !== stat.ino) return false;
    unlinkSync(item.path);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function finishArtifactCleanup(projectDir: string, state: VideoState): void {
  const protectedIds = protectedRevisions(state);
  const referenced = new Set(
    kinds.flatMap((kind) =>
      records(state, kind)
        .flatMap((record) => record.image ?? record.report ?? [])
        .map((path) => canonicalUnlessOnAnotherShare(projectDir, path)),
    ),
  );
  state.pendingArtifactCleanup = (state.pendingArtifactCleanup ?? []).filter((item) => {
    if (!managedPath(projectDir, item.path, item.kind)) return false;
    const canonicalPath = realFilePath(item.path);
    if (protectedIds.has(item.revision)) {
      restoreCleaned(state, item);
      return false;
    }
    if (state.pendingChanges) return true;
    if (referenced.has(canonicalPath)) return false;
    return stillPendingAfterUnlink({ ...item, path: canonicalPath });
  });
  updateLatest(state);
}
