import { writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ponytail: bound the download so a hostile/runaway URL can't fill the disk.
// 256MB covers any real media asset; raise if 4K video sources ever exceed it.
const MAX_FREEZE_BYTES = 256 * 1024 * 1024;

export async function freezeUrl(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`freeze failed: HTTP ${res.status} for ${String(url).slice(0, 80)}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0)
    throw new Error(`freeze failed: empty response for ${String(url).slice(0, 80)}`);
  if (bytes.length > MAX_FREEZE_BYTES)
    throw new Error(
      `freeze failed: ${bytes.length} bytes exceeds ${MAX_FREEZE_BYTES} cap for ${String(url).slice(0, 80)}`,
    );
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, bytes);
  return bytes.length;
}

export function freezeLocalFile(srcPath, destPath) {
  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(srcPath, destPath);
}
