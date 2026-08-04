// A token is marked before the request starts, so its lifetime must cover slow writes,
// retries, and the subsequent file-change echo without retaining abandoned tokens forever.
const WRITE_TOKEN_TTL_MS = 5 * 60_000;
const studioWriteTokens = new Map<string, number>();

function pruneStudioWriteTokens(now: number): void {
  for (const [token, createdAt] of studioWriteTokens) {
    if (now - createdAt >= WRITE_TOKEN_TTL_MS) studioWriteTokens.delete(token);
  }
}

/** Marked by the Studio file writer introduced in external-change stack PR #2990. */
export function markStudioWriteToken(token: string, now: number = Date.now()): void {
  pruneStudioWriteTokens(now);
  studioWriteTokens.set(token, now);
}

/** Consumed by the external-change coordinator introduced in stack PR #2991. */
export function consumeStudioWriteToken(token: string | null, now: number = Date.now()): boolean {
  pruneStudioWriteTokens(now);
  if (!token || !studioWriteTokens.has(token)) return false;
  studioWriteTokens.delete(token);
  return true;
}

/** Resets module-level echo identity between PR #2991 coordinator tests. */
export function resetStudioWriteTokens(): void {
  studioWriteTokens.clear();
}

/** Browser-safe SHA-256 version matching studio-server's strong ETag format. */
export async function studioFileContentVersion(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return `"sha256:${hex}"`;
}

/** Prefer an explicit content precondition, then the version observed during the read. */
export async function studioExpectedFileVersion(
  versions: ReadonlyMap<string, string | null>,
  path: string,
  expectedContent?: string,
): Promise<string | null | undefined> {
  if (expectedContent !== undefined) return studioFileContentVersion(expectedContent);
  return versions.get(path);
}

export function createStudioWriteToken(): string {
  return globalThis.crypto.randomUUID();
}
