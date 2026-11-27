import { buildProjectApiPath } from "../../utils/projectRouting";
import { studioApiFetch } from "../../utils/studioApiFetch";

export const PREVIEW_PATH = /^(\/api\/projects\/[^/?#]+)\/preview(?:\/~[\w-]{43})?(?=[/?#]|$)/;

export function fetchFrameToken(frameTokenPath: string): Promise<string | null> {
  return studioApiFetch(frameTokenPath)
    .then((res) => (res.ok ? res.json() : null))
    .then((body: { token?: unknown } | null) =>
      typeof body?.token === "string" ? body.token : null,
    )
    .catch(() => null);
}

export function previewWithoutFrameToken(href: string): string {
  if (!URL.canParse(href)) return href.replace(PREVIEW_PATH, "$1/preview");
  const url = new URL(href);
  if (url.origin !== window.location.origin) return href;
  url.pathname = url.pathname.replace(PREVIEW_PATH, "$1/preview");
  return url.href;
}

const warmed = new Map<string, Promise<string | null>>();

/** Asks for the project's frame token now, so a sealed preview mounting later need not wait for it. Used once. */
export function warmFrameToken(projectId: string): void {
  const path = buildProjectApiPath(projectId, "/frame-token");
  if (!warmed.has(path)) warmed.set(path, fetchFrameToken(path));
}

/** The preview path under its project's frame token, where an opaque frame's own loads are let through. */
export async function previewUnderFrameToken(src: string): Promise<string> {
  const project = PREVIEW_PATH.exec(src)?.[1];
  if (!project) return src;
  const path = `${project}/frame-token`;
  const pending = warmed.get(path);
  warmed.delete(path);
  const token = await (pending ?? fetchFrameToken(path));
  return token ? src.replace(PREVIEW_PATH, `$1/preview/~${token}`) : src;
}
