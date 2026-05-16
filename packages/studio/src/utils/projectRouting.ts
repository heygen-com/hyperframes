const PROJECT_HASH_PREFIX = "#project/";

export interface ProjectHashRoute {
  projectId: string;
  params: URLSearchParams;
}

function decodeHashProjectId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeHashParams(
  params?: URLSearchParams | Record<string, string | null | undefined>,
): URLSearchParams {
  if (!params) return new URLSearchParams();
  if (params instanceof URLSearchParams) return params;

  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (!key || value == null || value === "") continue;
    next.set(key, value);
  }
  return next;
}

export function encodeProjectId(projectId: string): string {
  return encodeURIComponent(projectId);
}

export function buildProjectHash(
  projectId: string,
  params?: URLSearchParams | Record<string, string | null | undefined>,
): string {
  const search = normalizeHashParams(params).toString();
  return `${PROJECT_HASH_PREFIX}${encodeProjectId(projectId)}${search ? `?${search}` : ""}`;
}

export function parseProjectHashRoute(hash: string): ProjectHashRoute | null {
  if (!hash.startsWith(PROJECT_HASH_PREFIX)) return null;

  const route = hash.slice(PROJECT_HASH_PREFIX.length);
  const queryIndex = route.indexOf("?");
  const encodedProjectId = queryIndex >= 0 ? route.slice(0, queryIndex) : route;
  if (!encodedProjectId || encodedProjectId.includes("/")) return null;

  const rawParams = queryIndex >= 0 ? route.slice(queryIndex + 1) : "";
  return {
    projectId: decodeHashProjectId(encodedProjectId),
    params: new URLSearchParams(rawParams),
  };
}

export function parseProjectIdFromHash(hash: string): string | null {
  return parseProjectHashRoute(hash)?.projectId ?? null;
}

export function buildProjectApiPath(projectId: string, suffix = ""): string {
  const normalizedSuffix = suffix && !suffix.startsWith("/") ? `/${suffix}` : suffix;
  return `/api/projects/${encodeProjectId(projectId)}${normalizedSuffix}`;
}
