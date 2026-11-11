// @ts-check
// Adding a version to a project's review page: the newest MP4 export goes up, then the server
// processes and screens it. Main owns the run, so closing the Share popover never stops it.
import { ShareBusyError, withProjectShareLock } from "./projectLock.mjs";
import { runFile } from "./host.mjs";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { ffBinary, latestExportFile, normalize, projectFingerprint } from "./host.mjs";
import { mkdirInside } from "./storage.mjs";
import {
  isJsonObject,
  isNullableSavedId,
  isOptionalBoolean,
  isOptionalSavedId,
  isSavedId,
  readJsonRecord,
  SharingStateError,
  writeJsonAtomic,
} from "./storage.mjs";
import { ReviewFailed } from "./reviewClient.mjs";
import { readFromReview, sharedFromReview } from "./fromReview.mjs";
import { reviewProjectId } from "./reviewShare.mjs";
import { fileSha256Base64, putFile } from "./reviewUpload.mjs";
import { versionSentence } from "./reviewVersionSentences.mjs";

/** @typedef {import("./reviewClient.mjs").ReviewClient} ReviewClient
 * @typedef {import("./types/reviewWire.js").ExportDTO} ExportDTO @typedef {import("./types/reviewWire.js").ExportRequest} ExportRequest
 * @typedef {import("./types/share.js").ReviewVersion} ReviewVersion */

/** @typedef {import("./types/share.js").ReviewExportProgress} ReviewExportProgress
 * @typedef {{ duration: number, width: number, height: number }} VideoFacts
 * @typedef {import("./fromReview.mjs").FromReview} FromReview
 * @typedef {{ since: number, value?: "yes" | "no" }} ReviewSent
 * @typedef {{ files: boolean, first: boolean, fromReview?: "yes" | "no" }} Added */

/** `pending`: the create body as sent and its video once answered, so a retry is the same; `snapshotRefused`: the
 * server refused its snapshot, so it goes up video-only; `unanswered`: its create may have gone out without a
 * definitive result; `reviewSent`: cleanup cutoff, with attribution only when the accepted attempt is
 * known; `last`: the newest version.
 * @typedef {{ pending: { body: ExportRequest, videoId: string | null, projectId?: string | null,
 *   checkingSince?: number, snapshotRefused?: boolean, unanswered?: boolean, reviewSent?: ReviewSent } | null,
 *   last: { fingerprint: string, versionId: string, exportedAt: string, projectId: string, files?: boolean, checksum?: string }
 *   | null }} VersionRecord */

/** `onAdded`: a version went ready, with whether it carries files and whether it is the page's first from here.
 * @typedef {{ onProgress?: (progress: ReviewExportProgress | null) => void, onUploaded?: () => Promise<void>,
 *   open?: () => boolean, onAdded?: (added: Added) => void }} VersionHooks */

/** `projectId` overrides the recorded review project; `open`: a held video is watched only while the project is open.
 * `filesForExport`: the synced snapshot a new version carries, null for
 * none.
 * @typedef {VersionHooks & { projectPath: string, title: string, client: ReviewClient, put?: typeof putFile,
 *   sleep?: (ms: number) => Promise<void>, probe?: (file: string) => Promise<VideoFacts | null>, now?: () => number,
 *   projectId?: string | null, filesForExport?: FilesForRender, fromReview?: FromReview | null }} VersionRequest */

/** The snapshot of `rendered`, the project as the export was rendered; null when the folder is not that render.
 * @typedef {(projectPath: string, rendered: string | null) => Promise<import("./types/reviewWire.js").SnapshotRef | null>}
 *   FilesForRender */

const POLL_MS = 2_000;
/** Screening past this says it can take a while and is polled every SLOW_POLL_MS: staff review has no time limit. */
const SLOW_AFTER_MS = 2 * 60_000;
/** A server that says how screening stands: checking past this since the upload says it is taking longer than usual,
 * and the watch keeps going as long again after it. */
const LATE_AFTER_MS = 15 * 60_000;
const SLOW_POLL_MS = 30_000;
/** Refusals the same video would get again: no Try again. */
const FINAL = new Set(["export_blocked", "content_rejected", "feature_unavailable"]);
/** Too big or too long: the same file is refused again, but a smaller or shorter export can go up. */
const TOO_BIG = new Set(["export_too_large", "export_too_long"]);
const UNCONFIRMED_VERSION =
  "Couldn't confirm whether the previous version was created. Check the review page. To add a new version, change the export settings and export again.";
