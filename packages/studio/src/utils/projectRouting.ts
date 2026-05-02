const PROJECT_HASH_PREFIX = "#project/";

export function encodeProjectId(projectId: string): string {
  return encodeURIComponent(projectId);
}

export function buildProjectHash(projectId: string): string {
  return `${PROJECT_HASH_PREFIX}${encodeProjectId(projectId)}`;
}

export function parseProjectIdFromHash(hash: string): string | null {
  if (!hash.startsWith(PROJECT_HASH_PREFIX)) return null;

  const encodedProjectId = hash.slice(PROJECT_HASH_PREFIX.length);
  if (!encodedProjectId || encodedProjectId.includes("/")) return null;

  try {
    return decodeURIComponent(encodedProjectId);
  } catch {
    return encodedProjectId;
  }
}

export function buildProjectApiPath(projectId: string, suffix = ""): string {
  const normalizedSuffix = suffix && !suffix.startsWith("/") ? `/${suffix}` : suffix;
  return `/api/projects/${encodeProjectId(projectId)}${normalizedSuffix}`;
}
