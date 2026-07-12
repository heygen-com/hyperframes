import { writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ponytail: bound the download so a hostile/runaway URL can't fill the disk.
// 256MB covers any real media asset; raise if 4K video sources ever exceed it.
const MAX_FREEZE_BYTES = 256 * 1024 * 1024;

export async function freezeUrl(url, destPath) {
  const where = String(url).slice(0, 80);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`freeze failed: HTTP ${res.status} for ${where}`);

  // Fail fast on an advertised oversize body before reading a single byte.
  const declared = Number(res.headers.get("content-length"));
  if (declared > MAX_FREEZE_BYTES)
    throw new Error(
      `freeze failed: ${declared} bytes exceeds ${MAX_FREEZE_BYTES} cap for ${where}`,
    );

  // Stream and abort once the cap is crossed, so a lying/chunked hostile URL
  // can't buffer the whole payload into memory before the check (M1).
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > MAX_FREEZE_BYTES)
      throw new Error(`freeze failed: stream exceeds ${MAX_FREEZE_BYTES} cap for ${where}`);
    chunks.push(chunk);
  }
  if (total === 0) throw new Error(`freeze failed: empty response for ${where}`);

  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, Buffer.concat(chunks, total));
  return total;
}

export function freezeLocalFile(srcPath, destPath) {
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

// SSRF guard (m11): a user-supplied --from URL must not point at the local host
// or a private network. Blocks loopback/localhost, RFC1918, link-local, and the
// IPv6 equivalents on the literal hostname.
// ponytail: literal-host check only; a DNS name that *resolves* to a private IP
// (rebinding) still passes — add resolve-then-check if --from ever fetches from
// untrusted hostnames at scale.
const PRIVATE_HOST =
  /^(localhost|.*\.local|.*\.internal|127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?(::1|::ffff:127\.|f[cd][0-9a-f]{2}:|fe80:))/i;

export function isDirectMediaUrl(u) {
  let url;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (PLATFORM_HOSTS.test(url.hostname)) return false;
  if (PRIVATE_HOST.test(url.hostname)) return false;
  return MEDIA_EXT.test(url.pathname);
}
