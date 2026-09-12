import { createHash, randomUUID } from "node:crypto";

export interface FileWriteReceipt {
  path: string;
  version: string;
  writeToken: string;
}

interface StoredReceipt extends FileWriteReceipt {
  recordedAt: number;
}

const RECEIPT_TTL_MS = 10_000;
const receipts = new Map<string, StoredReceipt[]>();

/** Strong content version used as both the JSON version and HTTP ETag. */
export function fileContentVersion(content: string | Uint8Array): string {
  return `"sha256:${createHash("sha256").update(content).digest("hex")}"`;
}

export function createWriteToken(requestToken?: string): string {
  const token = requestToken?.trim();
  return token && token.length <= 200 ? token : randomUUID();
}

export function recordFileWriteReceipt(absPath: string, receipt: FileWriteReceipt): void {
  const now = Date.now();
  const current = (receipts.get(absPath) ?? []).filter(
    (entry) => now - entry.recordedAt < RECEIPT_TTL_MS,
  );
  current.push({ ...receipt, recordedAt: now });
  receipts.set(absPath, current);
}

/**
 * Attach one API write's identity to the watcher echo for its exact bytes.
 *
 * Reading is non-destructive: one watcher event fans out to every open SSE
 * subscriber, and a receipt removed by the first reader leaves the rest seeing
 * an unlabelled change and reloading the preview on Studio's own edit. Only the
 * TTL removes a receipt.
 */
export function identifyFileWrite(
  absPath: string,
  expectedVersion: string,
): FileWriteReceipt | null {
  const now = Date.now();
  const current = (receipts.get(absPath) ?? []).filter(
    (entry) => now - entry.recordedAt < RECEIPT_TTL_MS,
  );
  if (current.length > 0) receipts.set(absPath, current);
  else receipts.delete(absPath);
  // Newest match, not oldest: identical bytes written twice inside the TTL
  // (undo, retyping a value) share a version, and the older token was already
  // spent by the client on its own echo. The destructive read used to advance
  // past it; scanning from the end keeps that cursor without the eviction.
  let receipt: StoredReceipt | undefined;
  for (let i = current.length - 1; i >= 0 && !receipt; i -= 1) {
    if (current[i]?.version === expectedVersion) receipt = current[i];
  }
  if (!receipt) return null;
  const { path, version, writeToken } = receipt;
  return { path, version, writeToken };
}

/**
 * @deprecated Renamed to {@link identifyFileWrite}, which despite this alias's
 * name does NOT consume the receipt: one watcher event fans out to every SSE
 * subscriber, so a destructive read left all but the first reloading on Studio's
 * own write. Kept for one release; call `identifyFileWrite` instead.
 */
export const consumeFileWriteReceipt = identifyFileWrite;

export function resetFileWriteReceipts(): void {
  receipts.clear();
}
