import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  fsyncSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  lstatSync,
  openSync,
  readdirSync,
  rmdirSync,
  rmSync,
  statSync,
  type Stats,
  unlinkSync,
} from "fs";
import { createHash, randomUUID } from "crypto";
import { BlockList, isIP } from "node:net";
import { dirname, extname, join } from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";

const inFlightDownloads = new Map<string, Promise<string>>();
const signalScopes = new WeakMap<AbortSignal, number>();
let nextSignalScope = 1;

function signalScopeKey(signal: AbortSignal | undefined): string {
  if (!signal) return "none";
  let scope = signalScopes.get(signal);
  if (scope === undefined) {
    scope = nextSignalScope;
    nextSignalScope += 1;
    signalScopes.set(signal, scope);
  }
  return String(scope);
}

export type UrlDownloadFailureKind =
  | "cancelled"
  | "timeout"
  | "http_not_found"
  | "http_rejected"
  | "http_transient"
  | "network"
  | "empty_body"
  | "range_protocol"
  | "length_mismatch"
  | "hash_mismatch"
  | "invalid_payload"
  | "filesystem";

export type UrlDownloadTelemetryOutcome =
  | "attempt_failed"
  | "cache_hit"
  | "published"
  | "race_reused"
  | "retrying";

export interface UrlDownloadTelemetry {
  urlFingerprint: string;
  initialHost?: string;
  finalHost?: string;
  attempt: number;
  outcome: UrlDownloadTelemetryOutcome;
  status?: number;
  expectedBytes?: number;
  receivedBytes?: number;
  rangeDisposition?:
    | "none"
    | "malformed_206"
    | "unsolicited_206"
    | "content_range_on_200"
    | "full_object_200";
  etagFingerprint?: string;
  etagWeak?: boolean;
  localSize?: number;
  localSha256?: string;
  failureKind?: UrlDownloadFailureKind;
}

export interface UrlDownloadOptions {
  /** Optional strong checksum supplied by a trusted caller. */
  expectedSha256?: string;
  onTelemetry?: (event: UrlDownloadTelemetry) => void;
}

export interface PublicHttpsTextOptions {
  /** Maximum decoded response bytes retained in memory. */
  maxBytes: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface SafeDownloadUrlIdentity {
  urlFingerprint: string;
  host?: string;
}

/** Query-free, non-reversible URL identity suitable for logs and metrics. */
export function safeDownloadUrlIdentity(url: string): SafeDownloadUrlIdentity {
  let canonical = url;
  let host: string | undefined;
  try {
    const parsed = new URL(url);
    canonical = `${parsed.origin}${parsed.pathname}`;
    host = parsed.hostname.toLowerCase();
  } catch {
    // Invalid input is still fingerprinted; never echo it in diagnostics.
  }
  return {
    urlFingerprint: createHash("sha256").update(canonical).digest("hex"),
    host,
  };
}

/** Default safe structured sink for engine media call sites without a logger. */
export function writeUrlDownloadTelemetry(event: UrlDownloadTelemetry): void {
  try {
    process.stderr.write(`[hyperframes:download] ${JSON.stringify(event)}\n`);
  } catch {
    // Observability must never change download correctness.
  }
}

export class UrlDownloadError extends Error {
  constructor(
    readonly kind: UrlDownloadFailureKind,
    readonly retryable: boolean,
    message: string,
    readonly status?: number,
    readonly telemetry?: Partial<UrlDownloadTelemetry>,
    /** A bounded in-call refetch can be safe even when upstream retry is not. */
    readonly locallyRetryable: boolean = retryable,
  ) {
    super(message);
    this.name = "UrlDownloadError";
  }
}

function classifyHttpFailure(status: number): UrlDownloadError {
  // Response.statusText is remote-controlled and some CDNs/proxies echo the
  // signed request URL into it. The numeric status is sufficient and bounded.
  const message = `HTTP ${status}`;
  if (status === 404 || status === 410) {
    return new UrlDownloadError("http_not_found", false, message, status);
  }
  if (status === 408 || status === 429 || status >= 500) {
    return new UrlDownloadError("http_transient", true, message, status);
  }
  return new UrlDownloadError("http_rejected", false, message, status);
}

function classifyDownloadFailure(error: unknown): UrlDownloadError {
  if (error instanceof UrlDownloadError) return error;
  let current: unknown = error;
  // Undici often wraps a mid-body socket failure as `TypeError: terminated`
  // with the actionable `UND_ERR_*` code on `cause`.
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (isRetryableNetworkCause(current)) {
      return new UrlDownloadError(
        "network",
        true,
        "Download failed due to a transient network error",
      );
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? current.cause
        : undefined;
  }
  return new UrlDownloadError(
    "filesystem",
    false,
    "Download failed while writing the local artifact",
  );
}

const RETRYABLE_NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN"]);

function isRetryableNetworkCause(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "";
  return (
    RETRYABLE_NETWORK_CODES.has(code) ||
    code.startsWith("UND_ERR_") ||
    /fetch failed|network|socket|connection reset|terminated/i.test(message)
  );
}

const NON_PUBLIC_IPV4_ADDRESSES = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  NON_PUBLIC_IPV4_ADDRESSES.addSubnet(network, prefix, "ipv4");
}
const NON_PUBLIC_IPV6_ADDRESSES = new BlockList();
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
] as const) {
  NON_PUBLIC_IPV6_ADDRESSES.addSubnet(network, prefix, "ipv6");
}

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost") return true;
  const addressType = isIP(h);
  if (addressType === 0) return false;
  return addressType === 4
    ? NON_PUBLIC_IPV4_ADDRESSES.check(h, "ipv4")
    : NON_PUBLIC_IPV6_ADDRESSES.check(h, "ipv6");
}

