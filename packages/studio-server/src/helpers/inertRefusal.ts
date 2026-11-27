// The sandbox CSP gives an opaque origin no same-origin opener can read (COOP alone does not).
const INERT_REFUSAL_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
} as const;

export function inertRefusal(status: 400 | 404, fixedMessage: string): Response {
  return new Response(`${fixedMessage}\n`, { status, headers: INERT_REFUSAL_HEADERS });
}

const OAUTH_RETURN_PARAMS = ["code", "state"] as const;

export function carriesOAuthReturn(urlOrRequestTarget: string): boolean {
  const params = new URL(urlOrRequestTarget, "http://loopback").searchParams;
  return OAUTH_RETURN_PARAMS.some((name) => params.has(name));
}

export function refuseOAuthReturn(): Response {
  return inertRefusal(400, "This HyperFrames preview server does not accept sign-in returns.");
}
