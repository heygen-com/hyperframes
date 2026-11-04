// @ts-check
// Map sync API error codes to stable client error kinds.

/** @typedef {import("./types.js").SyncErrorKind} SyncErrorKind */

/** @type {Record<string, SyncErrorKind>} */
const KIND_BY_CODE = {
  hyperframes_composition_sync_not_enabled: "not-enabled",
  hf_subscription_required: "plan-required",
  hyperframes_composition_sync_limit_reached: "limit-reached",
  byok_not_supported: "byok",
  resource_access_denied: "no-write-role",
  forbidden: "forbidden",
  hyperframes_composition_not_found: "composition-not-found",
  resource_not_found: "not-found",
  hyperframes_composition_upload_too_large: "too-large",
  hyperframes_composition_upload_reference_invalid: "reference-invalid",
  hyperframes_composition_upload_not_pending: "upload-not-pending",
  hyperframes_composition_active_uploads_exceeded: "active-uploads-exceeded",
  hyperframes_composition_upload_file_not_writable: "file-not-writable",
  conflict: "idempotency-key-reused",
  request_in_progress: "request-in-progress",
  hyperframes_composition_snapshot_not_downloadable: "snapshot-not-downloadable",
  hyperframes_composition_conflict_not_open: "conflict-not-open",
  hyperframes_composition_download_expired: "download-expired",
  invalid_parameter: "invalid-parameter",
  rate_limit_exceeded: "rate-limited",
  service_unavailable: "unavailable",
};

/** A sync route's refusal or failure. `status` is 0 when the server was never reached. */
export class SyncApiError extends Error {
  /** @param {SyncErrorKind} kind @param {{ status?: number, code?: string | null, param?: string | null,
   *   requestId?: string | null, retryAfterMs?: number | null, detail?: string }} [about] */
  constructor(kind, about = {}) {
    super(`composition sync: ${kind}${about.code ? ` (${about.code})` : ""}`);
    this.name = "SyncApiError";
    this.kind = kind;
    this.status = about.status ?? 0;
    this.code = about.code ?? null;
    this.param = about.param ?? null;
    this.requestId = about.requestId ?? null;
    this.retryAfterMs = about.retryAfterMs ?? null;
    this.detail = about.detail ?? null;
  }
}

/** The kind for an HTTP status whose code this client does not know. @param {number} status
 * @returns {SyncErrorKind} */
function kindOfStatus(status) {
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limited";
  if (status === 503) return "unavailable";
  if (status >= 500) return "server-error";
  return "refused";
}

/** The typed error for a refusal: the envelope's code when it is one of the sync routes', else the status's.
 * @param {Response} reply @returns {Promise<SyncApiError>} */
export async function refusalOf(reply) {
  const payload = await reply.json().catch(() => null);
  /** @type {{ code?: unknown, param?: unknown, request_id?: unknown, message?: unknown } | undefined} */
  const error = payload?.error;
  const code = typeof error?.code === "string" ? error.code : null;
  const seconds = Number(reply.headers.get("retry-after") ?? Number.NaN);
  return new SyncApiError((code && KIND_BY_CODE[code]) || kindOfStatus(reply.status), {
    status: reply.status,
    code,
    param: typeof error?.param === "string" ? error.param : null,
    requestId:
      typeof error?.request_id === "string"
        ? error.request_id
        : reply.headers.get("x-heygen-request-id"),
    retryAfterMs: seconds >= 0 ? seconds * 1000 : null,
    ...(typeof error?.message === "string" ? { detail: error.message } : {}),
  });
}
