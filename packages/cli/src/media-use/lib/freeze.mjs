import { fetchMedia, isPublicMediaUrl, readCappedBody } from "./media-fetch.mjs";
import { sanitizeSvg } from "./svg-sanitize.mjs";
import { writeFileSync, copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

// ponytail: bound the download so a hostile/runaway URL can't fill the disk.
// 256MB covers any real media asset; raise if 4K video sources ever exceed it.
const MAX_FREEZE_BYTES = 256 * 1024 * 1024;
// Bounds only the wait for response headers; a large video body may stream for minutes.
const FREEZE_HEADERS_TIMEOUT_MS = 10_000;

const isSvgPath = (destPath) => /\.svg$/i.test(destPath);

// Every logo/icon SVG comes from a third-party host (theSVG, a --from URL, a local file), so it
// passes the Figma import's sanitizeSvg allowlist before it touches disk.
function writeFrozen(destPath, buffer) {
  mkdirSync(dirname(destPath), { recursive: true });
  const bytes = isSvgPath(destPath) ? Buffer.from(sanitizeSvg(buffer.toString("utf8"))) : buffer;
  writeFileSync(destPath, bytes);
  return bytes.byteLength;
}

export async function freezeUrl(url, destPath) {
  const where = String(url).slice(0, 80);
  const headerWait = new AbortController();
  const timer = setTimeout(
    () =>
      headerWait.abort(
        new Error(`freeze failed: no response within ${FREEZE_HEADERS_TIMEOUT_MS} ms for ${where}`),
      ),
    FREEZE_HEADERS_TIMEOUT_MS,
  );
  const res = await fetchMedia(url, { signal: headerWait.signal }).finally(() =>
    clearTimeout(timer),
  );
  if (!res.ok) throw new Error(`freeze failed: HTTP ${res.status} for ${where}`);

  const body = await readCappedBody(res, MAX_FREEZE_BYTES, `freeze failed for ${where}`);
  if (body.byteLength === 0) throw new Error(`freeze failed: empty response for ${where}`);

  return writeFrozen(destPath, body);
}

export function freezeLocalFile(srcPath, destPath) {
  if (isSvgPath(destPath)) {
    writeFrozen(destPath, readFileSync(srcPath));
    return;
  }
  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(srcPath, destPath);
}

// Ingest accepts a DIRECT public media URL only — not a platform page. yt-dlp is
// deliberately out (cloud IPs get blocked, and it's brittle); the supported case
// is "user points at their own file or a direct asset link". A direct URL is a
// non-platform host whose path ends in a known media extension.
const PLATFORM_HOSTS =
  /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|instagram\.com|twitter\.com|x\.com|facebook\.com|dailymotion\.com)$/i;
const MEDIA_EXT = /\.(mp3|wav|m4a|aac|ogg|flac|mp4|mov|webm|mkv|png|jpe?g|webp|gif|svg|avif)$/i;

export function isDirectMediaUrl(u) {
  let url;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (PLATFORM_HOSTS.test(url.hostname)) return false;
  if (!isPublicMediaUrl(url)) return false;
  return MEDIA_EXT.test(url.pathname);
}