/** Longer than the backend's own limiter ever asks, and short enough that a laptop waking up checks again soon. */
const MAX_WAIT_MS = 5 * 60_000;
/** A run stops watching after this long; the video stays recorded, so the next press reads it back. */
const WATCH_MS = 15 * 60_000;
/** A held video waits on a person at HeyGen, which the sentence says can take up to a day: it is watched that long,
 * at SLOW_POLL_MS, while its project stays open. */
const HELD_WATCH_MS = 24 * 60 * 60_000;
/** The backend's limits, checked before hashing or uploading anything. */
const MAX_BYTES = 2 * 1024 ** 3;
const MAX_SECONDS = 30 * 60;

const run$ = runFile;
const statePath = (/** @type {string} */ dir) =>
  path.join(dir, ".hyperframes", "review-export.json");

/** The MP4's own picture size and length: the backend checks the upload against them, so never the canvas.
 * @param {string} file @returns {Promise<VideoFacts | null>} */
async function probeVideo(file) {
  try {
    const args = [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height:format=duration",
      "-of",
      "json",
      "--",
      file,
    ];
    const { stdout } = await run$(ffBinary("ffprobe"), args);
    return factsOf(stdout);
  } catch {
    return null;
  }
}

/** ffprobe's JSON as facts, or null when it names no picture or no length. @param {string} stdout */
export function factsOf(stdout) {
  const facts = JSON.parse(stdout);
  const { width, height } = facts.streams?.[0] ?? {};
  const duration = Number.parseFloat(facts.format?.duration);
  return width > 0 && height > 0 && duration > 0 ? { duration, width, height } : null;
}

/** @param {unknown} upload */
const isSavedUpload = (upload) =>
  isJsonObject(upload) &&
  Number.isSafeInteger(upload.size_bytes) &&
  isSavedId(upload.checksum_sha256) &&
  upload.content_type === "video/mp4";

/** @param {unknown} snapshot */
const isOptionalSnapshot = (snapshot) =>
  snapshot === undefined ||
  (isJsonObject(snapshot) &&
    isSavedId(snapshot.space_id) &&
    isSavedId(snapshot.composition_id) &&
    isSavedId(snapshot.snapshot_id));

/** @param {Record<string, unknown>} body */
const isSavedExportSource = (body) =>
  body.source_revision_id === null &&
  (body.source_fingerprint == null || typeof body.source_fingerprint === "string") &&
  isOptionalSnapshot(body.snapshot);

/** @param {unknown} body */
function isSavedExportBody(body) {
  if (!isJsonObject(body)) return false;
  return (
    isSavedId(body.client_operation_id) &&
    typeof body.title_snapshot === "string" &&
    [body.coordinate_width, body.coordinate_height, body.duration_seconds].every(Number.isFinite) &&
    isJsonObject(body.render_settings) &&
    isSavedUpload(body.local_upload) &&
    isSavedExportSource(body)
  );
}

/** @param {unknown} value @returns {value is NonNullable<VersionRecord["pending"]>} */
const isPending = (value) =>
  isJsonObject(value) &&
  isSavedExportBody(value.body) &&
  isNullableSavedId(value.videoId) &&
  isOptionalSavedId(value.projectId) &&
  (value.checkingSince === undefined || Number.isFinite(value.checkingSince)) &&
  isOptionalBoolean(value.snapshotRefused) &&
  isOptionalBoolean(value.unanswered) &&
  isOptionalReviewSent(value.reviewSent);

/** @param {unknown} sent */
const isOptionalReviewSent = (sent) =>
  sent === undefined ||
  (isJsonObject(sent) &&
    Number.isFinite(sent.since) &&
    (sent.value === undefined || sent.value === "yes" || sent.value === "no"));

/** @typedef {Omit<NonNullable<VersionRecord["last"]>, "fingerprint"> & {fingerprint?: string}} SavedLast */

/** @param {unknown} value @returns {value is SavedLast} */
function isLast(value) {
  return (
    isJsonObject(value) &&
    (value.fingerprint === undefined || typeof value.fingerprint === "string") &&
    isSavedId(value.versionId) &&
    isSavedId(value.exportedAt) &&
    isSavedId(value.projectId) &&
    isOptionalBoolean(value.files) &&
    (value.checksum === undefined || isSavedId(value.checksum))
  );
}

/** @param {Record<string, unknown>} saved
 * @returns {saved is {pending?: VersionRecord["pending"], last?: SavedLast | null}} */
const isExportState = (saved) =>
  ("pending" in saved || "last" in saved) &&
  (saved.pending == null || isPending(saved.pending)) &&
  (saved.last == null || isLast(saved.last));

