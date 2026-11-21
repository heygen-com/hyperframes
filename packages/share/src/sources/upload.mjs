// @ts-check
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { NotWritable, uploadNeeded } from "./uploadFiles.mjs";
import { parseStoredManifest } from "./manifest.mjs";
import { SyncApiError } from "./errors.mjs";

/** @typedef {import("./adapterTypes.js").SourceRun} SourceRun
 * @typedef {Pick<SourceRun, "binding" | "api" | "store">} SourceUpload
 * @typedef {import("./types.js").UploadReceipt} UploadReceipt */
/** @param {SourceUpload & Pick<SourceRun, "manifest">} run */
async function begin(run) {
  const { binding, manifest, api, store } = run;
  if (!binding.inflight) {
    binding.inflight = {
      idempotencyKey: randomUUID(),
      baseSnapshotId: binding.base?.snapshotId ?? null,
      resolvesConflictSnapshotIds: [],
      summary: null,
      manifest: manifest.document,
      manifestSha256: manifest.sha256,
      uploadId: null,
      snapshotId: null,
      uploadDeadline: null,
      verificationDeadline: null,
      begunAt: Date.now(),
      sent: [],
      multipart: {},
    };
    await store.write(binding);
  }
  const inflight = binding.inflight;
  const receipt = await api.begin(binding.ownerSpaceId, binding.compositionId, {
    ...inflight,
    manifest,
  });
  assertReceipt(binding, receipt);
  Object.assign(inflight, {
    uploadId: receipt.uploadId,
    snapshotId: receipt.snapshotId,
    uploadDeadline: receipt.uploadDeadline,
    verificationDeadline: receipt.verificationDeadline,
  });
  await store.write(binding);
  return receipt;
}
/** @param {SourceRun} run @param {import("./types.js").BeginResult} receipt */
async function sendFiles(run, receipt) {
  const { binding, manifest, store } = run;
  if (!binding.inflight) throw new Error("Missing source upload intent.");
  const local = new Map(
    manifest.document.files.map((file) => [
      file.sha256,
      { path: file.path, full: join(binding.projectPath, file.path) },
    ]),
  );
  const known = new Map(manifest.document.files.map((file) => [file.sha256, file.size]));
  for (const blob of receipt.needed)
    if (known.get(blob.sha256) !== blob.size)
      throw new Error("Upload requested an unknown source file.");
  let persisted = Promise.resolve();
  await uploadNeeded({
    api: run.api,
    space: binding.ownerSpaceId,
    composition: binding.compositionId,
    uploadId: receipt.uploadId,
    inflight: binding.inflight,
    local,
    needed: receipt.needed,
    fetchImpl: run.fetchImpl,
    wait: run.wait,
    signal: run.signal,
    now: Date.now,
    persist: () => {
      persisted = persisted.then(() => store.write(binding));
    },
    onBytes: run.onProgress,
    onFile: () => {},
  }).finally(() => persisted);
  return run.api.submit(binding.ownerSpaceId, binding.compositionId, receipt.uploadId);
}
/** @param {SourceUpload["binding"]} binding @param {UploadReceipt} receipt */
function assertReceipt(binding, receipt) {
  const saved = binding.inflight;
  if (!saved || receipt.manifestSha256 !== saved.manifestSha256)
    throw new Error("Source upload receipt does not match the captured project.");
  if (receipt.compositionId !== binding.compositionId)
    throw new Error("Source upload receipt does not match the composition.");
  if (saved.uploadId !== null && receipt.uploadId !== saved.uploadId)
    throw new Error("Source upload receipt identity changed.");
  if (saved.snapshotId !== null && receipt.snapshotId !== saved.snapshotId)
    throw new Error("Source snapshot identity changed.");
}

/** @param {SourceUpload} job @param {UploadReceipt} receipt */
async function storePublished({ binding, store }, receipt) {
  const saved = binding.inflight;
  const result = receipt.result;
  if (!saved || !result || result.snapshotId !== receipt.snapshotId)
    throw new Error("Source snapshot identity changed.");
  binding.base = {
    snapshotId: result.snapshotId,
    manifest: saved.manifest,
    manifestSha256: saved.manifestSha256,
  };
  await clearIntent({ binding, store });
}

