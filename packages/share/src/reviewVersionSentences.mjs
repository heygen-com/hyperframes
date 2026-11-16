// @ts-check
// The sentence a person reads for a version that did not go up; the log keeps the status and reason.
import { ReviewFailed } from "./reviewClient.mjs";

/** A held video is never called rejected: it waits for a person, and people with the link keep the version they had. */
const HELD_FOR_REVIEW =
  "Almost ready. Someone at HyperFrames needs to take a look first. This can take up to a day.";

/** @type {Record<string, string | ((error: ReviewFailed) => string)>} */
const SAID = {
  export_too_large: "This video is over 2 GB, the most a review page takes. Export a smaller one.",
  export_too_long:
    "This video is over 30 minutes, the most a review page takes. Export a shorter one.",
  export_hourly_limit: (error) =>
    `You've added the most versions for this hour. Try again ${laterIn(error.retryAfterMs, "in an hour")}.`,
  export_daily_limit: (error) =>
    `You've added the most versions for today. Try again ${laterIn(error.retryAfterMs, "tomorrow")}.`,
  content_rejected: "This video can't be shared.",
  export_blocked: "Adding videos to review pages isn't available for this account.",
  feature_unavailable: "Review pages aren't available for your account yet.",
  permission_denied: "This account can't add videos to this review page yet.",
  upload_expired: "The upload took too long. Try again.",
  storage_refused: "HyperFrames couldn't store the upload. Try again.",
  still_checking:
    "HyperFrames is still checking the video. People with the link can watch once it's ready; open Share to look again.",
  held_for_review: HELD_FOR_REVIEW,
};

/** @param {unknown} error @param {string} [fallback] */
export function versionSentence(error, fallback = "Couldn't add this version. Try again.") {
  if (!(error instanceof ReviewFailed)) return fallback;
  const said = SAID[error.reason];
  if (said) return typeof said === "function" ? said(error) : said;
  if (error.status === 0) return "Couldn't reach HeyGen. Check your connection and try again.";
  if (error.status === 401) return "Your sign-in has expired. Sign in again, then add the version.";
  // A failed export whose reason has no sentence of its own (export_processing_failed): the server's message is
  // written for developers, so it is never shown.
  if (error.status === 200)
    return "HyperFrames couldn't process this video. Export it again, then try again.";
  return fallback;
}

/** "in about 3 hours", from the server's Retry-After; `unknown` when it sent none. @param {number | undefined} ms @param {string} unknown */
function laterIn(ms, unknown) {
  if (!ms) return unknown;
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `in about ${hours} hour${hours === 1 ? "" : "s"}`;
}