/** @param {string} dir @returns {Promise<VersionRecord>} */
async function readState(dir) {
  const file = statePath(dir);
  const saved = await readJsonRecord(file);
  if (!saved) return { pending: null, last: null };
  if (!isExportState(saved)) throw new SharingStateError(file);
  const { last, pending } = saved;
  return {
    pending: pending ?? null,
    last: typeof last?.fingerprint === "string" ? { ...last, fingerprint: last.fingerprint } : null,
  };
}

/** @param {string} dir @param {VersionRecord} state */
async function writeState(dir, state) {
  await mkdirInside(dir, ".hyperframes");
  await writeJsonAtomic(statePath(dir), state);
}

/** @typedef {{ sentence: string, final: boolean, exportHelps: boolean, held?: boolean }} Said
 * @typedef {Said & { exportKey: string }} Failure */
/** @param {unknown} error @param {boolean} [refusedReplay] @returns {Said} */
function said(error, refusedReplay = false) {
  const sentence = versionSentence(error, refusedReplay ? UNCONFIRMED_VERSION : undefined);
  const exportHelps =
    sentence === UNCONFIRMED_VERSION ||
    (error instanceof ReviewFailed && TOO_BIG.has(error.reason));
  return {
    sentence,
    final: exportHelps || (error instanceof ReviewFailed && FINAL.has(error.reason)),
    exportHelps,
    ...(error instanceof ReviewFailed && error.reason === "held_for_review" && { held: true }),
  };
}

/** A failure found here, before the server: fixing the export fixes it. @param {string} sentence @returns {Said} */
const local = (sentence) => ({ sentence, final: false, exportHelps: false });

/** @type {Map<string, ReviewExportProgress>} */
const inFlight = new Map();
/** A running watch's wait, woken so its next read is now. @type {Map<string, () => void>} */
const wakers = new Map();
/** Runs woken while not waiting (a read was out): their next wait is skipped. @type {Set<string>} */
const woken = new Set();
/** The last run's sentence, kept only for the export it was about: a new export starts clean.
 * @type {Map<string, Failure>} */
const failures = new Map();

/** Which export a failure was about: the newest export file and the project as it was rendered. @param {string} dir */
const exportKeyOf = (dir) => {
  const latest = latestExportFile(dir);
  return latest ? `${latest.id}\n${latest.path}\n${latest.fingerprint ?? ""}` : "";
};

/** Whether the newest export can go up now: there is one, it is MP4, and the project has not moved past it.
 * @param {string} dir @param {string} now @returns {ReviewVersion["source"]} */
function sourceOf(dir, now) {
  const latest = latestExportFile(dir);
  if (!latest) return "none";
  if (!/\.mp4$/i.test(latest.path)) return "not-mp4";
  return latest.fingerprint === now ? "ready" : "stale";
}

/** What the popover shows about versions. `last.current`: the project as it is now and, when the server says, still
 * its latest ready version (a removed one, or a newer one from elsewhere, is not "on the page").
 * @param {string} projectPath @param {{ latestReadyVersionId?: string | null }} [server] */
export async function reviewVersion(projectPath, server = {}) {
  const [state, now, projectId] = await Promise.all([
    readState(projectPath),
    projectFingerprint(projectPath),
    reviewProjectId(projectPath),
  ]);
  const key = normalize(projectPath);
  const last = state.last?.projectId === projectId ? state.last : null;
  const onServer =
    server.latestReadyVersionId === undefined || server.latestReadyVersionId === last?.versionId;
  const failed = failures.get(key);
  return {
    last: last
      ? { exportedAt: last.exportedAt, current: last.fingerprint === now && onServer }
      : null,
    source: sourceOf(projectPath, now),
    exporting: inFlight.get(key) ?? null,
    ...(failed?.exportKey === exportKeyOf(projectPath)
      ? {
          failure: failed.sentence,
          retryable: !failed.final,
          exportHelps: failed.exportHelps,
          ...(failed.held && { held: true }),
        }
      : { failure: null }),
  };
}

/** The newest MP4 and the body that adds it; a stale, non-MP4, too big or too long export never sends anything.
 * @param {string} dir @param {string} title @param {(file: string) => Promise<VideoFacts | null>} probe
 * @param {FilesForRender} filesForExport */
