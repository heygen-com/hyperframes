export interface SyncTooBig {
  limit: "file_count" | "file_size" | "project_size" | "manifest_size";
  actual: number;
  maximum: number;
  biggest: { path: string; size: number }[];
}

/** A file that keeps a project from being captured; it is never left out silently. */
export interface SyncCaptureProblem {
  path: string;
  problem: "symlink" | "special-file" | "unreadable" | "invalid-name" | "changed" | "no-entrypoint";
  /** For `invalid-name`, the path policy's code (`reserved_name`, `path_collision`, ...). */
  code?: string;
}

export interface ManifestFile {
  path: string;
  sha256: string;
  size: number;
}

export interface ManifestDocument {
  format_version: 1;
  entrypoint: "index.html";
  files: ManifestFile[];
}

/** A valid manifest: its document in canonical order, the canonical bytes and their SHA-256. */
export interface Manifest {
  document: ManifestDocument;
  canonical: Buffer;
  sha256: string;
}

export interface Violation {
  code: string;
  path?: string;
  rule?: string;
}

export type LimitName = SyncTooBig["limit"];

export interface Limits {
  maxFiles: number;
  maxFileBytes: number;
  maxProjectBytes: number;
  maxManifestBytes: number;
}

export type OverLimit = SyncTooBig;

type ClientAction = "include" | "exclude" | "wait_then_exclude";

export interface PathRule {
  id: string;
  regex: string;
  client_action: ClientAction;
  server_action: "allow" | "reject";
}

/** The fields of contract/path-policy.json this client reads. */
export interface PolicyDocument {
  policy_version: string;
  stored_manifest: { legacy_agent_state_regex: string };
  unicode: { version: string };
  rules: PathRule[];
  path: {
    max_path_bytes: number;
    max_segment_bytes: number;
    forbidden_characters: string;
    reserved_segment_regex: string;
    canonical_spelling_roots: string[];
  };
  client_prefilter: { names: string[] };
  client_symlinks: { skip_prefixes: string[] };
}

export type CaptureProblem = SyncCaptureProblem;

/** What an owner workspace's plan allows composition sync, as the limits route answered it. `unread` when it could not
 * be read: `not-deployed` is a server without the route (a 404), and nothing is refused on an unread answer. */
export type SyncLimitsRead =
  | {
      at: "read";
      syncAllowed: boolean;
      maxCompositions: number;
      /** Live compositions in the workspace when it was read. */
      compositions: number;
      push: Limits;
    }
  | { at: "unread"; why: "not-deployed" | "offline" | "failed" };

/** A file a capture lists, before hashing. */
export interface Found {
  path: string;
  full: string;
  size: number;
  mtimeMs: number;
  ino: number;
  dev: number;
}

export interface Walk {
  files: Found[];
  problems: CaptureProblem[];
  waiting: string[];
  skippedLinks: string[];
}

export type Capture =
  | {
      at: "captured";
      manifest: Manifest;
      settled: { agentTurnOpen: boolean; projectLocked: boolean };
      waiting: string[];
      skippedLinks: string[];
    }
  | { at: "problems"; problems: CaptureProblem[] }
  | { at: "too-big"; over: OverLimit };

export type SyncErrorKind =
  | "offline"
  | "signed-out"
  | "malformed"
  | "not-enabled"
  | "byok"
  | "no-write-role"
  | "forbidden"
  | "composition-not-found"
  | "not-found"
  | "too-large"
  | "reference-invalid"
  | "upload-not-pending"
  | "active-uploads-exceeded"
  | "file-not-writable"
  | "idempotency-key-reused"
  | "request-in-progress"
  | "snapshot-not-downloadable"
  | "conflict-not-open"
  | "download-expired"
  | "invalid-parameter"
  | "plan-required"
  | "limit-reached"
  | "rate-limited"
  | "unavailable"
  | "server-error"
  | "refused";

