import type { Hono } from "hono";

/** A page cannot forge Host, so a site that rebinds its own name to 127.0.0.1 is refused here. */
export function isOwnLoopbackHost(host: string | undefined, port: number): boolean {
  const name = host?.toLowerCase();
  return name === `127.0.0.1:${port}` || name === `localhost:${port}` || name === `[::1]:${port}`;
}

/** The runtime hands an editing port to its parent frame, so another site must not frame these pages. */
export const SAME_ORIGIN_FRAMING_HEADERS = {
  "Content-Security-Policy": "frame-ancestors 'self'",
  "X-Frame-Options": "SAMEORIGIN",
} as const;

export function answerOwnLoopbackHostOnly(app: Hono, boundPort: () => number): void {
  app.use(async function refuseForeignHostAndFraming(c, next) {
    if (!isOwnLoopbackHost(c.req.header("host"), boundPort())) return c.text("Forbidden", 403);
    await next();
    for (const [name, value] of Object.entries(SAME_ORIGIN_FRAMING_HEADERS)) {
      c.res.headers.set(name, value);
    }
  });
}