async function exportSource(dir, title, probe, filesForExport) {
  const latest = latestExportFile(dir);
  if (!latest || sourceOf(dir, await projectFingerprint(dir)) !== "ready")
    return { failure: local("Export an MP4 of the project as it is now first.") };
  const { size } = await stat(latest.path);
  if (size > MAX_BYTES) return { failure: said(new ReviewFailed(400, "export_too_large")) };
  const facts = await probe(latest.path);
  if (!facts) return { failure: local("Couldn't read this video. Export it again.") };
  if (facts.duration > MAX_SECONDS)
    return { failure: said(new ReviewFailed(400, "export_too_long")) };
  /** @type {ExportRequest} */
  const body = {
    client_operation_id: `export-${randomUUID()}`,
    title_snapshot: title.slice(0, 255),
    coordinate_width: facts.width,
    coordinate_height: facts.height,
    duration_seconds: facts.duration,
    render_settings: {},
    source_revision_id: null,
    // The project as rendered, which is what the version shows; never "now".
    source_fingerprint: latest.fingerprint ?? null,
    local_upload: {
      size_bytes: size,
      checksum_sha256: await fileSha256Base64(latest.path),
      content_type: "video/mp4",
    },
  };
  const snapshot = await filesForExport(dir, body.source_fingerprint).catch((error) => {
    // expected: the version still goes up, and Share's files line says it has no files and offers Sync now.
    console.error(
      "[review files] couldn't read the synced snapshot; the version goes up without files:",
      error,
    );
    return null;
  });
  if (snapshot) body.snapshot = snapshot;
  return { file: latest.path, body };
}

/** @param {ExportRequest["snapshot"]} a @param {ExportRequest["snapshot"]} b */
const sameSnapshot = (a, b) =>
  a?.space_id === b?.space_id &&
  a?.composition_id === b?.composition_id &&
  a?.snapshot_id === b?.snapshot_id;

/** A retry of the same file and project sends the pending body and its key unchanged. The snapshot is compared only
 * while the server holds nothing: once it answered with a video, refused the snapshot, or may have made the video
 * with no answer back, a different snapshot now would make one render two versions. A pending export of another
 * server's project (the other backend's) is never resumed here; one saved before projectId was kept is this one's.
 * @param {VersionRecord} state @param {ExportRequest} fresh @param {string} projectId */
function bodyToSend(state, fresh, projectId) {
  const pending = state.pending;
  if (pending && sameRender(pending, fresh, projectId) && reusableSnapshot(pending, fresh))
    return pending;
  return { body: fresh, videoId: null, projectId };
}
/** @param {NonNullable<VersionRecord["pending"]>} pending @param {ExportRequest} fresh @param {string} projectId */
function sameRender(pending, fresh, projectId) {
  return (
    (pending.projectId ?? projectId) === projectId &&
    (pending.body.source_fingerprint ?? null) === fresh.source_fingerprint &&
    pending.body.local_upload.checksum_sha256 === fresh.local_upload.checksum_sha256
  );
}
/** @param {NonNullable<VersionRecord["pending"]>} pending @param {ExportRequest} fresh */
function reusableSnapshot(pending, fresh) {
  if (pending.videoId || pending.snapshotRefused || pending.unanswered) return true;
  return sameSnapshot(pending.body.snapshot, fresh.snapshot);
}

/** No answer, or a server error, can follow a create the server made; a refusal says it made nothing.
 * @param {unknown} error */
const unanswered = (error) =>
  !(error instanceof ReviewFailed) ||
  error.status === 0 ||
  error.status === 408 ||
  error.status >= 500;

/** The export as the server has it. A 422 `snapshot_mismatch` never costs the version: it goes up as video only, under
 * a new key when no earlier send is unanswered.
 * @param {Required<VersionRequest>} r @param {string} id @param {NonNullable<VersionRecord["pending"]>} pending
 * @param {(next: NonNullable<VersionRecord["pending"]>) => Promise<void>} kept */
async function createdExport(r, id, pending, kept) {
  if (pending.videoId) return { dto: await r.client.readExport(id, pending.videoId), pending };
  try {
    return await sendCreate(r, id, pending, kept);
  } catch (error) {
    const refused = error instanceof ReviewFailed && error.reason === "snapshot_mismatch";
    if (!refused || !pending.body.snapshot || pending.unanswered) throw error;
    console.error("[review] snapshot refused; the version goes up without files:", error);
    const body = { ...pending.body, client_operation_id: `export-${randomUUID()}` };
    delete body.snapshot;
    const next = { ...pending, body, snapshotRefused: true };
    await kept(next);
    return sendCreate(r, id, next, kept);
  }
}

/** @param {Required<VersionRequest>} r @param {string} id @param {NonNullable<VersionRecord["pending"]>} pending
 * @param {(next: NonNullable<VersionRecord["pending"]>) => Promise<void>} kept */
