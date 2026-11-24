import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  lstatSync,
  openSync,
  readdirSync,
  rmdirSync,
  rmSync,
  statSync,
  statfsSync,
  type Stats,
  unlinkSync,
} from "fs";
import { createHash, randomUUID } from "crypto";
import dns from "node:dns";
import { fetchGoesThroughEnvProxy } from "@hyperframes/core/env-proxy";
import { type LookupFunction } from "node:net";
import type { buildConnector } from "undici";
import { isBlockedNetworkHost } from "./networkPolicy.js";
import { resolveRestrictPageNetwork } from "../config.js";
import {
  assertPublicHostname,
  NonPublicHostError,
  resolvePublicAddress,
} from "../services/publicNetwork/publicNetwork.js";
import {
  captureUpstreamProxy,
  type UpstreamProxy,
} from "../services/publicNetwork/upstreamProxy.js";
import { dirname, extname, join } from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { cannotHardLink, createStagingDir } from "@hyperframes/core/atomic-file";
import { renameWithRetry } from "@hyperframes/core/rename-retry";
import { playlistLeavesItsFolder } from "./notMediaPayload.js";

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

const URL_NOT_PERMITTED = "Download URL is not permitted";
const REDIRECT_NOT_PERMITTED = "Download redirect target is not permitted";

function notPermittedError(redirect: boolean): UrlDownloadError {
  return new UrlDownloadError(
    "http_rejected",
    false,
    redirect ? REDIRECT_NOT_PERMITTED : URL_NOT_PERMITTED,
  );
}

export function isUrlNotPermittedError(error: unknown): boolean {
  return (
    error instanceof UrlDownloadError &&
    (error.message === URL_NOT_PERMITTED || error.message === REDIRECT_NOT_PERMITTED)
  );
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
        `Download failed due to a transient network error${describeCause(current)}`,
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
    `Download failed while writing the local artifact${describeCause(error)}`,
  );
}

// Only the error's name and code: its message can carry the signed request URL.
function describeCause(error: unknown): string {
  const name = error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : "";
  const rawCode =
    typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  const code = typeof rawCode === "string" && /^[A-Z0-9_]{1,40}$/.test(rawCode) ? rawCode : "";
  const tag = [name, code].filter(Boolean).join(" ");
  return tag ? ` (${tag})` : "";
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
  if (isBlockedNetworkHost(parsed.hostname) || refusedByRestrictedNetwork(parsed.hostname)) {
    throw new Error("[URLDownloader] URL targets a private/reserved address and is not permitted");
  }
}

function refusedByRestrictedNetwork(hostname: string): boolean {
  if (!resolveRestrictPageNetwork()) return false;
  try {
    assertPublicHostname(hostname);
    return false;
  } catch {
    return true;
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

const NON_PUBLIC_ADDRESS_CODE = "HF_NON_PUBLIC_ADDRESS";

function nonPublicAddressError(): Error {
  return Object.assign(new Error("host resolves to a non-public address"), {
    code: NON_PUBLIC_ADDRESS_CODE,
  });
}

/** Resolves a host and refuses to connect when any answer is a non-public address. */
const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (error, answers) => {
    if (error) return callback(error, "", 0);
    if (
      answers.length === 0 ||
      answers.some((a) => isBlockedNetworkHost(a.address.split("%")[0]!))
    ) {
      return callback(nonPublicAddressError(), "", 0);
    }
    if (options.all) return callback(null, answers as never);
    return callback(null, answers[0]!.address, answers[0]!.family);
  });
};

/** The capture proxy's resolver: IPv4 answers only, every one public, and the checked address is dialled. */
const capturePolicyLookup: LookupFunction = (hostname, options, callback) => {
  resolvePublicAddress(hostname).then(
    (address) =>
      options.all ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4),
    (error: unknown) =>
      callback(
        error instanceof NonPublicHostError ? nonPublicAddressError() : (error as Error),
        "",
        0,
      ),
  );
};

