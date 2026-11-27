import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "puppeteer-core";
import type { ProducerLogger } from "../../../logger.js";

export const RUNTIME_AUDIO_SUBDIR = "__hf_runtime_audio";
const MAX_INLINE_AUDIO_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_INLINE_AUDIO_BYTES = 128 * 1024 * 1024;

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "audio/wav": ".wav",
  "audio/wave": ".wav",
  "audio/x-wav": ".wav",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/ogg": ".ogg",
  "audio/webm": ".webm",
  "audio/aac": ".m4a",
  "audio/mp4": ".m4a",
  "audio/m4a": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/flac": ".flac",
  "audio/x-flac": ".flac",
};

const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;

interface AudioSrcTarget {
  id: string;
  src: string;
}

interface InlineAudioLimits {
  maxPerClipBytes?: number;
  maxTotalBytes?: number;
}

type BlobReadResult =
  | { ok: true; base64: string; mimeType: string }
  | { ok: false; reason: string };

type DecodedAudio = { ok: true; bytes: Buffer; mimeType: string } | { ok: false; reason: string };

function extensionForMime(mimeType: string): string {
  const normalized = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return MIME_EXTENSIONS[normalized] ?? ".bin";
}

function sameOriginBlobPrefix(fileServerUrl: string): string | null {
  try {
    return `blob:${new URL(fileServerUrl).origin}/`.toLowerCase();
  } catch {
    return null;
  }
}

function decodeBase64Within(raw: string, maxBytes: number): Buffer | null {
  const compact = raw.replace(/\s+/g, "");
  if (compact.length === 0 || compact.length % 4 === 1) return null;
  const maxChars = Math.ceil(maxBytes / 3) * 4;
  if (compact.length > maxChars || !BASE64_BODY.test(compact)) return null;
  const bytes = Buffer.from(compact, "base64");
  return bytes.byteLength > 0 && bytes.byteLength <= maxBytes ? bytes : null;
}

function decodePercentWithin(payload: string, maxBytes: number): Buffer | null {
  if (payload.length > maxBytes * 3) return null;
  try {
    const bytes = Buffer.from(decodeURIComponent(payload), "utf8");
    return bytes.byteLength > 0 && bytes.byteLength <= maxBytes ? bytes : null;
  } catch {
    return null;
  }
}

function parseDataHeader(header: string): { isBase64: boolean; mimeType: string } {
  const parts = header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  const isBase64 = parts.at(-1)?.toLowerCase() === "base64";
  const first = parts[0] ?? "";
  const isMime = Boolean(first) && !first.includes("=") && first.toLowerCase() !== "base64";
  return { isBase64, mimeType: isMime ? first.toLowerCase() : "" };
}

function decodeDataAudioUri(uri: string, maxBytes: number): DecodedAudio {
  const comma = uri.indexOf(",");
  if (comma < 5) return { ok: false, reason: "malformed_data_uri" };
  const payload = uri.slice(comma + 1);
  if (!payload) return { ok: false, reason: "empty" };
  const { isBase64, mimeType } = parseDataHeader(uri.slice(5, comma));
  const bytes = isBase64
    ? decodeBase64Within(payload, maxBytes)
    : decodePercentWithin(payload, maxBytes);
  return bytes ? { ok: true, bytes, mimeType } : { ok: false, reason: "invalid_or_too_large" };
}

function writeRuntimeAudio(compiledDir: string, bytes: Buffer, mimeType: string): string {
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const filename = `${digest}${extensionForMime(mimeType)}`;
  const dir = join(compiledDir, RUNTIME_AUDIO_SUBDIR);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, filename);
  try {
    writeFileSync(target, bytes, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return `${RUNTIME_AUDIO_SUBDIR}/${filename}`;
}

async function readBlobFromPage(
  page: Page,
  url: string,
  maxBytes: number,
): Promise<BlobReadResult> {
  const result = await page.evaluate(
    async (blobUrl: string, limit: number): Promise<BlobReadResult> => {
      try {
        const response = await fetch(blobUrl);
        if (!response.ok) return { ok: false, reason: `status_${response.status}` };
        const blob = await response.blob();
        if (blob.size <= 0) return { ok: false, reason: "empty" };
        if (blob.size > limit) return { ok: false, reason: "too_large" };
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(reader.error ?? new Error("read failed"));
          reader.readAsDataURL(blob);
        });
        const comma = dataUrl.indexOf(",");
        return comma < 0
          ? { ok: false, reason: "invalid_data_url" }
          : { ok: true, base64: dataUrl.slice(comma + 1), mimeType: blob.type || "" };
      } catch {
        return { ok: false, reason: "fetch_failed" };
      }
    },
    url,
    maxBytes,
  );
  if (!result || typeof result !== "object") return { ok: false, reason: "invalid_response" };
  const typed = result as Partial<BlobReadResult>;
  if (typed.ok === true && typeof typed.base64 === "string") {
    return {
      ok: true,
      base64: typed.base64,
      mimeType: typeof typed.mimeType === "string" ? typed.mimeType : "",
    };
  }
  const reason =
    typed.ok === false && typeof typed.reason === "string" ? typed.reason : "read_failed";
  return { ok: false, reason };
}

