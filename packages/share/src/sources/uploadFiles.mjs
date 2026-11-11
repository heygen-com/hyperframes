// @ts-check
// The files a Begin said are needed, written to the upload's staging through signed URLs: one PUT for a file up to
// 64 MiB, parts of 64 MiB above that through the file's one pinned multipart upload. URLs live at most 15 minutes, so
// one about to end is asked for again; a send resumed after a quit skips what the in-flight record says was written.
import { SyncApiError } from "./errors.mjs";
import {
  TransferError,
  backoffMs,
  eachLimit,
  isAbort,
  partDigests,
  putRange,
} from "./transfer.mjs";
import { lstat } from "node:fs/promises";

/** @typedef {import("./types.js").FileGrant} FileGrant @typedef {import("./types.js").GrantRequest} GrantRequest
 * @typedef {import("./types.js").InflightUpload} InflightUpload */

/** The server's single-PUT ceiling and part size. */
const PART_BYTES = 64 * 1024 * 1024;
const GRANT_FILES = 100;
const PARTS_PER_GRANT = 8;
const AT_ONCE = 4;
const ATTEMPTS = 5;
/** A URL with less than this left is asked for again rather than started. */
const URL_MARGIN_MS = 60_000;

/** The file's multipart upload can take no more parts (`hyperframes_composition_upload_file_not_writable`): this
 * upload cannot finish, so its owner must resolve it before a retry can begin a new one. */
export class NotWritable extends Error {
  constructor() {
    super("composition sync: a file's multipart upload can no longer take parts");
    this.name = "NotWritable";
  }
}

/** @typedef {import("./types.js").UploadJob} UploadJob */

/** @param {UploadJob} job @param {unknown} error @param {number} attempt the attempt that just failed, from 1
 * @returns {Promise<boolean>} whether to try again */
async function againAfter(job, error, attempt) {
  if (attempt >= ATTEMPTS || isAbort(error)) return false;
  const transient =
    (error instanceof TransferError && (error.kind === "transient" || error.kind === "corrupt")) ||
    (error instanceof SyncApiError &&
      ["offline", "unavailable", "server-error", "rate-limited"].includes(error.kind));
  if (!transient) return false;
  const asked = error instanceof SyncApiError ? error.retryAfterMs : null;
  await job.wait(backoffMs(attempt, asked), job.signal);
  return true;
}

/** A refusal of a pinned multipart id, which its refusal says to drop and ask again without.
 * @param {unknown} error @param {GrantRequest[]} asked */
const wrongPinnedId = (error, asked) =>
  error instanceof SyncApiError &&
  error.kind === "invalid-parameter" &&
  (error.param ?? "").endsWith("multipart_upload_id") &&
  asked.some((file) => file.multipartUploadId);

/** Write grants for `files`, sent again on a transient failure. A file that can take no more parts throws NotWritable.
 * @param {UploadJob} job @param {GrantRequest[]} files @returns {Promise<FileGrant[]>} */
async function grant(job, files) {
  let asked = files;
  for (let attempt = 1; ; attempt++) {
    try {
      return await job.api.uploadUrls(job.space, job.composition, job.uploadId, asked);
    } catch (error) {
      if (error instanceof SyncApiError && error.kind === "file-not-writable")
        throw new NotWritable();
      if (wrongPinnedId(error, asked))
        asked = asked.map(({ multipartUploadId: _dropped, ...file }) => file);
      else if (!(await againAfter(job, error, attempt))) throw error;
    }
  }
}

/** @param {UploadJob} job @param {string} sha256 */
function localFile(job, sha256) {
  const file = job.local.get(sha256);
  if (!file) throw new Error(`composition sync: needed file ${sha256} is not in the capture`);
  return file;
}

/** @typedef {{ url: string, headers: Record<string, string>, expiresAt: string }} Signed
 * @typedef {{ number: number, sha256: string, start: number, length: number }} Part
 * @typedef {{ file: { path: string, full: string }, start: number, length: number, sha256: string }} Bytes */