async function sendCreate(r, id, pending, kept) {
  const host = r.fromReview;
  const { from_review: _, ...body } = pending.body;
  const replay = pending.unanswered;
  /** @param {ReviewSent} [reviewSent] */
  const beforeSend = (reviewSent) => kept({ ...pending, unanswered: true, reviewSent });
  /** @type {ReviewSent | undefined} */
  let mark;
  try {
    if (!host && !replay) await beforeSend();
    const dto = await r.client.createExport(
      id,
      host
        ? async () => {
            mark = await readFromReview(host, r.projectPath);
            // The auth loop only prepares a second send after a 401. A replay of an earlier run
            // cannot assume that earlier send was refused.
            if (!replay) await beforeSend({ since: mark.since });
            return { ...body, ...(mark.value && { from_review: mark.value }) };
          }
        : pending.body,
    );
    const reviewSent = replay ? cleanupOnly(pending.reviewSent) : mark;
    return { dto, pending: { ...pending, unanswered: false, reviewSent } };
  } catch (error) {
    if (!replay && !unanswered(error)) await kept(pending);
    throw error;
  }
}

/** @param {ReviewSent | undefined} mark */
const cleanupOnly = (mark) => mark && { since: mark.since };

/** Bytes sent, reported when the whole percent moves, not per chunk (a 2 GiB file is ~32k chunks).
 * @param {number} size @param {(progress: ReviewExportProgress) => void} report */
function uploadReporter(size, report) {
  let shown = -1;
  return (/** @type {number} */ sent) => {
    const percent = Math.floor((sent / Math.max(size, 1)) * 100);
    if (percent !== shown) {
      shown = percent;
      report({ step: "uploading", sent, total: size });
    }
  };
}

/** Upload (once more with fresh instructions if the signed PUT expired), then complete.
 * @param {Required<VersionRequest>} r @param {string} id @param {ExportDTO} created @param {string} file
 * @param {number} size @param {(progress: ReviewExportProgress) => void} report @returns {Promise<ExportDTO>} */
async function upload(r, id, created, file, size, report) {
  let current = created;
  for (let tries = 0; current.status === "upload_pending" && current.upload && tries < 2; tries++) {
    const sent = await r.put(current.upload, file, size, uploadReporter(size, report));
    if (sent === "offline") throw new ReviewFailed(0, "offline");
    if (sent === "refused") throw new ReviewFailed(502, "storage_refused");
    if (sent === "sent") return r.client.completeExport(id, current.video_id);
    current = await r.client.readExport(id, current.video_id);
  }
  // Two signed PUTs expired in a row: the slot is spent, and the next attempt starts over with a new key.
  if (current.status === "upload_pending") throw new ReviewFailed(410, "upload_expired");
  return current;
}

/** @param {ExportDTO} dto */
const going = (dto) => dto.status === "processing" || dto.status === "screening";

/** How long after the upload a screening read keeps the watch going: a day for a held video, twice the late mark for
 * one still checking, and none past WATCH_MS for an older server that does not say. @param {ExportDTO} current */
const screeningWatch = (current) => {
  if (current.screening_state === "held") return HELD_WATCH_MS;
  return current.screening_state ? 2 * LATE_AFTER_MS : 0;
};

/** Watches processing and screening (2 s, 30 s once slow or held) until done or out of time; `since` and `keep` let
 * a restart resume the 15-minute clock. @param {Required<VersionRequest>} r @param {string} id
 * @param {ExportDTO} current @param {number} size @param {(progress: ReviewExportProgress) => void} report
 * @param {{ since: number | null, keep: (since: number) => Promise<void> }} clock @returns {Promise<ExportDTO>} */
async function watch(r, id, current, size, report, clock) {
  let until = r.now() + WATCH_MS;
  let { since } = clock;
  let checkingSince = Infinity;
  while (going(current)) {
    if (current.status === "screening") {
      checkingSince = Math.min(checkingSince, r.now());
      if (since === null) await clock.keep((since = r.now()));
      until = Math.max(until, since + screeningWatch(current));
    }
    const progress = progressOf(
      current,
      size,
      r.now() - (since ?? Infinity),
      r.now() - checkingSince,
    );
    report(progress);
    if (r.now() >= until || !r.open()) return current;
    current = await poll(r, id, current, until, progress.slow ? SLOW_POLL_MS : POLL_MS);
  }
  return current;
}

/** One read as progress: late is counted from the upload, slow from this run's first screening read.
 * @param {ExportDTO} current @param {number} size @param {number} sinceUpload @param {number} sinceChecking
 * @returns {ReviewExportProgress} */
