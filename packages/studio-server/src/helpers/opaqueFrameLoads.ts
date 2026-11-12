import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, Hono, Next } from "hono";

const GRANTED_LOADS = new Map([
  ["font", { path: /\.(woff2?|ttf|otf)$/i, type: /^font\// }],
  ["script", { path: /\.m?js$/i, type: /^text\/javascript\b/ }],
]);
const TOKEN_SEGMENT = /^~([\w-]{43})$/;

interface OpaqueFrameLoad {
  origin: string | undefined;
  dest: string | undefined;
  pathname: string;
  status: number;
  contentType: string | null;
}

function opaqueFrameLoadGranted(load: OpaqueFrameLoad): boolean {
  const grant = load.origin === "null" ? GRANTED_LOADS.get(load.dest ?? "") : undefined;
  if (!grant?.path.test(load.pathname)) return false;
  const keepsStoredContentType = load.status === 304;
  return keepsStoredContentType || grant.type.test(load.contentType ?? "");
}

export function createFrameTokens() {
  const secret = randomBytes(32);
  const tokenFor = (projectId: string) =>
    createHmac("sha256", secret).update(projectId).digest("base64url");
  const matches = (projectId: string, token: string) =>
    timingSafeEqual(Buffer.from(token), Buffer.from(tokenFor(projectId)));
  return { tokenFor, matches };
}

type FrameTokens = ReturnType<typeof createFrameTokens>;

const previewBase = (projectId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/preview/`;

function tokenPathHeaders(c: Context, res: Response, pathname: string): Headers {
  const headers = new Headers(res.headers);
  headers.set("Referrer-Policy", "no-referrer");
  const granted = opaqueFrameLoadGranted({
    origin: c.req.header("origin"),
    dest: c.req.header("sec-fetch-dest"),
    pathname,
    status: res.status,
    contentType: headers.get("content-type"),
  });
  if (granted) {
    headers.set("Access-Control-Allow-Origin", "null");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.append("Vary", "Origin");
  }
  return headers;
}

async function underToken(res: Response, headers: Headers, projectId: string, token: string) {
  if (res.status !== 200 || !headers.get("content-type")?.startsWith("text/html"))
    return new Response(res.body, { status: res.status, headers });
  const base = previewBase(projectId);
  headers.delete("content-length");
  const html = (await res.text()).replaceAll(base, `${base}~${token}/`);
  return new Response(html, { status: res.status, headers });
}

// Every opaque frame sends `Origin: null`, so the grant goes only to `preview/~<token>/` paths, which only the
// Studio's own pages can learn. The token path serves the plain path's response, its document re-based under the token.
export function serveTokenPreviewPaths(
  api: Hono,
  tokens: FrameTokens,
  resolveProjectId: (id: string) => Promise<string | undefined>,
) {
  return async (c: Context, next: Next) => {
    const url = new URL(c.req.url);
    const segments = url.pathname.split("/");
    const token = TOKEN_SEGMENT.exec(segments[4] ?? "")?.[1];
    if (!token) return next();
    const projectId = await resolveProjectId(c.req.param("id") ?? "");
    if (!projectId || !tokens.matches(projectId, token)) return c.text("not found", 404);
    segments.splice(4, 1);
    url.pathname = segments.join("/");
    const req = new Request(url, { method: c.req.method, headers: c.req.raw.headers });
    const res = await api.fetch(req);
    return underToken(res, tokenPathHeaders(c, res, url.pathname), projectId, token);
  };
}
