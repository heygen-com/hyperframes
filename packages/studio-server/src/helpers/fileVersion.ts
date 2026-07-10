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
export function fileContentVersion(content: string): string {
  return `"sha256:${createHash("sha256").update(content, "utf8").digest("hex")}"`;
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

/** Attach one API write's identity to the corresponding filesystem-watch echo. */
export function consumeFileWriteReceipt(absPath: string): FileWriteReceipt | null {
  const now = Date.now();
  const current = (receipts.get(absPath) ?? []).filter(
    (entry) => now - entry.recordedAt < RECEIPT_TTL_MS,
  );
  const receipt = current.shift() ?? null;
  if (current.length > 0) receipts.set(absPath, current);
  else receipts.delete(absPath);
  if (!receipt) return null;
  const { path, version, writeToken } = receipt;
  return { path, version, writeToken };
}

export function resetFileWriteReceipts(): void {
  receipts.clear();
}