function progressOf(current, size, sinceUpload, sinceChecking) {
  const checking = current.status === "screening";
  const screening = checking ? current.screening_state : null;
  const late = screening === "checking" && sinceUpload >= LATE_AFTER_MS;
  /** @type {ReviewExportProgress} */
  const progress = {
    step: checking ? "checking" : "processing",
    sent: size,
    total: size,
    slow: screening === "held" || sinceChecking >= SLOW_AFTER_MS,
  };
  if (screening) progress.screening = screening;
  if (late) progress.late = true;
  return progress;
}

/** Where checking is counted from: kept by an earlier run, else the upload completing in this one, kept with it.
 * @param {Required<VersionRequest>} r @param {number | null} kept @param {boolean} completedNow
 * @param {(since: number) => Promise<void>} keep */
async function checkingClock(r, kept, completedNow, keep) {
  if (kept === null && completedNow) await keep((kept = r.now()));
  return { since: kept, keep };
}

/** What a run says of a video its watch left still going. @param {ExportDTO} done */
const stillGoing = (done) =>
  said(
    new ReviewFailed(
      202,
      done.status === "screening" && done.screening_state === "held"
        ? "held_for_review"
        : "still_checking",
    ),
  );

/** A transient answer: busy, a server error, or no connection (a laptop waking up). @param {unknown} error */
const transient = (error) =>
  error instanceof ReviewFailed &&
  (error.status === 0 || error.status === 429 || error.status >= 500);

/** The next read of `current`; a failed one is retried while the watch lasts and its project is open, else the
 * video comes back as it was last read.
 * @param {Required<VersionRequest>} r @param {string} id @param {ExportDTO} current @param {number} until
 * @param {number} every @returns {Promise<ExportDTO>} */
async function poll(r, id, current, until, every) {
  const key = normalize(r.projectPath);
  for (let wait = every; ; ) {
    if (!woken.delete(key))
      await new Promise((done) => {
        wakers.set(key, () => done(undefined));
        void r.sleep(wait).then(done);
      });
    wakers.delete(key);
    try {
      return await r.client.readExport(id, current.video_id);
    } catch (error) {
      if (!transient(error) || r.now() >= until) throw error;
      if (!r.open()) return current;
      wait = Math.min(
        MAX_WAIT_MS,
        Math.max(every, /** @type {ReviewFailed} */ (error).retryAfterMs ?? 0),
      );
    }
  }
}

/** @param {unknown} error */
const permanentRefusal = (error) =>
  error instanceof ReviewFailed &&
  error.status >= 400 &&
  error.status < 500 &&
  ![401, 408, 429].includes(error.status);

/** A video that is done: ready goes on the record as the newest version, anything else says why.
 * @param {string} dir @param {VersionRecord} state @param {NonNullable<VersionRecord["pending"]>} pending
 * @param {string} id @param {ExportDTO} done @param {FromReview | null} fromReview @returns {Promise<Said | null>} */
async function finish(dir, state, pending, id, done, fromReview) {
  const ready = done.status === "ready";
  const last = {
    fingerprint: pending.body.source_fingerprint ?? "",
    versionId: done.version_id,
    exportedAt: done.exported_at,
    projectId: id,
    files: Boolean(pending.body.snapshot),
    checksum: pending.body.local_upload.checksum_sha256,
  };
  await writeState(dir, { pending: null, last: ready ? last : state.last });
  if (ready) await sharedFromReview(fromReview, dir, pending.reviewSent?.since);
  return ready ? null : said(new ReviewFailed(200, done.error?.reason ?? ""));
}

/** @param {Required<VersionRequest>} r @param {(progress: ReviewExportProgress) => void} report
 * @returns {Promise<Said | null>} */
async function run(r, report) {
  report({ step: "preparing", sent: 0, total: 0 });
  const state = await readState(r.projectPath);
  const source = await exportSource(r.projectPath, r.title, r.probe, r.filesForExport);
  if ("failure" in source) return source.failure ?? null;
  const id = r.projectId ?? (await reviewProjectId(r.projectPath));
  if (!id) return local("Share the project first, then add a version.");
  if (await alreadyUploaded(r.client, id, state, source.body)) return null;
  return sendVersion(r, report, source, id, state);
}
/** @param {ReviewClient} client @param {string} id @param {VersionRecord} state @param {ExportRequest} body */
async function alreadyUploaded(client, id, state, body) {
  const last = state.last;
  if (state.pending || !last || last.projectId !== id) return false;
  if (
    last.fingerprint !== body.source_fingerprint ||
    last.checksum !== body.local_upload.checksum_sha256
  )
    return false;
  return (await client.project(id)).latest_ready_version_id === last.versionId;
}
/** @param {Required<VersionRequest>} r @param {(progress: ReviewExportProgress) => void} report
 * @param {{file: string, body: ExportRequest}} source @param {string} id @param {VersionRecord} state */
