/**
 * Loopback HTTP server for the OAuth authorization-code callback.
 *
 * The CLI binds a server to `127.0.0.1:0` (ephemeral port), sends the
 * user's browser to `/v1/oauth/authorize?redirect_uri=…` pointing at
 * this server, and waits for the redirect carrying `?code=…&state=…`.
 *
 * The backend wildcards localhost ports for public clients
 * (`movio/model/oauth2.py:check_redirect_uri`), so the registered
 * redirect URI's port is just a placeholder — the actual port the
 * server lands on is what matters at runtime.
 *
 * Times out after 120s. Validates `state` matches the value we
 * generated. Renders a small "you can close this window" page back
 * to the browser before shutting down.
 */

import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";

export interface LoopbackOptions {
  /** Expected `state` value — flow fails if it doesn't match. */
  state: string;
  /** Timeout in ms (default 120s). */
  timeoutMs?: number;
  /** Override port for tests (default 0 = ephemeral). */
  port?: number;
}

export interface LoopbackResult {
  /** Authorization code from the IdP. */
  code: string;
  /** The full redirect_uri (with port) we listened on. */
  redirectUri: string;
}

export interface LoopbackHandle {
  /** Promise that resolves with the captured code, or rejects on timeout/error. */
  result: Promise<LoopbackResult>;
  /** Redirect URI to pass to /v1/oauth/authorize. */
  redirectUri: string;
  /** Stop the server early (e.g. user cancels). */
  close: () => Promise<void>;
}

const CALLBACK_PATH = "/oauth/callback";
const DEFAULT_TIMEOUT_MS = 120_000;

export async function startLoopback(opts: LoopbackOptions): Promise<LoopbackHandle> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let resolveResult!: (value: LoopbackResult) => void;
  let rejectResult!: (err: Error) => void;
  const result = new Promise<LoopbackResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  // redirectUri is the value the IdP sees on /authorize. RFC 6749 §4.1.3
  // requires the token exchange's redirect_uri to be byte-identical to
  // it, so we capture this string once and reuse it on both hops — never
  // reconstructing from req.socket.localAddress later (which can drift
  // on dual-stack hosts).
  let redirectUri = "";

  const server = createServer((req, res) =>
    handleRequest(req, res, opts.state, redirectUri, resolveResult, rejectResult),
  );

  await listen(server, opts.port ?? 0);
  const address = server.address() as AddressInfo;
  redirectUri = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`;

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    // `server.close()` only refuses NEW connections — it does NOT
    // terminate existing keep-alive sockets, which browsers default to
    // and idle for minutes (Chrome ~5min). Without `closeAllConnections`
    // the CLI process hangs after "Signed in" until the browser closes
    // its idle socket. `respond()` also emits `Connection: close` so the
    // browser doesn't try to keep-alive in the first place.
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  const timer = setTimeout(() => {
    rejectResult(new Error(`OAuth callback timed out after ${timeoutMs}ms`));
    void close();
  }, timeoutMs);

  // When result settles, drain the timer + shutdown.
  result.finally(close).catch(() => {});

  return { result, redirectUri, close };
}

async function listen(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

// fallow-ignore-next-line complexity
function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedState: string,
  redirectUri: string,
  resolveResult: (value: LoopbackResult) => void,
  rejectResult: (err: Error) => void,
): void {
  // Only GET is part of the OAuth redirect contract. Anything else is
  // probe-traffic on the ephemeral port; reject without leaking that a
  // CLI is listening there.
  if (req.method !== "GET") {
    res.writeHead(405, { "content-type": "text/plain" }).end("Method Not Allowed");
    return;
  }

  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== CALLBACK_PATH) {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not Found");
    return;
  }

  const params = url.searchParams;
  const error = params.get("error");
  if (error) {
    const desc = params.get("error_description") ?? "";
    respond(res, 400, errorPage(error, desc));
    rejectResult(new Error(`OAuth authorize returned error: ${error}${desc ? ` — ${desc}` : ""}`));
    return;
  }

  const state = params.get("state");
  if (!state || !stateMatches(state, expectedState)) {
    respond(res, 400, errorPage("invalid_state", "State parameter did not match."));
    rejectResult(new Error("OAuth state mismatch — possible CSRF, aborting."));
    return;
  }

  const code = params.get("code");
  if (!code) {
    respond(
      res,
      400,
      errorPage("missing_code", "Authorization code is missing from the redirect."),
    );
    rejectResult(new Error("OAuth redirect did not include `code`."));
    return;
  }

  respond(res, 200, successPage());
  resolveResult({ code, redirectUri });
}

/**
 * Constant-time comparison for the OAuth `state` parameter. Real
 * exploitability is very low (loopback, 256-bit entropy, narrow flow
 * window), but the rest of the auth path uses crypto-grade primitives
 * and a `!==` here would be a gratuitous deviation in security review.
 */
function stateMatches(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function respond(res: ServerResponse, status: number, body: string): void {
  res
    .writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      // Tell the browser not to keep the TCP socket alive — otherwise
      // `server.close()` blocks on the idle keep-alive timeout
      // (Chrome ~5min). Combined with `server.closeAllConnections()`
      // in `close()` this guarantees the CLI exits promptly after the
      // user sees the success page.
      connection: "close",
    })
    .end(body);
}

function successPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Signed in to HeyGen</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0b0f14;color:#e6e8eb}main{max-width:480px;text-align:center;padding:32px;border-radius:12px;background:#11161d;border:1px solid #1f2630}h1{font-weight:600;margin:0 0 8px;color:#3CE6AC}p{margin:0;color:#9aa3ad}</style>
</head><body><main><h1>You're signed in.</h1><p>You can close this tab and return to your terminal.</p></main></body></html>`;
}

function errorPage(code: string, description: string): string {
  const safeCode = escapeHtml(code);
  const safeDesc = escapeHtml(description);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Sign-in failed</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1a0b0b;color:#e6e8eb}main{max-width:480px;text-align:center;padding:32px;border-radius:12px;background:#1d1111;border:1px solid #301f1f}h1{font-weight:600;margin:0 0 8px;color:#ff7a7a}code{background:#2a1414;padding:2px 6px;border-radius:4px}p{margin:8px 0 0;color:#9aa3ad}</style>
</head><body><main><h1>Sign-in failed</h1><p><code>${safeCode}</code></p><p>${safeDesc}</p></main></body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
