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