type DownloadFetch = (url: string, init: RequestInit) => Promise<Response>;

const undiciTransports = new Map<LookupFunction, Promise<DownloadFetch>>();

const importUndiciPackageEvenUnderBun = () => import("undici/index.js");

function undiciTransport(lookup: LookupFunction): Promise<DownloadFetch> {
  let transport = undiciTransports.get(lookup);
  if (!transport) {
    transport = importUndiciPackageEvenUnderBun().then(({ Agent, fetch: undiciFetch }) => {
      const dispatcher = new Agent({ connect: { lookup } });
      return (target, options) =>
        undiciFetch(target, { ...(options as object), dispatcher }) as unknown as Promise<Response>;
    });
    undiciTransports.set(lookup, transport);
  }
  return transport;
}

const proxyTransports = new Map<string, Promise<DownloadFetch>>();

/** undici 7 reopens a tunnel the proxy closed without a reply with no pause or limit; this fails the request. */
function failRequestOnDroppedTunnel(connect: buildConnector.connector): buildConnector.connector {
  return (options, callback) =>
    connect(options, (...result) => {
      const [error] = result;
      if (error && "code" in error && error.code === "UND_ERR_SOCKET") {
        const closed = new Error("The egress proxy closed the tunnel", { cause: error });
        return callback(Object.assign(closed, { code: "ECONNRESET" }), null);
      }
      callback(...result);
    });
}

function egressProxyTransport(proxy: UpstreamProxy): Promise<DownloadFetch> {
  const uri = `http://${proxy.host.includes(":") ? `[${proxy.host}]` : proxy.host}:${proxy.port}`;
  const key = `${uri} ${proxy.authorization ?? ""}`;
  let transport = proxyTransports.get(key);
  if (!transport) {
    transport = importUndiciPackageEvenUnderBun().then(
      ({ Pool, ProxyAgent, fetch: undiciFetch }) => {
        const dispatcher = new ProxyAgent({
          uri,
          token: proxy.authorization,
          factory: (origin, options) =>
            new Pool(origin, {
              ...options,
              connect: failRequestOnDroppedTunnel(
                (options as { connect: buildConnector.connector }).connect,
              ),
            }),
        });
        return (target, options) =>
          undiciFetch(target, {
            ...(options as object),
            dispatcher,
          }) as unknown as Promise<Response>;
      },
    );
    proxyTransports.set(key, transport);
  }
  return transport;
}

const UNRESOLVED_HOST_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL"]);

/** Behind an env proxy, refuses a host this machine resolves to a non-public address; the proxy resolves the rest. */
function assertProxiedHostResolvesPublic(url: string, signal?: AbortSignal | null): Promise<void> {
  const hostname = new URL(url).hostname.replace(/^\[|\]$/g, "");
  return new Promise((resolvePromise, reject) => {
    const abort = () => reject(signal?.reason);
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    dns.lookup(hostname, { all: true }, (error, answers) => {
      signal?.removeEventListener("abort", abort);
      if (error) {
        return UNRESOLVED_HOST_CODES.has(error.code ?? "") ? resolvePromise() : reject(error);
      }
      if (answers.some((a) => isBlockedNetworkHost(a.address.split("%")[0]!))) {
        return reject(nonPublicAddressError());
      }
      resolvePromise();
    });
  });
}

const fetchPublic: DownloadFetch = async (url, init) => {
  if (resolveRestrictPageNetwork()) {
    const upstream = captureUpstreamProxy();
    if (upstream) return (await egressProxyTransport(upstream))(url, init);
    return (await undiciTransport(capturePolicyLookup))(url, init);
  }
  if (fetchGoesThroughEnvProxy()) {
    await assertProxiedHostResolvesPublic(url, init.signal);
    return fetch(url, init);
  }
  return (await undiciTransport(publicOnlyLookup))(url, init);
};

let downloadFetch: DownloadFetch = fetchPublic;

