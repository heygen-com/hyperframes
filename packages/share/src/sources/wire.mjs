// @ts-check
// Parse and validate sync API responses at the transport boundary.
import { ManifestInvalid, parseStoredManifest } from "./manifest.mjs";
import { SyncApiError } from "./errors.mjs";

/** @typedef {import("./types.js").SyncLimitsRead} SyncLimitsRead
 * @typedef {import("./types.js").Composition} Composition @typedef {import("./types.js").Snapshot} Snapshot
 * @typedef {import("./types.js").UploadReceipt} UploadReceipt @typedef {import("./types.js").BeginResult} BeginResult
 * @typedef {import("./types.js").FileGrant} FileGrant @typedef {import("./types.js").DownloadBatch} DownloadBatch */

/** @param {string} field */
const malformed = (field) =>
  new SyncApiError("malformed", { detail: `missing or mistyped ${field}` });

/** @param {unknown} value @param {string} field @returns {Record<string, unknown>} */
export function objectOf(value, field) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw malformed(field);
  return /** @type {Record<string, unknown>} */ (value);
}
/** @param {Record<string, unknown>} o @param {string} key @returns {string} */
const str = (o, key) => {
  const value = o[key];
  if (typeof value !== "string") throw malformed(key);
  return value;
};
/** Absent (the server drops nulls) reads as null. @param {Record<string, unknown>} o @param {string} key */
const optStr = (o, key) => (o[key] === undefined || o[key] === null ? null : str(o, key));
/** @param {Record<string, unknown>} o @param {string} key @returns {number} */
const int = (o, key) => {
  const value = o[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw malformed(key);
  return value;
};
/** @param {Record<string, unknown>} o @param {string} key @returns {unknown[]} */
const list = (o, key) => {
  const value = o[key] ?? [];
  if (!Array.isArray(value)) throw malformed(key);
  return value;
};
/** @param {Record<string, unknown>} o @param {string} key @returns {Record<string, string>} */
const headers = (o, key) => {
  const value = objectOf(o[key] ?? {}, key);
  return Object.fromEntries(Object.keys(value).map((name) => [name, str(value, name)]));
};
/** @template {string} T @param {Record<string, unknown>} o @param {string} key @param {readonly T[]} allowed
 * @returns {T} */
const oneOf = (o, key, allowed) => {
  const value = str(o, key);
  if (!allowed.includes(/** @type {T} */ (value))) throw malformed(key);
  return /** @type {T} */ (value);
};

/** @param {unknown} raw @returns {Composition} */
export function compositionOf(raw) {
  const o = objectOf(raw, "composition");
  return {
    id: str(o, "id"),
    spaceId: str(o, "space_id"),
    title: str(o, "title"),
    createdBy: str(o, "created_by"),
    latestSnapshotId: optStr(o, "latest_snapshot_id"),
    createdAt: str(o, "created_at"),
    updatedAt: str(o, "updated_at"),
  };
}

/** The snapshot's manifest, trusted only when its canonical bytes hash to the snapshot's manifest_sha256.
 * @param {unknown} raw @param {string} sha256 */
function snapshotManifestOf(raw, sha256) {
  const o = objectOf(raw, "manifest");
  try {
    const manifest = parseStoredManifest(o.document);
    if (manifest.sha256 !== sha256) throw malformed("manifest.document (sha256)");
    return manifest;
  } catch (error) {
    if (error instanceof ManifestInvalid) throw malformed(`manifest.document (${error.code})`);
    throw error;
  }
}

/** @param {unknown} raw @returns {Snapshot} */
export function snapshotOf(raw) {
  const o = objectOf(raw, "snapshot");
  const manifestSha256 = str(o, "manifest_sha256");
  const state = optStr(o, "conflict_state");
  if (state !== null && !["open", "resolved", "discarded"].includes(state))
    throw malformed("conflict_state");
  return {
    id: str(o, "id"),
    compositionId: str(o, "composition_id"),
    baseSnapshotId: optStr(o, "base_snapshot_id"),
    publicationOutcome: oneOf(
      o,
      "publication_outcome",
      /** @type {const} */ (["published", "conflict_saved"]),
    ),
    conflictedWithSnapshotId: optStr(o, "conflicted_with_snapshot_id"),
    conflictState: /** @type {Snapshot["conflictState"]} */ (state),
    resolvedBySnapshotId: optStr(o, "resolved_by_snapshot_id"),
    createdBy: str(o, "created_by"),
    createdByName: optStr(o, "created_by_name"),
    clientType: str(o, "client_type"),
    summary: optStr(o, "summary"),
    summarySource: str(o, "summary_source"),
    manifestSha256,
    createdAt: str(o, "created_at"),
    manifest: o.manifest === undefined ? null : snapshotManifestOf(o.manifest, manifestSha256),
  };
}

const UPLOAD_STATUSES = /** @type {const} */ ([
  "pending",
  "verifying",
  "completed",
  "failed",
  "expired",
]);

/** @param {unknown} raw @returns {UploadReceipt} */
export function uploadOf(raw) {
  const o = objectOf(raw, "upload");
  const result = o.result === undefined || o.result === null ? null : objectOf(o.result, "result");
  return {
    uploadId: str(o, "upload_id"),
    compositionId: str(o, "composition_id"),
    snapshotId: str(o, "snapshot_id"),
    status: oneOf(o, "status", UPLOAD_STATUSES),
    errorCode: optStr(o, "error_code"),
    baseSnapshotId: optStr(o, "base_snapshot_id"),
    resolvesConflictSnapshotIds: list(o, "resolves_conflict_snapshot_ids").map((id) => {
      if (typeof id !== "string") throw malformed("resolves_conflict_snapshot_ids");
      return id;
    }),
    manifestSha256: str(o, "manifest_sha256"),
    uploadDeadline: str(o, "upload_deadline"),
    verificationDeadline: optStr(o, "verification_deadline"),
    completedAt: optStr(o, "completed_at"),
    result: result && {
      snapshotId: str(result, "snapshot_id"),
      publicationOutcome: oneOf(
        result,
        "publication_outcome",
        /** @type {const} */ (["published", "conflict_saved"]),
      ),
      conflictedWithSnapshotId: optStr(result, "conflicted_with_snapshot_id"),
    },
  };
}

/** @param {unknown} raw @param {string} field */
const blobsOf = (raw, field) =>
  list(objectOf(raw, field), field).map((item) => {
    const blob = objectOf(item, field);
    return { sha256: str(blob, "sha256"), size: int(blob, "size") };
  });

/** @param {unknown} raw @param {boolean} created @returns {BeginResult} */
export const beginOf = (raw, created) => ({
  ...uploadOf(raw),
  present: blobsOf(raw, "present"),
  needed: blobsOf(raw, "needed"),
  created,
});

/** @param {unknown} raw @returns {FileGrant[]} */
export const grantsOf = (raw) =>
  list(objectOf(raw, "grants"), "files").map((item) => {
    const o = objectOf(item, "files");
    return {
      sha256: str(o, "sha256"),
      size: int(o, "size"),
      expiresAt: str(o, "expires_at"),
      url: optStr(o, "url"),
      headers: headers(o, "headers"),
      multipartUploadId: optStr(o, "multipart_upload_id"),
      parts: list(o, "parts").map((part) => {
        const p = objectOf(part, "parts");
        return {
          partNumber: int(p, "part_number"),
          length: int(p, "length"),
          url: str(p, "url"),
          headers: headers(p, "headers"),
        };
      }),
    };
  });

/** @param {unknown} raw @returns {Extract<SyncLimitsRead, { at: "read" }>} */
export function syncLimitsOf(raw) {
  const o = objectOf(raw, "limits answer");
  const limits = objectOf(o.limits, "limits");
  if (typeof o.sync_allowed !== "boolean") throw malformed("sync_allowed");
  return {
    at: "read",
    syncAllowed: o.sync_allowed,
    maxCompositions: int(limits, "max_compositions"),
    compositions: int(objectOf(o.usage, "usage"), "compositions"),
    push: {
      maxFiles: int(limits, "max_files"),
      maxFileBytes: int(limits, "max_file_bytes"),
      maxProjectBytes: int(limits, "max_project_bytes"),
      maxManifestBytes: int(limits, "max_manifest_bytes"),
    },
  };
}