export interface Composition {
  id: string;
  spaceId: string;
  title: string;
  createdBy: string;
  /** Null before the first publish. */
  latestSnapshotId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Snapshot {
  id: string;
  compositionId: string;
  baseSnapshotId: string | null;
  publicationOutcome: "published" | "conflict_saved";
  conflictedWithSnapshotId: string | null;
  conflictState: "open" | "resolved" | "discarded" | null;
  resolvedBySnapshotId: string | null;
  createdBy: string;
  createdByName?: string | null;
  clientType: string;
  summary: string | null;
  summarySource: string;
  manifestSha256: string;
  createdAt: string;
  /** Only with `include=manifest`, and only once its bytes hash to manifestSha256. */
  manifest: Manifest | null;
}

type UploadStatus = "pending" | "verifying" | "completed" | "failed" | "expired";

export interface UploadReceipt {
  uploadId: string;
  compositionId: string;
  snapshotId: string;
  status: UploadStatus;
  /** Why a failed upload failed: cancelled, content_incomplete, verification_timeout, access_revoked. */
  errorCode: string | null;
  baseSnapshotId: string | null;
  resolvesConflictSnapshotIds: string[];
  manifestSha256: string;
  uploadDeadline: string;
  verificationDeadline: string | null;
  completedAt: string | null;
  result: {
    snapshotId: string;
    publicationOutcome: "published" | "conflict_saved";
    conflictedWithSnapshotId: string | null;
  } | null;
}

interface BlobRef {
  sha256: string;
  size: number;
}

export interface BeginResult extends UploadReceipt {
  /** Already saved in the base or a named conflict: never uploaded. */
  present: BlobRef[];
  /** To upload through upload-urls before submitting. */
  needed: BlobRef[];
  /** False for a replay of the same push under the same Idempotency-Key. */
  created: boolean;
}

export interface BeginRequest {
  idempotencyKey: string;
  baseSnapshotId: string | null;
  resolvesConflictSnapshotIds: string[];
  summary: { text: string; source: "user" | "agent" } | null;
  manifest: Manifest;
}

interface PartGrant {
  partNumber: number;
  length: number;
  url: string;
  headers: Record<string, string>;
}

export interface FileGrant {
  sha256: string;
  size: number;
  expiresAt: string;
  /** Files up to 64 MiB: one PUT. */
  url: string | null;
  headers: Record<string, string>;
  /** Files over 64 MiB: the file's one multipart upload, and the requested parts. */
  multipartUploadId: string | null;
  parts: PartGrant[];
}

export interface GrantRequest {
  sha256: string;
  multipartUploadId?: string;
  parts?: { partNumber: number; sha256: string }[];
}

export interface DownloadBatch {
  snapshotId: string;
  manifestSha256: string;
  continuationToken: string;
  continuationExpiresAt: string;
  urls: { sha256: string; size: number; url: string; expiresAt: string }[];
}

export interface Page<T> {
  items: T[];
  nextToken: string | null;
}

export type CompositionRead =
  | { at: "fresh"; composition: Composition; etag: string | null }
  | { at: "unchanged"; etag: string };

/** Whose binding: the backend's API host, the signed-in account (accountPrincipal) and the project's real path. */
export interface BindingKey {
  backend: string;
  account: string;
  projectPath: string;
}

/** A push recorded before its Begin is sent, so a lost answer is recovered by sending the same body under the same
 * Idempotency-Key; the upload's ids and deadlines land once an answer comes back. */
export interface InflightUpload {
  idempotencyKey: string;
  baseSnapshotId: string | null;
  resolvesConflictSnapshotIds: string[];
  summary: { text: string; source: "user" | "agent" } | null;
  manifest: ManifestDocument;
  manifestSha256: string;
  uploadId: string | null;
  snapshotId: string | null;
  uploadDeadline: string | null;
  verificationDeadline: string | null;
  begunAt: number;
  /** Files whose bytes reached staging, by SHA-256, so a resumed send does not write them again. */
  sent?: string[];
  /** Each multipart file's pinned upload and the parts already written, by the file's SHA-256. */
  multipart?: Record<string, { uploadId: string; partsDone: number[] }>;
}

export interface Binding extends BindingKey {
  version: 1;
  /** Client-generated, kept before the first request so a retried create names the same composition. */
  compositionId: string;
  ownerSpaceId: string;
  /** The owner workspace as the account's list last named it, so a project whose workspace the account left can
   * still be named. Absent from bindings made before it was kept, and until a list names the workspace. */
  owner?: { name: string; kind: "personal" | "team" };
  boundAt: number;
  /** The composition as last read, and the ETag it came with; null before the create was answered. */
  composition: Composition | null;
  etag: string | null;
  /** The snapshot this copy was last sent as or got from, with its manifest, so local changes need no network. */
  base: { snapshotId: string; manifest: ManifestDocument; manifestSha256: string } | null;
  inflight: InflightUpload | null;
  /** Set while Get from the cloud is filling a folder it made, until the folder is added to Home. Until then the
   * folder is not a project on this Mac, and the next Get of the composition finishes it. */
  gettingFromCloud?: true;
  /** What the marker that Get put in its folder holds: the only proof a file of that name there is not the person's. */
  getToken?: string;
  /** Set on the folder a Duplicate fills from the cloud: it is bound only while it downloads, so no Get ever opens
   * it, and its binding goes once latest is in (duplicate.mjs). */
  duplicate?: true;
  /** The conflicts this Mac's sends saved, newest last: Compare names them as this project's, not another
   * computer's. */
  savedHere?: string[];
  /** Set on a binding Work on {owner}'s project made from a share: the account reaches the owner's workspace through
   * that share's grant, not membership, so every request names the review project (sync-backed sharing C5). */
  sharedFrom?: SharedFrom;
}

/** The share a binding came from: its review project, the owner's name and their workspace's, as the share named
 * them when it was opened. */
export interface SharedFrom {
  reviewProjectId: string;
  owner: string;
  workspace: string | null;
}

/** A workspace's last refusal of a new composition: not admitted to sync yet, or encrypted (BYOK). */
export interface SpaceRefusal {
  kind: "not-enabled" | "byok";
  at: number;
}

/** One send or get under way for a project: the binding it owns until it ends, and where its states go. */
export interface UploadJob {
  api: import("./api.mjs").SourceApi;
  space: string;
  composition: string;
  uploadId: string;
  inflight: InflightUpload;
  local: Map<string, { path: string; full: string }>;
  needed: { sha256: string; size: number }[];
  fetchImpl: typeof fetch;
  wait: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal: AbortSignal;
  now: () => number;
  persist: () => void;
  onBytes: (bytes: number) => void;
  onFile: () => void;
}