/**
 * Validate that a URL is safe to fetch on behalf of customer-supplied
 * compositions. Throws if the URL is non-HTTPS or targets a private/reserved
 * address range (SSRF guard).
 */
export function assertPublicHttpsUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("[URLDownloader] Invalid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`[URLDownloader] Only HTTPS URLs are permitted in compositions`);
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new Error("[URLDownloader] URL targets a private/reserved address and is not permitted");
  }
}

function getFilenameFromUrl(url: string, validationScope: string): string {
  const physicalIdentity = validationScope === "" ? url : `${url}\0${validationScope}`;
  const hash = createHash("md5").update(physicalIdentity).digest("hex").slice(0, 12);
  const urlObj = new URL(url);
  const ext = extname(urlObj.pathname) || ".mp4";
  return `download_${hash}${ext}`;
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

const CACHE_LOCK_POLL_MS = 10;
const CACHE_LOCK_STALE_MS = 5 * 60_000;
const CACHE_LOCK_RECLAIM_NAME = ".hf-reclaim";
const CACHE_LOCK_OWNER_PREFIX = ".hf-owner-";

interface CacheLockObservation {
  stats: Stats;
  owner?: string;
}

function sameCacheLockStatGeneration(left: Stats, right: Stats): boolean {
  return (
    sameFileIdentity(left, right) &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.birthtimeMs === right.birthtimeMs
  );
}

function observeCachePathLock(lockPath: string): CacheLockObservation {
  for (let pass = 0; pass < 3; pass += 1) {
    const before = lstatSync(lockPath);
    const owner = readdirSync(lockPath).find((name) => name.startsWith(CACHE_LOCK_OWNER_PREFIX));
    const after = lstatSync(lockPath);
    if (sameCacheLockStatGeneration(before, after)) return { stats: after, owner };
  }
  throw new UrlDownloadError("filesystem", true, "Cache lock changed repeatedly during inspection");
}

function sameCachePathLock(left: CacheLockObservation, right: CacheLockObservation): boolean {
  if (left.owner !== undefined || right.owner !== undefined) {
    return left.owner !== undefined && left.owner === right.owner;
  }
  // Backward-compatible fallback for lock directories created by an older
  // process before ownership markers were introduced.
  return sameFileIdentity(left.stats, right.stats);
}

function removeCacheLockDirectoryIfEmpty(lockPath: string): void {
  try {
    rmdirSync(lockPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTEMPTY" && code !== "EEXIST") throw error;
  }
}

function releaseOwnedCachePathLock(lockPath: string, owner: string): void {
  try {
    // Consuming the unique owner marker elects exactly one releaser. The
    // non-recursive rmdir below cannot delete a successor with its own marker.
    rmdirSync(join(lockPath, owner));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  removeCacheLockDirectoryIfEmpty(lockPath);
}

async function waitForCacheLock(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new UrlDownloadError("cancelled", false, "Download cancelled");
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, CACHE_LOCK_POLL_MS);
    const onAbort = (): void => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(new UrlDownloadError("cancelled", false, "Download cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// The lock loop keeps filesystem races, stale-lock recovery, cancellation, and timeout together.
// fallow-ignore-next-line complexity
async function acquireCachePathLock(
  localPath: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<() => void> {
  const lockPath = `${localPath}.hf-lock`;
  const startedAt = Date.now();
  for (;;) {
    if (signal?.aborted) {
      throw new UrlDownloadError("cancelled", false, "Download cancelled");
    }
    let createdLock = false;
    try {
      mkdirSync(lockPath);
      createdLock = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Another process owns the path; inspect it below.
    }
    if (createdLock) {
      const owner = `${CACHE_LOCK_OWNER_PREFIX}${randomUUID()}`;
      try {
        mkdirSync(join(lockPath, owner));
        const entries = readdirSync(lockPath);
        if (entries.length === 1 && entries[0] === owner) {
          return () => releaseOwnedCachePathLock(lockPath, owner);
        }
        // The empty directory was replaced or another creator reached it
        // before our marker. Consume only our marker and retry ownership.
        rmdirSync(join(lockPath, owner));
        removeCacheLockDirectoryIfEmpty(lockPath);
        continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
    }

    let observedLock: CacheLockObservation;
    try {
      observedLock = observeCachePathLock(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (Date.now() - observedLock.stats.mtimeMs > CACHE_LOCK_STALE_MS) {
      if (observedLock.owner) {
        // Removing the exact unique marker is an atomic ownership claim.
        // A competing releaser/reclaimer gets ENOENT and must re-observe.
        try {
          rmdirSync(join(lockPath, observedLock.owner));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        removeCacheLockDirectoryIfEmpty(lockPath);
        continue;
      }

      // Compatibility path for stale marker-less locks from an older process.
      const reclaimPath = join(lockPath, CACHE_LOCK_RECLAIM_NAME);
      try {
        // A marker inside the observed lock serializes competing stale
        // reclaimers without introducing another independently stale lock.
        mkdirSync(reclaimPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EEXIST" || code === "ENOENT") continue;
        throw error;
      }
      try {
        const currentLock = observeCachePathLock(lockPath);
        if (sameCachePathLock(currentLock, observedLock)) {
          rmdirSync(reclaimPath);
          removeCacheLockDirectoryIfEmpty(lockPath);
        } else {
          // The stale lock was replaced after our observation. Remove only
          // our marker from the successor and leave its ownership intact.
          rmdirSync(reclaimPath);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      continue;
    }

    if (Date.now() - startedAt >= timeoutMs) {
      throw new UrlDownloadError(
        "timeout",
        true,
        `Download cache lock timeout after ${timeoutMs / 1000}s`,
      );
    }
    await waitForCacheLock(signal);
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

function assertAllowedDownloadUrl(url: string, redirect: boolean): void {
  try {
    assertPublicHttpsUrl(url);
  } catch {
    throw new UrlDownloadError(
      "http_rejected",
      false,
      redirect ? "Download redirect target is not permitted" : "Download URL is not permitted",
    );
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Redirect validation remains authoritative if teardown also fails.
  }
}

function resolveRedirectUrl(response: Response, currentUrl: string, redirects: number): string {
  if (redirects >= MAX_REDIRECTS) {
    throw new UrlDownloadError("http_rejected", false, "Download exceeded redirect limit");
  }
  const location = response.headers.get("location");
  if (!location) {
    throw new UrlDownloadError(
      "http_rejected",
      false,
      "Download redirect omitted a Location header",
    );
  }
  try {
    return new URL(location, currentUrl).toString();
  } catch {
    throw new UrlDownloadError("http_rejected", false, "Download redirect Location is invalid");
  }
}

async function fetchWithValidatedRedirects(
  initialUrl: string,
  controller: AbortController,
): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = initialUrl;
  for (let redirects = 0; ; redirects += 1) {
    assertAllowedDownloadUrl(currentUrl, redirects > 0);

    // lgtm[js/file-access-to-http] — every redirect hop is fetched manually
    // only after the HTTPS/private-host guard above; automatic redirect
    // following is disabled so an allowed host cannot bounce into IMDS.
    const response = await fetch(currentUrl, {
      signal: controller.signal,
      redirect: "manual",
      headers: { "accept-encoding": "identity" },
    });
    if (!REDIRECT_STATUSES.has(response.status)) return { response, finalUrl: currentUrl };

    await cancelResponseBody(response);
    currentUrl = resolveRedirectUrl(response, currentUrl, redirects);
  }
}

/** Fetch bounded UTF-8 text while applying the downloader's redirect and SSRF policy to every hop. */
// fallow-ignore-next-line complexity
export async function fetchPublicHttpsText(
  url: string,
  options: PublicHttpsTextOptions,
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) {
    throw new RangeError("maxBytes must be a positive safe integer");
  }
  assertPublicHttpsUrl(url);

  const controller = new AbortController();
  let timedOut = false;
  let callerAborted = options.signal?.aborted ?? false;
  const onCallerAbort = (): void => {
    callerAborted = true;
    controller.abort();
  };
  options.signal?.addEventListener("abort", onCallerAbort, { once: true });
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    if (callerAborted) {
      throw new UrlDownloadError("cancelled", false, "Text fetch cancelled");
    }
    const { response } = await fetchWithValidatedRedirects(url, controller);
    if (!response.ok) {
      await cancelResponseBody(response);
      throw classifyHttpFailure(response.status);
    }
    if (!response.body) return "";

    let declaredLength: number | undefined;
    try {
      declaredLength = parseDeclaredLength(response);
    } catch (error) {
      await cancelResponseBody(response);
      throw error;
    }
    const contentEncoding = response.headers.get("content-encoding")?.trim().toLowerCase();
    const expectedBytes =
      !contentEncoding || contentEncoding === "identity" ? declaredLength : undefined;
    if (declaredLength !== undefined && declaredLength > options.maxBytes) {
      await cancelResponseBody(response);
      throw new UrlDownloadError(
        "length_mismatch",
        false,
        "Text response exceeded the configured byte limit",
        response.status,
      );
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > options.maxBytes) {
        await reader.cancel();
        throw new UrlDownloadError(
          "length_mismatch",
          false,
          "Text response exceeded the configured byte limit",
          response.status,
          { receivedBytes },
        );
      }
      chunks.push(value);
    }
    if (expectedBytes !== undefined && receivedBytes !== expectedBytes) {
      throw new UrlDownloadError(
        "length_mismatch",
        true,
        "Text response byte count did not match its declared length",
        response.status,
        { expectedBytes, receivedBytes },
      );
    }
    return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
  } catch (error) {
    if (callerAborted) {
      throw new UrlDownloadError("cancelled", false, "Text fetch cancelled");
    }
    if (timedOut) {
      throw new UrlDownloadError("timeout", true, `Text fetch timeout after ${timeoutMs / 1000}s`);
    }
    throw classifyDownloadFailure(error);
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", onCallerAbort);
    controller.abort();
  }
}

interface PartialIntegrity {
  finalHost?: string;
  status: number;
  expectedBytes?: number;
  receivedBytes: number;
  rangeDisposition: UrlDownloadTelemetry["rangeDisposition"];
  etagFingerprint?: string;
  etagWeak?: boolean;
  localSize: number;
  localSha256: string;
}

function parseDeclaredLength(response: Response): number | undefined {
  const raw = response.headers.get("content-length");
  if (raw === null) return undefined;
  if (!/^\d+$/.test(raw.trim())) {
    throw new UrlDownloadError(
      "length_mismatch",
      true,
      "Download response Content-Length is malformed",
      response.status,
      { status: response.status },
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new UrlDownloadError(
      "length_mismatch",
      true,
      "Download response Content-Length is out of range",
      response.status,
      { status: response.status },
    );
  }
  return value;
}

// Keep every Content-Range invariant in one parser so malformed and unsolicited
// partial responses cannot drift into different retry classifications.
// fallow-ignore-next-line complexity
function classifyRangeDisposition(response: Response): UrlDownloadTelemetry["rangeDisposition"] {
  const contentRange = response.headers.get("content-range");
  if (response.status === 206) {
    const match = contentRange?.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/i);
    if (!match) return "malformed_206";
    const start = Number(match[1]);
    const end = Number(match[2]);
    const total = match[3] === "*" ? undefined : Number(match[3]);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      (total !== undefined && (!Number.isSafeInteger(total) || total <= end))
    ) {
      return "malformed_206";
    }
    return "unsolicited_206";
  }
  if (response.status !== 200 || contentRange === null) return "none";

  const match = contentRange.match(/^bytes (\d+)-(\d+)\/(\d+)$/i);
  const contentLength = response.headers.get("content-length")?.trim();
  const contentEncoding = response.headers.get("content-encoding")?.trim().toLowerCase();
  if (!match || !contentLength || !/^\d+$/.test(contentLength)) {
    return "content_range_on_200";
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  const declaredLength = Number(contentLength);
  return Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    Number.isSafeInteger(total) &&
    Number.isSafeInteger(declaredLength) &&
    start === 0 &&
    total > 0 &&
    end === total - 1 &&
    declaredLength === total &&
    (!contentEncoding || contentEncoding === "identity")
    ? "full_object_200"
    : "content_range_on_200";
}

function looksLikeRemoteErrorDocument(prefix: Buffer): boolean {
  const text = prefix
    .toString("utf8")
    .replace(/^\uFEFF?\s*/, "")
    .toLowerCase();
  return (
    text.startsWith("<!doctype html") ||
    text.startsWith("<html") ||
    text.startsWith("<head") ||
    text.startsWith("<body") ||
    text.startsWith("<error") ||
    /^\{\s*"(?:error|message|detail|code|status)"\s*:/i.test(text) ||
    (/^<\?xml\b/.test(text) && /<(?:html|error)\b/.test(text))
  );
}

interface ExpectedSha256 {
  value: string;
  encoding: "base64" | "hex";
  source: "caller" | "server";
}

function normalizeCallerSha256(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new UrlDownloadError(
      "hash_mismatch",
      false,
      "Caller-provided SHA-256 checksum is malformed",
    );
  }
  return normalized;
}

function expectedResponseSha256(
  response: Response,
  callerSha256: string | undefined,
): ExpectedSha256 | null {
  if (callerSha256) return { value: callerSha256, encoding: "hex", source: "caller" };
  const amazonChecksum = response.headers.get("x-amz-checksum-sha256")?.trim();
  const amazonChecksumType = response.headers.get("x-amz-checksum-type")?.trim().toUpperCase();
  if (amazonChecksum && amazonChecksumType !== "COMPOSITE") {
    return { value: amazonChecksum, encoding: "base64", source: "server" };
  }
  const digest = response.headers.get("digest");
  const sha256Digest = digest?.match(/(?:^|,)\s*sha-256=:?([^,:\s]+):?/i)?.[1];
  return sha256Digest ? { value: sha256Digest, encoding: "base64", source: "server" } : null;
}

function checksumMismatchError(
  source: "caller" | "server",
  status: number | undefined,
  telemetry: Partial<UrlDownloadTelemetry>,
): UrlDownloadError {
  return new UrlDownloadError(
    "hash_mismatch",
    source === "server",
    "Download payload checksum did not match",
    status,
    telemetry,
    true,
  );
}

// Response protocol, streamed byte accounting, hashes, and payload validation
// share one lifecycle so no validation can happen after publication.
// fallow-ignore-next-line complexity
async function fetchToPartial(
  url: string,
  partialPath: string,
  controller: AbortController,
  options: UrlDownloadOptions,
): Promise<PartialIntegrity> {
  const { response, finalUrl } = await fetchWithValidatedRedirects(url, controller);
  const finalIdentity = safeDownloadUrlIdentity(finalUrl);
  const rangeDisposition = classifyRangeDisposition(response);
  if (rangeDisposition !== "none" && rangeDisposition !== "full_object_200") {
    await cancelResponseBody(response);
    throw new UrlDownloadError(
      "range_protocol",
      true,
      rangeDisposition === "malformed_206"
        ? "Download received a malformed unsolicited partial response"
        : "Download received an unsolicited partial response",
      response.status,
      {
        finalHost: finalIdentity.host,
        status: response.status,
        rangeDisposition,
      },
    );
  }
  if (!response.ok) {
    // Do not leave a streaming error response holding an Undici connection
    // while the bounded retry starts.
    try {
      await response.body?.cancel();
    } catch {
      // The HTTP status remains the useful failure if teardown also fails.
    }
    const classified = classifyHttpFailure(response.status);
    throw new UrlDownloadError(
      classified.kind,
      classified.retryable,
      classified.message,
      classified.status,
      { finalHost: finalIdentity.host, status: response.status, rangeDisposition },
    );
  }
  if (!response.body) {
    throw new UrlDownloadError(
      "empty_body",
      true,
      "Download response body is empty",
      response.status,
      {
        finalHost: finalIdentity.host,
        status: response.status,
      },
    );
  }

  let declaredLength: number | undefined;
  try {
    declaredLength = parseDeclaredLength(response);
  } catch (error) {
    await cancelResponseBody(response);
    if (error instanceof UrlDownloadError) {
      throw new UrlDownloadError(error.kind, error.retryable, error.message, error.status, {
        ...error.telemetry,
        finalHost: finalIdentity.host,
        rangeDisposition,
      });
    }
    throw error;
  }
  const contentEncoding = response.headers.get("content-encoding")?.trim().toLowerCase();
  const expectedBytes =
    !contentEncoding || contentEncoding === "identity" ? declaredLength : undefined;

  let receivedBytes = 0;
  const sha256 = createHash("sha256");
  const md5 = createHash("md5");
  const prefixChunks: Buffer[] = [];
  let prefixBytes = 0;
  const inspector = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      receivedBytes += bytes.length;
      sha256.update(bytes);
      md5.update(bytes);
      if (prefixBytes < 1024) {
        const remaining = 1024 - prefixBytes;
        const sample = bytes.subarray(0, remaining);
        prefixChunks.push(sample);
        prefixBytes += sample.length;
      }
      callback(null, bytes);
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const readableStream = Readable.fromWeb(response.body as any);
  const fileStream = createWriteStream(partialPath, { flags: "wx" });
  await pipeline(readableStream, inspector, fileStream);
  const localSize = statSync(partialPath).size;
  const sha256Bytes = sha256.digest();
  const localSha256 = sha256Bytes.toString("hex");
  const md5Base64 = md5.digest("base64");
  const telemetry = {
    finalHost: finalIdentity.host,
    status: response.status,
    expectedBytes,
    receivedBytes,
    rangeDisposition,
    localSize,
    localSha256,
  } satisfies Partial<UrlDownloadTelemetry>;
  if (receivedBytes === 0 || localSize === 0) {
    throw new UrlDownloadError(
      "empty_body",
      true,
      "Download response body contained zero bytes",
      response.status,
      telemetry,
    );
  }
  if (
    localSize !== receivedBytes ||
    (expectedBytes !== undefined && receivedBytes !== expectedBytes)
  ) {
    throw new UrlDownloadError(
      "length_mismatch",
      true,
      "Download response byte count did not match its declared length",
      response.status,
      telemetry,
    );
  }
  const prefix = Buffer.concat(prefixChunks);
  if (looksLikeRemoteErrorDocument(prefix)) {
    throw new UrlDownloadError(
      "invalid_payload",
      false,
      "Download returned an HTML or JSON error document",
      response.status,
      telemetry,
    );
  }

  const expectedSha256 = expectedResponseSha256(response, options.expectedSha256);
  const checksumMatches =
    expectedSha256 === null ||
    (expectedSha256.encoding === "base64"
      ? sha256Bytes.toString("base64") === expectedSha256.value
      : localSha256 === expectedSha256.value);
  const contentMd5 = response.headers.get("content-md5")?.trim();
  if (!checksumMatches) {
    throw checksumMismatchError(expectedSha256?.source ?? "server", response.status, telemetry);
  }
  if (expectedSha256 === null && contentMd5 && md5Base64 !== contentMd5) {
    throw checksumMismatchError("server", response.status, telemetry);
  }

  const etag = response.headers.get("etag")?.trim();
  return {
    finalHost: finalIdentity.host,
    status: response.status,
    expectedBytes,
    receivedBytes,
    rangeDisposition,
    etagFingerprint: etag ? createHash("sha256").update(etag).digest("hex") : undefined,
    etagWeak: etag ? /^W\//i.test(etag) : undefined,
    localSize,
    localSha256,
  };
}

function syncAndPublishPartial(
  partialPath: string,
  localPath: string,
): Extract<UrlDownloadTelemetryOutcome, "published" | "race_reused"> {
  // Windows rejects fsync on a read-only handle (EPERM); the partial is ours
  // and writable, so r+ preserves the same flush semantics cross-platform.
  const fd = openSync(partialPath, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  // A hard-link publish is atomic and no-clobber: unlike rename(), it cannot
  // replace a path that another successful caller has already returned.
  try {
    linkSync(partialPath, localPath);
    unlinkSync(partialPath);
    return "published";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
    let winner: Stats;
    try {
      winner = lstatSync(localPath);
    } catch (inspectionError) {
      if ((inspectionError as NodeJS.ErrnoException).code !== "ENOENT") throw inspectionError;
      throw new UrlDownloadError(
        "filesystem",
        true,
        "Concurrent cache artifact disappeared before validation",
      );
    }
    if (!winner.isFile() || winner.size === 0) throw error;
    return "race_reused";
  }
}

function emitDownloadTelemetry(options: UrlDownloadOptions, event: UrlDownloadTelemetry): void {
  try {
    options.onTelemetry?.(event);
  } catch {
    // Metrics/logging callbacks cannot affect publication or retry policy.
  }
}

// Attempt-scoped cancellation, cleanup, publication, and telemetry deliberately
// remain under one try/finally so every exit removes the unique partial directory.
// fallow-ignore-next-line complexity
async function runDownloadAttempt(
  url: string,
  localPath: string,
  timeoutMs: number,
  attempt: number,
  options: UrlDownloadOptions,
  signal?: AbortSignal,
): Promise<string> {
  // A private, unguessable directory prevents symlink planting and keeps the
  // partial on the destination filesystem so the final rename stays atomic.
  const attemptDir = mkdtempSync(join(dirname(localPath), ".hf-download-"));
  const partialPath = join(attemptDir, "payload");
  const controller = new AbortController();
  let timedOut = false;
  let callerAborted = signal?.aborted ?? false;
  const onCallerAbort = (): void => {
    callerAborted = true;
    controller.abort();
  };
  signal?.addEventListener("abort", onCallerAbort, { once: true });
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const identity = safeDownloadUrlIdentity(url);

  try {
    if (callerAborted) {
      throw new UrlDownloadError("cancelled", false, "Download cancelled");
    }
    const integrity = await fetchToPartial(url, partialPath, controller, options);
    let outcome = syncAndPublishPartial(partialPath, localPath);
    let publishedIntegrity = integrity;
    if (outcome === "race_reused") {
      let inspection: Awaited<ReturnType<typeof inspectExistingFile>>;
      try {
        inspection = await inspectExistingFile(localPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        throw new UrlDownloadError(
          "filesystem",
          true,
          "Concurrent cache artifact disappeared before validation",
          integrity.status,
          integrity,
        );
      }
      publishedIntegrity = {
        ...integrity,
        localSize: inspection.localSize,
        localSha256: inspection.localSha256,
      };
      if (!localInspectionMatchesOptions(inspection, options)) {
        if (looksLikeRemoteErrorDocument(inspection.prefix)) {
          throw new UrlDownloadError(
            "invalid_payload",
            false,
            "Concurrent download published an HTML or JSON error document",
            integrity.status,
            publishedIntegrity,
          );
        }
        throw checksumMismatchError("caller", integrity.status, publishedIntegrity);
      }
    }
    emitDownloadTelemetry(options, {
      urlFingerprint: identity.urlFingerprint,
      initialHost: identity.host,
      attempt,
      outcome,
      ...publishedIntegrity,
    });
    return localPath;
  } catch (error) {
    if (callerAborted) {
      const classified = new UrlDownloadError("cancelled", false, "Download cancelled");
      emitDownloadTelemetry(options, {
        urlFingerprint: identity.urlFingerprint,
        initialHost: identity.host,
        attempt,
        outcome: "attempt_failed",
        failureKind: classified.kind,
      });
      throw classified;
    }
    if (timedOut) {
      const classified = new UrlDownloadError(
        "timeout",
        true,
        `Download timeout after ${timeoutMs / 1000}s`,
      );
      emitDownloadTelemetry(options, {
        urlFingerprint: identity.urlFingerprint,
        initialHost: identity.host,
        attempt,
        outcome: "attempt_failed",
        failureKind: classified.kind,
      });
      throw classified;
    }
    const classified = classifyDownloadFailure(error);
    emitDownloadTelemetry(options, {
      urlFingerprint: identity.urlFingerprint,
      initialHost: identity.host,
      attempt,
      outcome: "attempt_failed",
      failureKind: classified.kind,
      ...classified.telemetry,
    });
    throw classified;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onCallerAbort);
    controller.abort();
    rmSync(attemptDir, { recursive: true, force: true });
  }
}

async function downloadWithRetry(
  url: string,
  localPath: string,
  timeoutMs: number,
  signal?: AbortSignal,
  onTransientRetry?: (error: UrlDownloadError) => void,
  options: UrlDownloadOptions = {},
): Promise<string> {
  const maxTransientRetries = 1;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await runDownloadAttempt(url, localPath, timeoutMs, attempt + 1, options, signal);
    } catch (error) {
      const classified = classifyDownloadFailure(error);
      if (!classified.locallyRetryable || attempt >= maxTransientRetries) throw classified;
      if (classified.retryable) onTransientRetry?.(classified);
      const identity = safeDownloadUrlIdentity(url);
      emitDownloadTelemetry(options, {
        urlFingerprint: identity.urlFingerprint,
        initialHost: identity.host,
        attempt: attempt + 1,
        outcome: "retrying",
        failureKind: classified.kind,
        ...classified.telemetry,
      });
    }
  }
}

async function inspectExistingFile(path: string): Promise<{
  localSize: number;
  localSha256: string;
  prefix: Buffer;
}> {
  const sha256 = createHash("sha256");
  const prefixChunks: Buffer[] = [];
  let prefixBytes = 0;
  let localSize = 0;
  for await (const chunk of createReadStream(path)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    localSize += bytes.length;
    sha256.update(bytes);
    if (prefixBytes < 1024) {
      const sample = bytes.subarray(0, 1024 - prefixBytes);
      prefixChunks.push(sample);
      prefixBytes += sample.length;
    }
  }
  return {
    localSize,
    localSha256: sha256.digest("hex"),
    prefix: Buffer.concat(prefixChunks),
  };
}

function localInspectionMatchesOptions(
  inspection: { localSize: number; localSha256: string; prefix: Buffer },
  options: UrlDownloadOptions,
): boolean {
  const expectedSha256 = options.expectedSha256?.trim().toLowerCase();
  return (
    inspection.localSize > 0 &&
    !looksLikeRemoteErrorDocument(inspection.prefix) &&
    (!expectedSha256 || inspection.localSha256 === expectedSha256)
  );
}

function sameCacheEntry(before: Stats, after: Stats): boolean {
  return (
    sameFileIdentity(before, after) &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs
  );
}

// Cache identity checks must remain adjacent to invalidation to avoid widening the TOCTOU window.
// fallow-ignore-next-line complexity
async function reuseOrInvalidateCachedFile(
  url: string,
  localPath: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  options: UrlDownloadOptions,
): Promise<boolean> {
  const releaseLock = await acquireCachePathLock(localPath, timeoutMs, signal);
  try {
    // Re-inspect when a mixed-version process changes the path while it is open.
    for (let pass = 0; pass < 3; pass += 1) {
      let before: Stats;
      try {
        before = lstatSync(localPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (!before.isFile() || before.size === 0) {
        rmSync(localPath, { recursive: before.isDirectory(), force: true });
        return false;
      }

      let inspection: Awaited<ReturnType<typeof inspectExistingFile>>;
      try {
        inspection = await inspectExistingFile(localPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      let after: Stats;
      try {
        after = lstatSync(localPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (!sameCacheEntry(before, after)) continue;

      if (localInspectionMatchesOptions(inspection, options)) {
        const identity = safeDownloadUrlIdentity(url);
        emitDownloadTelemetry(options, {
          urlFingerprint: identity.urlFingerprint,
          initialHost: identity.host,
          attempt: 0,
          outcome: "cache_hit",
          receivedBytes: inspection.localSize,
          localSize: inspection.localSize,
          localSha256: inspection.localSha256,
          rangeDisposition: "none",
        });
        return true;
      }

      rmSync(localPath, { force: true });
      return false;
    }
    return false;
  } finally {
    releaseLock();
  }
}

export async function downloadToTemp(
  url: string,
  destDir: string,
  timeoutMs: number = 300000,
  signal?: AbortSignal,
  onTransientRetry?: (error: UrlDownloadError) => void,
  options: UrlDownloadOptions = {},
): Promise<string> {
  // Reject non-HTTPS URLs and private/reserved address ranges before
  // touching the cache or filesystem — customer-supplied compositions must
  // not be able to trigger outbound fetches to internal infrastructure.
  assertPublicHttpsUrl(url);
  const expectedSha256 = normalizeCallerSha256(options.expectedSha256);
  const normalizedOptions = { ...options, expectedSha256 };

  const cacheKey = `${url}\0${destDir}`;
  // The physical request may be shared only by callers with the same
  // cancellation scope and deadline. Otherwise the first caller's abort or
  // timeout would incorrectly own every waiter.
  const validationScope = expectedSha256 ?? "";
  const inFlightKey = `${cacheKey}\0${timeoutMs}\0${signalScopeKey(signal)}\0${validationScope}`;
  const inFlight = inFlightDownloads.get(inFlightKey);
  if (inFlight) {
    return inFlight;
  }

  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  const filename = getFilenameFromUrl(url, validationScope);
  const localPath = join(destDir, filename);

  // Register before the first asynchronous cache inspection so same-scope
  // callers cannot both race through stale-entry invalidation.
  const downloadPromise = (async () => {
    const cacheStartedAt = Date.now();
    const reused = await reuseOrInvalidateCachedFile(
      url,
      localPath,
      timeoutMs,
      signal,
      normalizedOptions,
    );
    const remainingTimeoutMs = timeoutMs - (Date.now() - cacheStartedAt);
    if (remainingTimeoutMs <= 0) {
      throw new UrlDownloadError(
        "timeout",
        true,
        `Download cache inspection timeout after ${timeoutMs / 1000}s`,
      );
    }
    if (reused) return localPath;
    return downloadWithRetry(
      url,
      localPath,
      remainingTimeoutMs,
      signal,
      onTransientRetry,
      normalizedOptions,
    );
  })();
  const trackedDownload = downloadPromise.finally(() => {
    inFlightDownloads.delete(inFlightKey);
  });
  inFlightDownloads.set(inFlightKey, trackedDownload);
  return trackedDownload;
}

export function isHttpUrl(path: string): boolean {
  return path.startsWith("http://") || path.startsWith("https://");
}
