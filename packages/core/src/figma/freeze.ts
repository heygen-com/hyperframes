/**
 * "Freeze" = write asset bytes to local disk permanently so renders never
 * re-fetch from figma (design spec §5) — not Object.freeze.
 */

import { copyFileSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// ponytail: bound the write so a hostile/runaway source can't fill the disk.
export const MAX_FREEZE_BYTES = 256 * 1024 * 1024;

export function exceedsFreezeCap(byteLength: number): boolean {
  return byteLength > MAX_FREEZE_BYTES;
}

export function freezeBytes(bytes: Uint8Array, destPath: string): number {
  if (bytes.length === 0) throw new Error("freeze failed: empty bytes");
  if (exceedsFreezeCap(bytes.length))
    throw new Error(`freeze failed: ${bytes.length} bytes exceeds ${MAX_FREEZE_BYTES} cap`);
  mkdirSync(dirname(destPath), { recursive: true });
  // Exclusive create; on EEXIST remove and retry — never write through an
  // existing file or planted symlink (CodeQL js/insecure-temporary-file).
  try {
    writeFileSync(destPath, bytes, { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    rmSync(destPath);
    writeFileSync(destPath, bytes, { flag: "wx" });
  }
  return bytes.length;
}

/**
 * Only figma-owned hosts may be frozen from a URL — render/CDN responses
 * come from figma.com subdomains or figma's S3 buckets. Blocks SSRF via a
 * crafted manifest/config URL (metadata endpoints, internal services).
 */
export function isAllowedFreezeUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname;
  return host === "figma.com" || host.endsWith(".figma.com") || host.endsWith(".amazonaws.com");
}

export async function freezeUrl(url: string, destPath: string): Promise<number> {
  if (!isAllowedFreezeUrl(url))
    throw new Error(`freeze failed: refusing non-figma url ${url} (https + figma hosts only)`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`freeze failed: HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (exceedsFreezeCap(declared))
    throw new Error(`freeze failed: content-length ${declared} exceeds ${MAX_FREEZE_BYTES} cap`);
  return freezeBytes(new Uint8Array(await res.arrayBuffer()), destPath);
}

export function freezeLocalFile(srcPath: string, destPath: string): void {
  const size = statSync(srcPath).size;
  if (exceedsFreezeCap(size))
    throw new Error(`freeze failed: ${size} bytes exceeds ${MAX_FREEZE_BYTES} cap`);
  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(srcPath, destPath);
}