/** One PUT attempt: `done` once stored (or found already stored), `expired` when storage says the URL has, else the
 * failure. Bytes counted for an attempt that failed are taken back.
 * @param {UploadJob} job @param {Signed} held @param {Bytes} bytes
 * @returns {Promise<"done" | "expired" | { failed: unknown }>} */
async function attemptPut(job, held, { file, ...range }) {
  let sent = 0;
  try {
    await putRange({
      fetchImpl: job.fetchImpl,
      url: held.url,
      headers: held.headers,
      file: file.full,
      path: file.path,
      ...range,
      signal: job.signal,
      onBytes: (count) => ((sent += count), job.onBytes(count)),
    });
    return "done";
  } catch (error) {
    job.onBytes(-sent);
    if (!(error instanceof TransferError)) return { failed: error };
    if (error.kind === "exists") return (job.onBytes(range.length), "done");
    return error.kind === "expired" ? "expired" : { failed: error };
  }
}

/** Writes `bytes` through `given`, or a fresh grant when it is missing or about to end; asks again when storage says
 * the URL ended, and sends again after a transient failure.
 * @param {UploadJob} job @param {Signed | null} given @param {() => Promise<Signed>} fresh @param {Bytes} bytes */
async function putWithGrant(job, given, fresh, bytes) {
  const usable = (/** @type {Signed | null} */ signed) =>
    signed && Date.parse(signed.expiresAt) - job.now() >= URL_MARGIN_MS ? signed : null;
  let held = usable(given);
  for (let attempt = 1; ; attempt++) {
    held ??= await fresh();
    const outcome = await attemptPut(job, held, bytes);
    if (outcome === "done") return;
    if (outcome === "expired" && attempt < ATTEMPTS) held = null;
    else {
      const failed = outcome === "expired" ? new TransferError("expired") : outcome.failed;
      if (!(await againAfter(job, failed, attempt))) throw failed;
    }
  }
}

/** @param {FileGrant | undefined} held @returns {Signed} */
function singleUrl(held) {
  if (!held?.url) throw new Error("composition sync: a single-PUT grant came without its URL");
  return { url: held.url, headers: held.headers, expiresAt: held.expiresAt };
}

/** Files up to 64 MiB: grants a hundred at a time, written four at once. @param {UploadJob} job
 * @param {{ sha256: string, size: number }[]} blobs */
async function sendSmall(job, blobs) {
  for (let at = 0; at < blobs.length; at += GRANT_FILES) {
    const batch = blobs.slice(at, at + GRANT_FILES);
    const grants = await grant(
      job,
      batch.map((blob) => ({ sha256: blob.sha256 })),
    );
    const bySha = new Map(grants.map((one) => [one.sha256, one]));
    await eachLimit(batch, AT_ONCE, async (blob) => {
      const given = bySha.has(blob.sha256) ? singleUrl(bySha.get(blob.sha256)) : null;
      const fresh = async () => singleUrl((await grant(job, [{ sha256: blob.sha256 }]))[0]);
      const bytes = {
        file: localFile(job, blob.sha256),
        start: 0,
        length: blob.size,
        sha256: blob.sha256,
      };
      await putWithGrant(job, given, fresh, bytes);
      (job.inflight.sent ??= []).push(blob.sha256);
      job.persist();
      job.onFile();
    });
  }
}

/** Grants for `parts` of a multipart file, naming its pinned upload once one is known, and keeping the id the server
 * pins. @param {UploadJob} job @param {{ sha256: string }} blob @param {Part[]} parts */