/** @param {Pick<SourceUpload, "binding" | "store">} job */
async function clearIntent({ binding, store }) {
  binding.inflight = null;
  await store.write(binding);
}

/** @param {SourceUpload} job @param {UploadReceipt} receipt */
async function cancelPending({ binding, api }, receipt) {
  const { ownerSpaceId, compositionId } = binding;
  try {
    return await api.cancel(ownerSpaceId, compositionId, receipt.uploadId);
  } catch (error) {
    if (!(error instanceof SyncApiError) || error.kind !== "upload-not-pending") throw error;
    return api.status(ownerSpaceId, compositionId, receipt.uploadId);
  }
}

/** Resolve an older capture before starting an upload for the current files.
 * @param {SourceUpload} job @returns {Promise<import("./adapterTypes.js").SourceResult | null>} */
export async function recoverSourceUpload(job) {
  const { binding, api } = job;
  const saved = binding.inflight;
  if (!saved) return null;
  const manifest = parseStoredManifest(saved.manifest);
  if (manifest.sha256 !== saved.manifestSha256)
    throw new Error("Saved source upload manifest does not match its checksum.");
  let receipt = saved.uploadId
    ? await api.status(binding.ownerSpaceId, binding.compositionId, saved.uploadId)
    : await begin({ ...job, manifest });
  assertReceipt(binding, receipt);
  if (receipt.status === "pending") receipt = await cancelPending(job, receipt);
  assertReceipt(binding, receipt);
  return recoverReceipt(job, receipt);
}

/** @param {SourceUpload} job @param {UploadReceipt} receipt */
async function recoverReceipt(job, receipt) {
  if (receipt.status === "completed") {
    if (receipt.result?.publicationOutcome !== "published")
      return { at: /** @type {const} */ ("unavailable"), reason: "source_conflict" };
    await storePublished(job, receipt);
  } else if (terminalFailure(receipt)) await clearIntent(job);
  else return { at: /** @type {const} */ ("unavailable"), reason: "source_verification_pending" };
  return null;
}

/** @param {UploadReceipt} receipt */
const terminalFailure = (receipt) => receipt.status === "failed" || receipt.status === "expired";

/** Only published verification results can become share source; conflict_saved is preserved for explicit recovery.
 * @param {SourceRun} run @returns {Promise<import("./adapterTypes.js").SourceResult>} */
export async function uploadSource(run) {
  const receipt = await begin(run);
  let status;
  try {
    status = receipt.status === "pending" ? await sendFiles(run, receipt) : receipt;
  } catch (error) {
    if (!(error instanceof NotWritable)) throw error;
    return (
      (await recoverSourceUpload(run)) ?? {
        at: "unavailable",
        reason: "source_upload_not_writable",
      }
    );
  }
  const deadline = Date.now() + run.timeoutMs;
  while (status.status === "verifying") {
    run.signal.throwIfAborted();
    if (Date.now() >= deadline) return { at: "unavailable", reason: "source_verification_pending" };
    await run.wait(1000, run.signal);
    status = await run.api.status(
      run.binding.ownerSpaceId,
      run.binding.compositionId,
      receipt.uploadId,
    );
  }
  assertReceipt(run.binding, status);
  if (status.status !== "completed" || !status.result) {
    if (terminalFailure(status)) await clearIntent(run);
    return { at: "unavailable", reason: status.errorCode ?? `source_upload_${status.status}` };
  }
  if (status.result.publicationOutcome !== "published")
    return { at: "unavailable", reason: "source_conflict" };
  await storePublished(run, status);
  return {
    at: "ready",
    snapshot: {
      space_id: run.binding.ownerSpaceId,
      composition_id: run.binding.compositionId,
      snapshot_id: status.snapshotId,
    },
  };
}
