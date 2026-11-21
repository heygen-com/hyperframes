import { studioApiFetch } from "../../utils/studioApiFetch";

const PREVIEW_PATH = /^(\/api\/projects\/[^/?#]+)\/preview(?:\/~[\w-]{43})?(?=[/?#]|$)/;

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

/** The preview path under its project's frame token, where an opaque frame's own loads are let through. */
export async function previewUnderFrameToken(src: string): Promise<string> {
  const project = PREVIEW_PATH.exec(src)?.[1];
  if (!project) return src;
  const token = await fetchFrameToken(`${project}/frame-token`);
  return token ? src.replace(PREVIEW_PATH, `$1/preview/~${token}`) : src;
}