async function partGrants(job, blob, parts) {
  const pinned = job.inflight.multipart?.[blob.sha256];
  const [held] = await grant(job, [
    {
      sha256: blob.sha256,
      ...(pinned && { multipartUploadId: pinned.uploadId }),
      parts: parts.map((part) => ({ partNumber: part.number, sha256: part.sha256 })),
    },
  ]);
  if (!held?.multipartUploadId)
    throw new Error("composition sync: a multipart grant came without its upload id");
  // Parts recorded as written belong to the pinned upload; another id would leave them unwritten.
  if (pinned && pinned.uploadId !== held.multipartUploadId) throw new NotWritable();
  if (!pinned) {
    job.inflight.multipart = {
      ...job.inflight.multipart,
      [blob.sha256]: { uploadId: held.multipartUploadId, partsDone: [] },
    };
    job.persist();
  }
  return { expiresAt: held.expiresAt, parts: held.parts };
}

/** The file's parts still to write, each with its SHA-256; throws `changed` when the file no longer hashes to the
 * captured SHA-256. @param {UploadJob} job @param {{ sha256: string, size: number }} blob
 * @returns {Promise<Part[]>} */
async function partsToSend(job, blob) {
  const file = localFile(job, blob.sha256);
  const digests = await partDigests(file.full, blob.size, PART_BYTES, job.signal).catch((error) => {
    if (isAbort(error)) throw error;
    throw new TransferError("unreadable", { path: file.path });
  });
  if (digests.whole !== blob.sha256 || !digests.complete)
    throw new TransferError("changed", { path: file.path });
  const done = new Set(job.inflight.multipart?.[blob.sha256]?.partsDone ?? []);
  return digests.parts
    .map((sha256, index) => ({
      number: index + 1,
      sha256,
      start: index * PART_BYTES,
      length: Math.min(PART_BYTES, blob.size - index * PART_BYTES),
    }))
    .filter((part) => !done.has(part.number));
}

/** A file over 64 MiB, eight parts a grant, four parts at once; its size and time are compared after, so a file that
 * changed while its parts were read fails as changed. @param {UploadJob} job
 * @param {{ sha256: string, size: number }} blob */
async function sendLarge(job, blob) {
  const file = localFile(job, blob.sha256);
  const before = await lstat(file.full);
  const parts = await partsToSend(job, blob);
  job.onBytes(blob.size - parts.reduce((sum, part) => sum + part.length, 0));
  for (let at = 0; at < parts.length; at += PARTS_PER_GRANT) {
    const batch = parts.slice(at, at + PARTS_PER_GRANT);
    const granted = await partGrants(job, blob, batch);
    const byNumber = new Map(granted.parts.map((part) => [part.partNumber, part]));
    await eachLimit(batch, AT_ONCE, async (part) => {
      const signed = byNumber.get(part.number);
      const given = signed
        ? { url: signed.url, headers: signed.headers, expiresAt: granted.expiresAt }
        : null;
      const fresh = async () => {
        const again = await partGrants(job, blob, [part]);
        const one = again.parts[0];
        if (!one) throw new Error("composition sync: a part grant came without its part");
        return { url: one.url, headers: one.headers, expiresAt: again.expiresAt };
      };
      await putWithGrant(job, given, fresh, { file, ...part });
      job.inflight.multipart?.[blob.sha256]?.partsDone.push(part.number);
      job.persist();
    });
  }
  const after = await lstat(file.full).catch(() => null);
  if (!after || after.size !== before.size || after.mtimeMs !== before.mtimeMs)
    throw new TransferError("changed", { path: file.path });
  (job.inflight.sent ??= []).push(blob.sha256);
  job.persist();
  job.onFile();
}

/** Writes every needed file the in-flight record does not list as sent. @param {UploadJob} job */
export async function uploadNeeded(job) {
  const sent = new Set(job.inflight.sent ?? []);
  const waiting = job.needed.filter((blob) => !sent.has(blob.sha256));
  for (const blob of job.needed.filter((one) => sent.has(one.sha256))) {
    job.onBytes(blob.size);
    job.onFile();
  }
  await sendSmall(
    job,
    waiting.filter((blob) => blob.size <= PART_BYTES),
  );
  for (const blob of waiting.filter((one) => one.size > PART_BYTES)) await sendLarge(job, blob);
}