async function materializeOneBlob(
  audio: AudioSrcTarget,
  page: Page,
  compiledDir: string,
  clipLimit: number,
  log?: ProducerLogger,
  assertNotAborted?: () => void,
): Promise<{ path: string; bytes: number } | null> {
  if (clipLimit <= 0) {
    log?.warn("[Probe] Runtime audio byte limit reached; cannot materialize blob", {
      id: audio.id,
    });
    return null;
  }
  const read = await readBlobFromPage(page, audio.src, clipLimit);
  assertNotAborted?.();
  if (!read.ok) {
    log?.warn("[Probe] Could not materialize blob audio source", {
      id: audio.id,
      reason: read.reason,
    });
    return null;
  }
  const bytes = decodeBase64Within(read.base64, clipLimit);
  if (!bytes) {
    log?.warn("[Probe] Blob audio payload was empty, invalid, or exceeded limit", {
      id: audio.id,
    });
    return null;
  }
  return { path: writeRuntimeAudio(compiledDir, bytes, read.mimeType), bytes: bytes.byteLength };
}

/**
 * Fetches same-origin `blob:` audio URLs while the probe page is still open and writes them under
 * `compiledDir/__hf_runtime_audio/` so Node's audio mixer can read them on disk.
 */
export async function materializeBlobAudioSources(input: {
  page: Page;
  fileServerUrl: string;
  audios: AudioSrcTarget[];
  compiledDir: string;
  log?: ProducerLogger;
  assertNotAborted?: () => void;
  limits?: InlineAudioLimits;
}): Promise<void> {
  const prefix = sameOriginBlobPrefix(input.fileServerUrl);
  if (!prefix) return;
  const maxPerClip = input.limits?.maxPerClipBytes ?? MAX_INLINE_AUDIO_BYTES;
  let remaining = input.limits?.maxTotalBytes ?? MAX_TOTAL_INLINE_AUDIO_BYTES;
  const cachedByUrl = new Map<string, string>();

  for (const audio of input.audios) {
    if (!/^blob:/i.test(audio.src)) continue;
    const cached = cachedByUrl.get(audio.src);
    if (cached) {
      audio.src = cached;
      continue;
    }
    if (!audio.src.toLowerCase().startsWith(prefix)) {
      input.log?.warn("[Probe] Skipping cross-origin blob audio source", { id: audio.id });
      continue;
    }
    const written = await materializeOneBlob(
      audio,
      input.page,
      input.compiledDir,
      Math.min(maxPerClip, remaining),
      input.log,
      input.assertNotAborted,
    );
    if (!written) continue;
    remaining -= written.bytes;
    cachedByUrl.set(audio.src, written.path);
    audio.src = written.path;
  }
}

/**
 * Decodes inline `data:` audio URIs into `compiledDir/__hf_runtime_audio/` so FFmpeg can read them.
 */
export function materializeDataAudioSources(input: {
  audios: AudioSrcTarget[];
  compiledDir: string;
  log?: ProducerLogger;
  limits?: InlineAudioLimits;
}): void {
  const maxPerClip = input.limits?.maxPerClipBytes ?? MAX_INLINE_AUDIO_BYTES;
  let remaining = input.limits?.maxTotalBytes ?? MAX_TOTAL_INLINE_AUDIO_BYTES;
  const cachedByUri = new Map<string, string>();

  for (const audio of input.audios) {
    if (!/^data:/i.test(audio.src)) continue;
    const cached = cachedByUri.get(audio.src);
    if (cached) {
      audio.src = cached;
      continue;
    }
    const clipLimit = Math.min(maxPerClip, remaining);
    if (clipLimit <= 0) {
      input.log?.warn("[Probe] Inline audio byte limit reached; cannot materialize data URI", {
        id: audio.id,
      });
      continue;
    }
    const decoded = decodeDataAudioUri(audio.src, clipLimit);
    if (!decoded.ok) {
      input.log?.warn("[Probe] Could not materialize data audio source", {
        id: audio.id,
        reason: decoded.reason,
      });
      continue;
    }
    remaining -= decoded.bytes.byteLength;
    const relativePath = writeRuntimeAudio(input.compiledDir, decoded.bytes, decoded.mimeType);
    cachedByUri.set(audio.src, relativePath);
    audio.src = relativePath;
  }
}