/** Test seam: replaces the transport every download goes through; no argument restores it. */
export function _setDownloadFetchForTests(replacement?: DownloadFetch): void {
  downloadFetch = replacement ?? fetchPublic;
}

function refusedNonPublicAddress(error: unknown): boolean {
  for (let depth = 0; error && depth < 4; depth += 1) {
    if (typeof error === "object" && "code" in error && error.code === NON_PUBLIC_ADDRESS_CODE) {
      return true;
    }
    error = typeof error === "object" && "cause" in error ? error.cause : undefined;
  }
  return false;
}

function assertAllowedDownloadUrl(url: string, redirect: boolean): void {
  try {
    assertPublicHttpsUrl(url);
  } catch {
    throw notPermittedError(redirect);
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
    const response = await downloadFetch(currentUrl, {
      signal: controller.signal,
      redirect: "manual",
      headers: { "accept-encoding": "identity" },
    }).catch((error: unknown) => {
      if (!refusedNonPublicAddress(error)) throw error;
      throw notPermittedError(redirects > 0);
    });
    if (!REDIRECT_STATUSES.has(response.status)) return { response, finalUrl: currentUrl };

    await cancelResponseBody(response);
    currentUrl = resolveRedirectUrl(response, currentUrl, redirects);
  }
}

/** Fetch bounded bytes while applying the downloader's redirect and SSRF policy to every hop. */
// fallow-ignore-next-line complexity
export async function fetchPublicHttpsBytes(
  url: string,
  options: PublicHttpsTextOptions,
): Promise<Uint8Array> {
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
    if (!response.body) return new Uint8Array();

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
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
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

export async function fetchPublicHttpsText(
  url: string,
  options: PublicHttpsTextOptions,
): Promise<string> {
  return new TextDecoder().decode(await fetchPublicHttpsBytes(url, options));
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

const DEFAULT_MAX_DOWNLOAD_BYTES = 8 * 1024 ** 3;
const DEFAULT_MAX_DOWNLOAD_MS = 30 * 60 * 1000;
const DEFAULT_DOWNLOAD_MIN_FREE_BYTES = 512 * 1024 ** 2;
const FREE_SPACE_CHECK_INTERVAL_BYTES = 4 * 1024 ** 2;
const DEFAULT_MIN_DOWNLOAD_BYTES_PER_SEC = 32 * 1024;
const THROUGHPUT_WINDOW_SECONDS = 60;

function integerFromEnv(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= minimum ? value : fallback;
}

const maxDownloadBytes = (): number =>
  integerFromEnv("HYPERFRAMES_MAX_DOWNLOAD_BYTES", DEFAULT_MAX_DOWNLOAD_BYTES, 1);

const minDownloadBytesPerSec = (): number =>
  integerFromEnv("HYPERFRAMES_MIN_DOWNLOAD_BYTES_PER_SEC", DEFAULT_MIN_DOWNLOAD_BYTES_PER_SEC, 0);

const maxDownloadMs = (): number =>
  integerFromEnv("HYPERFRAMES_MAX_DOWNLOAD_MS", DEFAULT_MAX_DOWNLOAD_MS, 1);

const downloadMinFreeBytes = (): number =>
  integerFromEnv("HYPERFRAMES_DOWNLOAD_MIN_FREE_BYTES", DEFAULT_DOWNLOAD_MIN_FREE_BYTES, 0);

function freeDiskBytes(path: string): number | null {
  try {
    const stat = statfsSync(path);
    return stat.bavail * stat.bsize;
  } catch {
    return null;
  }
}

// Bytes that in-flight downloads declared but have not received yet, per device.
const unreceivedBytesByDevice = new Map<number, number>();

/**
 * Keeps `minFreeBytes` free on the download volume across parallel downloads: a declared size
 * is claimed up front, and free space is measured again every few MiB as bytes arrive. Free
 * space that cannot be measured counts as enough, and a minimum of 0 turns the guard off.
 */
class DiskHeadroomGuard {
  private unreceivedBytes = 0;
  private bytesSinceCheck = 0;
  private device = 0;

  constructor(
    private readonly dir: string,
    readonly minFreeBytes: number,
  ) {}

  claim(declaredBytes: number): boolean {
    if (this.minFreeBytes === 0) return true;
    this.device = statSync(this.dir).dev;
    this.adjustUnreceived(declaredBytes);
    return this.keepsMinimum();
  }

  receive(byteCount: number): boolean {
    if (this.minFreeBytes === 0) return true;
    this.adjustUnreceived(-Math.min(byteCount, this.unreceivedBytes));
    this.bytesSinceCheck += byteCount;
    if (this.bytesSinceCheck < FREE_SPACE_CHECK_INTERVAL_BYTES) return true;
    this.bytesSinceCheck = 0;
    return this.keepsMinimum();
  }

  release(): void {
    this.adjustUnreceived(-this.unreceivedBytes);
  }

  private keepsMinimum(): boolean {
    const free = freeDiskBytes(this.dir);
    if (free === null) return true;
    return free - (unreceivedBytesByDevice.get(this.device) ?? 0) >= this.minFreeBytes;
  }

  private adjustUnreceived(delta: number): void {
    this.unreceivedBytes += delta;
    const total = (unreceivedBytesByDevice.get(this.device) ?? 0) + delta;
    if (total > 0) unreceivedBytesByDevice.set(this.device, total);
    else unreceivedBytesByDevice.delete(this.device);
  }
}

function lowDiskSpaceError(
  minFreeBytes: number,
  status: number,
  telemetry: Partial<UrlDownloadTelemetry>,
): UrlDownloadError {
  return new UrlDownloadError(
    "filesystem",
    false,
    `Download stopped: it would leave less than ${minFreeBytes} bytes free on the download volume`,
    status,
    telemetry,
  );
}

function isCompressedEncoding(contentEncoding: string | null): boolean {
  const encoding = contentEncoding?.trim().toLowerCase();
  return Boolean(encoding) && encoding !== "identity";
}

function overByteLimitError(
  maxBytes: number,
  status: number,
  telemetry: Partial<UrlDownloadTelemetry>,
): UrlDownloadError {
  return new UrlDownloadError(
    "length_mismatch",
    false,
    `Download exceeded the ${maxBytes}-byte limit`,
    status,
    telemetry,
  );
}

// One spare bucket so the summed span is never shorter than the window, which errs toward keeping
// a download that runs right at the floor.
class ThroughputWindow {
  private readonly buckets = new Array<number>(THROUGHPUT_WINDOW_SECONDS + 1).fill(0);
  private bytesInWindow = 0;
  private currentSecond: number;

  constructor(private readonly startedAtMs: number) {
    this.currentSecond = Math.floor(startedAtMs / 1000);
  }

  record(byteCount: number, nowMs: number): void {
    this.advanceTo(nowMs);
    this.buckets[this.currentSecond % this.buckets.length]! += byteCount;
    this.bytesInWindow += byteCount;
  }

  isBelow(minBytesPerSec: number, nowMs: number): boolean {
    this.advanceTo(nowMs);
    return (
      nowMs - this.startedAtMs >= THROUGHPUT_WINDOW_SECONDS * 1000 &&
      this.bytesInWindow < minBytesPerSec * THROUGHPUT_WINDOW_SECONDS
    );
  }

  private advanceTo(nowMs: number): void {
    const second = Math.floor(nowMs / 1000);
    const expired = Math.min(second - this.currentSecond, this.buckets.length);
    for (let step = 1; step <= expired; step += 1) {
      const index = (this.currentSecond + step) % this.buckets.length;
      this.bytesInWindow -= this.buckets[index]!;
      this.buckets[index] = 0;
    }
    this.currentSecond = Math.max(second, this.currentSecond);
  }
}

// Response protocol, streamed byte accounting, hashes, and payload validation
// share one lifecycle so no validation can happen after publication.
// fallow-ignore-next-line complexity
async function fetchToPartial(
  url: string,
  partialPath: string,
  controller: AbortController,
  options: UrlDownloadOptions,
  onBodyBytes: (byteCount: number, sized: boolean) => void,
  headroom: DiskHeadroomGuard,
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
  const responseTelemetry = { finalHost: finalIdentity.host, status: response.status };
  if (isCompressedEncoding(response.headers.get("content-encoding"))) {
    await cancelResponseBody(response);
    throw new UrlDownloadError(
      "http_rejected",
      false,
      "Download response is compressed; only identity Content-Encoding is accepted",
      response.status,
      responseTelemetry,
    );
  }
  const maxBytes = maxDownloadBytes();
  if (declaredLength !== undefined && declaredLength > maxBytes) {
    await cancelResponseBody(response);
    throw overByteLimitError(maxBytes, response.status, {
      ...responseTelemetry,
      expectedBytes: declaredLength,
    });
  }
  if (!headroom.claim(declaredLength ?? 0)) {
    await cancelResponseBody(response);
    throw lowDiskSpaceError(headroom.minFreeBytes, response.status, {
      ...responseTelemetry,
      expectedBytes: declaredLength,
    });
  }
  const expectedBytes = declaredLength;

  let receivedBytes = 0;
  const sha256 = createHash("sha256");
  const md5 = createHash("md5");
  const prefixChunks: Buffer[] = [];
  let prefixBytes = 0;
  const inspector = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      onBodyBytes(bytes.length, declaredLength !== undefined);
      receivedBytes += bytes.length;
      if (receivedBytes > maxBytes) {
        callback(
          overByteLimitError(maxBytes, response.status, {
            ...responseTelemetry,
            expectedBytes,
            receivedBytes,
          }),
        );
        return;
      }
      if (!headroom.receive(bytes.length)) {
        callback(
          lowDiskSpaceError(headroom.minFreeBytes, response.status, {
            ...responseTelemetry,
            expectedBytes,
            receivedBytes,
          }),
        );
        return;
      }
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
  // The signal makes the attempt's deadline authoritative. Without it, the abort only
  // reaches the fetch, and the pipeline depends on the web-to-Node bridge to pass it on:
  // Bun 1.3.9's Readable.fromWeb can stop reading and never settle, and Bun 1.4.2's ends an
  // aborted body as if it were complete, which a chunked response would publish truncated.
  await pipeline(readableStream, inspector, fileStream, { signal: controller.signal });
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

async function publishWithoutClobber(
  partialPath: string,
  localPath: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    linkSync(partialPath, localPath);
    unlinkSync(partialPath);
    return;
  } catch (error) {
    if (!cannotHardLink(error)) throw error;
  }
  const releaseLock = await acquireCachePathLock(localPath, timeoutMs, signal);
  try {
    if (lstatSync(localPath, { throwIfNoEntry: false })) {
      throw Object.assign(new Error(`${localPath} already exists`), { code: "EEXIST" });
    }
    renameWithRetry(partialPath, localPath);
  } finally {
    releaseLock();
  }
}

async function syncAndPublishPartial(
  partialPath: string,
  localPath: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<Extract<UrlDownloadTelemetryOutcome, "published" | "race_reused">> {
  // Windows rejects fsync on a read-only handle (EPERM); the partial is ours
  // and writable, so r+ preserves the same flush semantics cross-platform.
  const fd = openSync(partialPath, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  // Atomic and no-clobber: a hard link, or a rename under the cache path lock where
  // the drive has no hard links, never replaces a path another caller already returned.
  try {
    await publishWithoutClobber(partialPath, localPath, timeoutMs, signal);
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
  const attemptDir = createStagingDir(dirname(localPath), ".hf-download-");
  const partialPath = join(attemptDir, "payload");
  const controller = new AbortController();
  let timedOut = false;
  let callerAborted = signal?.aborted ?? false;
  const onCallerAbort = (): void => {
    callerAborted = true;
    controller.abort();
  };
  signal?.addEventListener("abort", onCallerAbort, { once: true });
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const armTimeout = (): void => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  };
  armTimeout();
  // Unlike the attempt timeout, incoming data never moves this deadline.
  const deadlineMs = maxDownloadMs();
  let pastDeadline = false;
  const deadlineId = setTimeout(() => {
    pastDeadline = true;
    controller.abort();
  }, deadlineMs);
  let sizedBodyStarted = false;
  const extendTimeout = (): void => {
    sizedBodyStarted = true;
    armTimeout();
  };
  const minBytesPerSec = minDownloadBytesPerSec();
  let throughput: ThroughputWindow | undefined;
  let tooSlow = false;
  let floorCheckId: ReturnType<typeof setTimeout> | undefined;
  const checkThroughputFloor = (): void => {
    if (throughput?.isBelow(minBytesPerSec, Date.now())) {
      tooSlow = true;
      controller.abort();
      return;
    }
    floorCheckId = setTimeout(checkThroughputFloor, 1000);
  };
  const onBodyBytes = (byteCount: number, sized: boolean): void => {
    if (sized) extendTimeout();
    if (minBytesPerSec === 0) return;
    if (!throughput) {
      throughput = new ThroughputWindow(Date.now());
      floorCheckId = setTimeout(checkThroughputFloor, 1000);
    }
    throughput.record(byteCount, Date.now());
  };
  const identity = safeDownloadUrlIdentity(url);
  const headroom = new DiskHeadroomGuard(attemptDir, downloadMinFreeBytes());

  try {
    if (callerAborted) {
      throw new UrlDownloadError("cancelled", false, "Download cancelled");
    }
    const integrity = await fetchToPartial(
      url,
      partialPath,
      controller,
      options,
      onBodyBytes,
      headroom,
    );
    clearTimeout(deadlineId);
    clearTimeout(floorCheckId);
    if (await playlistLeavesItsFolder(partialPath, localPath)) {
      throw new UrlDownloadError(
        "invalid_payload",
        false,
        "Download is a playlist naming files outside its folder",
        integrity.status,
        integrity,
      );
    }
    let outcome = await syncAndPublishPartial(partialPath, localPath, timeoutMs, signal);
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
    let classified: UrlDownloadError;
    if (callerAborted) {
      classified = new UrlDownloadError("cancelled", false, "Download cancelled");
    } else if (pastDeadline) {
      classified = new UrlDownloadError(
        "timeout",
        false,
        `Download exceeded the ${deadlineMs / 1000}s time limit`,
      );
    } else if (timedOut) {
      classified = new UrlDownloadError(
        "timeout",
        true,
        sizedBodyStarted
          ? `Download stalled: no data for ${timeoutMs / 1000}s`
          : `Download timeout after ${timeoutMs / 1000}s`,
      );
    } else if (tooSlow) {
      classified = new UrlDownloadError(
        "timeout",
        true,
        `Download too slow: under ${minBytesPerSec} bytes/s over the last ${THROUGHPUT_WINDOW_SECONDS}s`,
      );
    } else {
      classified = classifyDownloadFailure(error);
    }
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
    clearTimeout(deadlineId);
    clearTimeout(floorCheckId);
    headroom.release();
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
      if (!classified.locallyRetryable || attempt >= maxTransientRetries) {
        const identity = safeDownloadUrlIdentity(url);
        throw new UrlDownloadError(
          classified.kind,
          classified.retryable,
          classified.message,
          classified.status,
          {
            ...classified.telemetry,
            urlFingerprint: identity.urlFingerprint,
            initialHost: identity.host,
            attempt: attempt + 1,
          },
          classified.locallyRetryable,
        );
      }
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
