// @ts-check
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { uploadNeeded } from "./uploadFiles.mjs";

/** @typedef {import("./adapterTypes").SourceRun} SourceRun */
/** @param {SourceRun} run */
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
  if (receipt.manifestSha256 !== manifest.sha256 || receipt.compositionId !== binding.compositionId)
    throw new Error("Source upload receipt does not match the captured project.");
  Object.assign(inflight, {
    uploadId: receipt.uploadId,
    snapshotId: receipt.snapshotId,
    uploadDeadline: receipt.uploadDeadline,
    verificationDeadline: receipt.verificationDeadline,
  });
  await store.write(binding);
  return receipt;
}
/** @param {SourceRun} run @param {import("./types").BeginResult} receipt */
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
/** Only published verification results can become share source; conflict_saved is preserved for explicit recovery.
 * @param {SourceRun} run @returns {Promise<import("./adapterTypes").SourceResult>} */
export async function uploadSource(run) {
  let receipt = await begin(run);
  let status = receipt.status === "pending" ? await sendFiles(run, receipt) : receipt;
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
  if (
    status.manifestSha256 !== run.manifest.sha256 ||
    status.uploadId !== receipt.uploadId ||
    status.compositionId !== run.binding.compositionId ||
    status.snapshotId !== receipt.snapshotId
  )
    throw new Error("Source verification receipt identity changed.");
  if (status.status !== "completed" || !status.result)
    return { at: "unavailable", reason: status.errorCode ?? `source_upload_${status.status}` };
  if (status.result.publicationOutcome !== "published")
    return { at: "unavailable", reason: "source_conflict" };
  if (status.result.snapshotId !== status.snapshotId)
    throw new Error("Source snapshot identity changed.");
  run.binding.base = {
    snapshotId: status.result.snapshotId,
    manifest: run.manifest.document,
    manifestSha256: run.manifest.sha256,
  };
  run.binding.inflight = null;
  await run.store.write(run.binding);
  return {
    at: "ready",
    snapshot: {
      space_id: run.binding.ownerSpaceId,
      composition_id: run.binding.compositionId,
      snapshot_id: status.result.snapshotId,
    },
  };
}
