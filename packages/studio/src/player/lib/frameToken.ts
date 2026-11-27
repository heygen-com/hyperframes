import { buildProjectApiPath } from "../../utils/projectRouting";
import { studioApiFetch } from "../../utils/studioApiFetch";

export const PREVIEW_PATH = /^(\/api\/projects\/[^/?#]+)\/preview(?:\/~[\w-]{43})?(?=[/?#]|$)/;

export const FRAME_TOKEN_DEADLINE_MS = 5_000;

export function fetchFrameToken(frameTokenPath: string): Promise<string | null> {
  const abort = new AbortController();
  const deadline = setTimeout(() => abort.abort(), FRAME_TOKEN_DEADLINE_MS);
  const expired = new Promise<null>((done) =>
    abort.signal.addEventListener("abort", () => done(null)),
  );
  const lookup = studioApiFetch(frameTokenPath, { signal: abort.signal })
    .then((res) => (res.ok ? res.json() : null))
    .then((body: { token?: unknown } | null) =>
      typeof body?.token === "string" ? body.token : null,
    )
    .catch(() => null);
  return Promise.race([lookup, expired]).finally(() => clearTimeout(deadline));
}

export function previewWithoutFrameToken(href: string): string {
  if (!URL.canParse(href)) return href.replace(PREVIEW_PATH, "$1/preview");
  const url = new URL(href);
  if (url.origin !== window.location.origin) return href;
  url.pathname = url.pathname.replace(PREVIEW_PATH, "$1/preview");
  return url.href;
}

let primed: { projectId: string; token: string } | null = null;

export function primeFrameToken(next: { projectId: string; token: string } | null): void {
  primed = next;
}

/** The preview path under its project's frame token, where an opaque frame's own loads are let through. */
export async function previewUnderFrameToken(
  src: string,
  onStale?: (fresh: string) => void,
): Promise<string> {
  const project = PREVIEW_PATH.exec(src)?.[1];
  if (!project) return src;
  const path = `${project}/frame-token`;
  const under = (token: string) => src.replace(PREVIEW_PATH, `$1/preview/~${token}`);
  const given = primed && buildProjectApiPath(primed.projectId) === project ? primed.token : null;
  primed = null;
  if (given === null) {
    const token = await fetchFrameToken(path);
    return token ? under(token) : src;
  }
  void fetchFrameToken(path).then((token) => {
    if (token && token !== given) onStale?.(under(token));
  });
  return under(given);
}