async function sendVersion(r, report, source, id, state) {
  const first = state.last?.projectId !== id;
  let pending = bodyToSend(state, source.body, id);
  await writeState(r.projectPath, (state = { ...state, pending }));
  try {
    const answer = await createdExport(r, id, pending, (next) =>
      writeState(r.projectPath, (state = { ...state, pending: next })),
    );
    const created = answer.dto;
    pending = answer.pending;
    await writeState(
      r.projectPath,
      (state = { ...state, pending: { ...pending, videoId: created.video_id } }),
    );
    const size = pending.body.local_upload.size_bytes;
    const uploaded = await upload(r, id, created, source.file, size, report);
    if (uploaded.status !== "failed") await r.onUploaded();
    const clock = await checkingClock(
      r,
      state.pending?.checkingSince ?? null,
      created.status === "upload_pending" && going(uploaded),
      async (since) => {
        const kept = { ...pending, videoId: created.video_id, checkingSince: since };
        await writeState(r.projectPath, (state = { ...state, pending: kept }));
      },
    );
    const done = await watch(r, id, uploaded, size, report, clock);
    return finishRun(r, state, pending, id, done, first);
  } catch (error) {
    return failedSend(r.projectPath, state, error);
  }
}

/** @param {string} dir @param {VersionRecord} state @param {unknown} error */
async function failedSend(dir, state, error) {
  const refused = permanentRefusal(error);
  // An earlier create can still be in flight when the replay is refused.
  const unansweredCreate = state.pending?.unanswered === true && state.pending.videoId === null;
  if (refused && !unansweredCreate) await writeState(dir, { ...state, pending: null });
  console.error("[review] version failed:", error);
  return said(error, refused && unansweredCreate);
}

/** @param {Required<VersionRequest>} r @param {VersionRecord} state
 * @param {NonNullable<VersionRecord["pending"]>} pending @param {string} id @param {ExportDTO} done @param {boolean} first */
async function finishRun(r, state, pending, id, done, first) {
  if (going(done)) return stillGoing(done);
  const failed = await finish(r.projectPath, state, pending, id, done, r.fromReview);
  if (!failed) {
    const fromReview = pending.reviewSent?.value;
    r.onAdded({ files: Boolean(pending.body.snapshot), first, ...(fromReview && { fromReview }) });
  }
  return failed;
}

/** Adds the newest export as a version and resolves once it is ready, failed, or out of watch, with the sentence when
 * it did not go up. One run per project; a second asks nothing and resolves at once. A run onto another project keeps
 * a failure from before the upload to itself: the recorded page is not the one it failed on.
 * @param {VersionRequest} request @returns {Promise<string | null>} */
export async function addVersion(request) {
  let uploaded = false;
  const r = {
    put: putFile,
    sleep: (/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms)),
    probe: probeVideo,
    // Read through Date each time, so a walk can move main's clock under a run.
    now: () => Date.now(),
    onProgress: () => {},
    open: () => true,
    filesForExport: async () => null,
    fromReview: null,
    onAdded: () => {},
    ...request,
    projectId: request.projectId ?? null,
    onUploaded: async () => {
      uploaded = true;
      await request.onUploaded?.();
    },
  };
  const key = normalize(r.projectPath);
  if (inFlight.has(key)) return null;
  failures.delete(key);
  /** @param {ReviewExportProgress} progress */
  const report = (progress) => (inFlight.set(key, progress), r.onProgress(progress));
  try {
    report({ step: "preparing", sent: 0, total: 0 });
    const failure = await withProjectShareLock(r.projectPath, "export", () => run(r, report));
    const kept = failure && (uploaded || !request.projectId);
    if (kept) failures.set(key, { ...failure, exportKey: exportKeyOf(r.projectPath) });
    return failure?.sentence ?? null;
  } catch (error) {
    console.error("[review] version failed:", error);
    const sentence =
      error instanceof SharingStateError ? error.message : "Couldn't add this version. Try again.";
    failures.set(key, {
      sentence,
      final: false,
      exportHelps: false,
      exportKey: exportKeyOf(r.projectPath),
    });
    return sentence;
  } finally {
    inFlight.delete(key);
    woken.delete(key);
    r.onProgress(null);
  }
}

/** The popover opening reads a held video again: a running watch reads now, and one that ran out reads the video
 * back once, so a video staff approved or refused since shows as it is. A read that finds it still held changes
 * nothing; Check again starts a new watch.
 * @param {string} projectPath @param {ReviewClient} client @param {FromReview | null} [fromReview] */
