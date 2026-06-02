import { createWriteStream, existsSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import { join, extname } from "path";
import { Readable } from "stream";
import { finished } from "stream/promises";

const downloadPathCache = new Map<string, string>();
const inFlightDownloads = new Map<string, Promise<string>>();

// SSRF guard: these prefixes identify non-public address space that
// compositions (customer-supplied) must never be able to reach via the
// download path. Blocks AWS IMDS (169.254.169.254), loopback, RFC1918,
// and unspecified addresses. All comparisons are on the raw hostname
// string; DNS resolution is NOT performed here, so DNS-rebinding bypasses
// are not closed by this check — that gap is acceptable for the risk level.
const BLOCKED_HOST_PREFIXES = [
  "169.254.", // link-local / AWS IMDS
  "127.", // loopback IPv4
  "10.", // RFC1918
  "192.168.", // RFC1918
  "0.", // unspecified
  "[::1]", // loopback IPv6
  "[fc", // RFC4193 unique-local IPv6
  "[fd", // RFC4193 unique-local IPv6
];
// 172.16.0.0 – 172.31.255.255 (RFC1918)
const BLOCKED_172_RANGE = { min: 16, max: 31 };

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost") return true;
  if (BLOCKED_HOST_PREFIXES.some((p) => h.startsWith(p))) return true;
  // 172.16–172.31
  const m = h.match(/^172\.(\d{1,3})\./);
  if (m) {
    const octet = parseInt(m[1] ?? "0", 10);
    if (octet >= BLOCKED_172_RANGE.min && octet <= BLOCKED_172_RANGE.max) return true;
  }
  return false;
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
    throw new Error(`[URLDownloader] Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `[URLDownloader] Only HTTPS URLs are permitted in compositions (got ${parsed.protocol}): ${url}`,
    );
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new Error(
      `[URLDownloader] URL targets a private/reserved address and is not permitted: ${url}`,
    );
  }
}

function getFilenameFromUrl(url: string): string {
  const hash = createHash("md5").update(url).digest("hex").slice(0, 12);
  const urlObj = new URL(url);
  const ext = extname(urlObj.pathname) || ".mp4";
  return `download_${hash}${ext}`;
}

export async function downloadToTemp(
  url: string,
  destDir: string,
  timeoutMs: number = 300000,
): Promise<string> {
  // Reject non-HTTPS URLs and private/reserved address ranges before
  // touching the cache or filesystem — customer-supplied compositions must
  // not be able to trigger outbound fetches to internal infrastructure.
  assertPublicHttpsUrl(url);

  const cachedPath = downloadPathCache.get(url);
  if (cachedPath && existsSync(cachedPath)) {
    return cachedPath;
  }
  const inFlight = inFlightDownloads.get(url);
  if (inFlight) {
    return inFlight;
  }

  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  const filename = getFilenameFromUrl(url);
  const localPath = join(destDir, filename);

  if (existsSync(localPath)) {
    downloadPathCache.set(url, localPath);
    return localPath;
  }

  const downloadPromise = (async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("Response body is empty");
      }

      const fileStream = createWriteStream(localPath);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const readableStream = Readable.fromWeb(response.body as any);
      await finished(readableStream.pipe(fileStream));

      downloadPathCache.set(url, localPath);
      return localPath;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("aborted")) {
        throw new Error(`[URLDownloader] Download timeout after ${timeoutMs / 1000}s: ${url}`);
      }
      throw new Error(`[URLDownloader] Download failed: ${message}`);
    } finally {
      inFlightDownloads.delete(url);
    }
  })();
  inFlightDownloads.set(url, downloadPromise);
  return downloadPromise;
}

export function isHttpUrl(path: string): boolean {
  return path.startsWith("http://") || path.startsWith("https://");
}
