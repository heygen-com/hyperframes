/**
 * Resolve a media element `src` to a project-relative asset path for Studio
 * media APIs (metadata, remove-background).
 *
 * Accepts authored relative paths and Studio preview URLs (absolute or
 * `/api/projects/<id>/preview/...`). Rejects external http(s), data, blob,
 * file, protocol-relative, and other `/api` paths that are not project
 * preview assets.
 *
 * Pure — unit-tested.
 */

const PREVIEW_PREFIX = /^\/api\/projects\/[^/]+\/preview\//;

function stripQueryAndHash(value: string): string {
  const queryIndex = value.indexOf("?");
  const hashIndex = value.indexOf("#");
  if (queryIndex < 0) return hashIndex < 0 ? value : value.slice(0, hashIndex);
  if (hashIndex < 0) return value.slice(0, queryIndex);
  return value.slice(0, Math.min(queryIndex, hashIndex));
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeRelativeSegments(path: string): string {
  const parts = path.split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }
  return normalized.join("/");
}

/**
 * @param src - Raw `src` attribute or resolved URL from the preview DOM.
 * @param sourceFile - Composition file that authored the relative `src`
 *   (used to resolve `./` / `../` against the project root). Defaults to
 *   `index.html` at the project root.
 * @returns Project-relative path (no leading `./`), or `null` when the src
 *   is not a project-local asset.
 */
export function resolveProjectAssetPath(src: string, sourceFile = "index.html"): string | null {
  const trimmed = src.trim();
  if (!trimmed) return null;

  // Reject non-project schemes and protocol-relative URLs before any parsing.
  if (/^(?:data:|blob:|file:)/i.test(trimmed)) return null;
  if (trimmed.startsWith("//")) return null;

  let path = trimmed;
  let fromPreviewUrl = false;

  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }

  path = stripQueryAndHash(path);

  if (PREVIEW_PREFIX.test(path)) {
    path = path.replace(PREVIEW_PREFIX, "");
    fromPreviewUrl = true;
  } else if (path.startsWith("/")) {
    // Root-relative but not a Studio preview asset (e.g. /api/media/...).
    return null;
  }

  path = safeDecodeURIComponent(path);
  if (!path) return null;

  // Preview URLs are already project-root relative. Authored relative paths
  // resolve against the composition file's directory.
  if (!fromPreviewUrl) {
    const sourceDir = sourceFile.includes("/")
      ? sourceFile.slice(0, sourceFile.lastIndexOf("/"))
      : "";
    path = sourceDir ? `${sourceDir}/${path}` : path;
  }

  const normalized = normalizeRelativeSegments(path);
  return normalized || null;
}
