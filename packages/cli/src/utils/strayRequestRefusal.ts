import type { Hono } from "hono";

// Opaque origin, unframeable, opener dropped: same-origin project script cannot read a `?code=` return.
const OAUTH_RETURN_PARAMS = ["code", "state"] as const;

export const INERT_REFUSAL_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
} as const;

function inertRefusal(): Response {
  return new Response("Not found", { status: 404, headers: INERT_REFUSAL_HEADERS });
}

function carriesOAuthReturn(url: string): boolean {
  const params = new URL(url).searchParams;
  return OAUTH_RETURN_PARAMS.some((name) => params.has(name));
}

/** Register before any other middleware: the refusal replaces whatever headers the others add. */
export function refuseStrayRequestsInertly(app: Hono): void {
  app.use(async function refuseStrayRequest(c, next) {
    if (carriesOAuthReturn(c.req.url)) return inertRefusal();
    await next();
    if (c.res.status !== 404) return;
    // Clear first: assigning over an existing response would carry its headers across.
    c.res = undefined;
    c.res = inertRefusal();
  });
}
