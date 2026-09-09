import AdmZip from "adm-zip";
import { preflightLottieArchive, safeLottieArchivePath } from "./lottieArchivePreflight.js";

export const MAX_LOTTIE_BYTES = 10 * 1024 * 1024;

/** Read animation JSON without extracting remote archive paths onto the filesystem. */
export function readLottieArchive(bytes: Buffer): string | null {
  if (bytes.length > MAX_LOTTIE_BYTES) return null;
  if (!preflightLottieArchive(bytes)) return null;
  try {
    const zip = new AdmZip(bytes);
    if (zip.getEntryCount() > 256) return null;
    const entries = zip.getEntries();
    if (entries.length > 256) return null;
    if (!validArchiveEntries(entries)) return null;
    const animation = entries.find((entry) =>
      /^(?:a|animations)\/[^/]+\.json$/.test(entry.entryName),
    );
    // adm-zip uses a positive expected size as zlib's maxOutputLength.
    if (!animation || animation.header.size <= 0) return null;
    const data = animation.getData();
    if (data.length !== animation.header.size || data.length > MAX_LOTTIE_BYTES) return null;
    return data.toString("utf8");
  } catch {
    return null;
  }
}

function validArchiveEntries(entries: { entryName: string; header: { size: number } }[]): boolean {
  let total = 0;
  for (const entry of entries) {
    if (!safeLottieArchivePath(entry.entryName)) return false;
    const size = entry.header.size;
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_LOTTIE_BYTES) return false;
    total += size;
    if (total > 50 * 1024 * 1024) return false;
  }
  return true;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dimension(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 16384;
}

/** Keep original valid animation JSON while bounding the data consumed by lottie-web. */
export function validLottieJson(source: string): boolean {
  if (Buffer.byteLength(source) > MAX_LOTTIE_BYTES) return false;
  try {
    const value: unknown = JSON.parse(source);
    if (!record(value) || !dimension(value.w) || !dimension(value.h)) return false;
    if (value.w * value.h > 40_000_000 || !Array.isArray(value.layers)) return false;
    return validLottieTiming(value) && boundedLottieTree(value);
  } catch {
    return false;
  }
}

function validLottieTiming(value: Record<string, unknown>): boolean {
  if (value.fr !== undefined && (typeof value.fr !== "number" || value.fr <= 0 || value.fr > 240))
    return false;
  if (![value.ip, value.op].every(validOptionalFrame)) return false;
  const start = numberOr(value.ip, 0);
  const end = numberOr(value.op, 0);
  const rate = numberOr(value.fr, 30);
  const duration = (end - start) / rate;
  return Number.isFinite(duration) && duration >= 0 && duration <= 3600;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function validOptionalFrame(frame: unknown): boolean {
  return (
    frame === undefined ||
    (typeof frame === "number" && Number.isFinite(frame) && Math.abs(frame) <= 10_000_000)
  );
}

function jsonChildren(value: unknown): [string, unknown][] {
  return value !== null && typeof value === "object" ? Object.entries(value) : [];
}

function boundedLottieTree(root: unknown): boolean {
  const pending = [{ value: root, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++count > 100000 || item.depth > 128) return false;
    if (typeof item.value === "number" && !Number.isFinite(item.value)) return false;
    for (const [key, value] of jsonChildren(item.value)) {
      if (!validLottieEntry(key, value)) return false;
      if (count + pending.length >= 100000) return false;
      pending.push({ value, depth: item.depth + 1 });
    }
  }
  return true;
}

function validLottieEntry(key: string, value: unknown): boolean {
  if (["__proto__", "constructor", "prototype"].includes(key)) return false;
  return key !== "layers" || (Array.isArray(value) && value.every(record));
}
