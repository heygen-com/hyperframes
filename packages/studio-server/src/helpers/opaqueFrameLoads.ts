import type { Context, Next } from "hono";

/**
 * A preview framed with an opaque origin (the Compositions hover preview, or a preview another site
 * frames) makes its CORS-mode loads with `Origin: null`, so a project font or module script fails
 * without a CORS grant. The grant is chosen by `Sec-Fetch-Dest`, which the browser sets and page
 * script cannot: a page's own `fetch()` is always `empty`, so composition script still cannot read
 * a project file.
 */
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
  // A 304 carries no Content-Type; the browser keeps the stored response's.
  return load.status === 304 || grant.type.test(load.contentType ?? "");
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
