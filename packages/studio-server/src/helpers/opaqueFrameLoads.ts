import type { Context, Next } from "hono";

// An opaque frame loads fonts and module scripts with `Origin: null`. Only the browser sets
// `Sec-Fetch-Dest`, and a page's own fetch() always sends `empty`, so script never gets a grant.
const GRANTED_LOADS = new Map([
  ["font", { path: /\.(woff2?|ttf|otf)$/i, type: /^font\// }],
  ["script", { path: /\.m?js$/i, type: /^text\/javascript\b/ }],
]);

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

export async function grantOpaqueFrameLoads(c: Context, next: Next): Promise<void> {
  await next();
  const granted = opaqueFrameLoadGranted({
    origin: c.req.header("origin"),
    dest: c.req.header("sec-fetch-dest"),
    pathname: new URL(c.req.url).pathname,
    status: c.res.status,
    contentType: c.res.headers.get("content-type"),
  });
  if (!granted) return;
  c.header("Access-Control-Allow-Origin", "null");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Vary", "Origin", { append: true });
}