export async function recheckHeld(projectPath, client, fromReview = null) {
  const key = normalize(projectPath);
  if (inFlight.has(key)) return void (wakers.get(key) ?? (() => woken.add(key)))();
  const failed = failures.get(key);
  if (!failed?.held) return;
  const { pending } = await readState(projectPath);
  const id = pending?.projectId ?? (await reviewProjectId(projectPath));
  if (!pending?.videoId || !id) return;
  const done = await client.readExport(id, pending.videoId);
  if (going(done)) return;
  await whenExportIdle(projectPath, async () => {
    if (inFlight.has(key) || failures.get(key) !== failed) return;
    const state = await readState(projectPath);
    const current = state.pending;
    if (
      !current ||
      current.videoId !== pending.videoId ||
      current.body.client_operation_id !== pending.body.client_operation_id ||
      (current.projectId ?? (await reviewProjectId(projectPath))) !== id
    ) {
      return;
    }
    const failure = await finish(projectPath, state, current, id, done, fromReview);
    if (failure) failures.set(key, { ...failure, exportKey: failed.exportKey });
    else failures.delete(key);
  });
}

/** @param {string} dir @param {() => Promise<void>} run */
async function whenExportIdle(dir, run) {
  try {
    await withProjectShareLock(dir, "export", run, { timeoutMs: 0 });
  } catch (error) {
    if (!(error instanceof ShareBusyError)) throw error;
  }
}

/** Settle a saved upload after its host exits, without competing with an active uploader.
 * @param {string} projectPath @param {ReviewClient} client @param {FromReview | null} [fromReview] */
export async function refreshReviewExport(projectPath, client, fromReview = null) {
  await whenExportIdle(projectPath, () => settleSavedExport(projectPath, client, fromReview));
}
/** @param {string} dir @param {ReviewClient} client @param {FromReview | null} fromReview */
async function settleSavedExport(dir, client, fromReview) {
  const state = await readState(dir);
  const pending = state.pending;
  const id = await reviewProjectId(dir);
  if (!pending?.videoId || !id || pending.projectId !== id) return;
  const done = await client.readExport(id, pending.videoId);
  if (going(done)) return;
  const failure = await finish(dir, state, pending, id, done, fromReview);
  const key = normalize(dir);
  if (failure) failures.set(key, { ...failure, exportKey: exportKeyOf(dir) });
  else failures.delete(key);
}

/** The first share puts the newest export up with the link, when there is one to put and no version yet.
 * @param {VersionRequest} request */
export async function addFirstVersion(request) {
  const version = await reviewVersion(request.projectPath);
  if (version.last || version.source !== "ready") return;
  void addVersion(request);
}

/** What the files line and a later attach read of a project's versions: the newest one this app put on the page, with
 * whether the project is still as it was then; whether the newest export is the project now; whether a run is out.
 * @param {string} dir */
export async function versionFacts(dir) {
  const [state, now, projectId] = await Promise.all([
    readState(dir),
    projectFingerprint(dir),
    reviewProjectId(dir),
  ]);
  const last = state.last?.projectId === projectId ? state.last : null;
  return {
    last: last && { ...last, current: last.fingerprint === now },
    source: sourceOf(dir, now),
    running: inFlight.has(normalize(dir)),
  };
}

/** The newest version this app put on the page, read without hashing the project; null while a run is out.
 * @param {string} dir */
export async function versionOnPage(dir) {
  const [state, projectId] = await Promise.all([readState(dir), reviewProjectId(dir)]);
  if (inFlight.has(normalize(dir))) return null;
  return state.last?.projectId === projectId ? state.last : null;
}

/** Records that `versionId` carries files now, if it is still the last ready version.
 * @param {string} dir @param {string} versionId @param {string} [projectId] */
export async function markFiles(dir, versionId, projectId) {
  if (inFlight.has(normalize(dir))) return;
  await withProjectShareLock(dir, "export", async () => {
    const state = await readState(dir);
    const { last } = state;
    if (
      !last ||
      last.versionId !== versionId ||
      (projectId !== undefined && last.projectId !== projectId)
    ) {
      return;
    }
    await writeState(dir, { ...state, last: { ...last, files: true } });
  });
}

/** A pending operation is not the last ready version. @param {string} projectPath */
export async function pendingReviewExport(projectPath) {
  const { pending } = await readState(projectPath);
  if (!pending) return null;
  return {
    projectId: pending.projectId ?? null,
    videoId: pending.videoId,
    operationId: pending.body.client_operation_id,
    fingerprint: pending.body.source_fingerprint ?? null,
    checksum: pending.body.local_upload.checksum_sha256,
  };
}
