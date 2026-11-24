import { request as httpRequest } from "node:http";
import type { Socket } from "node:net";

const CAPTURE_PROXY_ENV = "HYPERFRAMES_CAPTURE_PROXY";

const TUNNEL_TIMEOUT_MS = 15_000;

export interface UpstreamProxy {
  host: string;
  port: number;
  authorization?: string;
}

function defaultPort(target: URL): string {
  return target.port || (target.protocol === "https:" ? "443" : "80");
}

/** Unset means capture dials checked public peers itself; set, every capture request goes to this proxy. */
export function captureUpstreamProxy(
  env: Readonly<Record<string, string | undefined>> = process.env,
): UpstreamProxy | undefined {
  const raw = env[CAPTURE_PROXY_ENV]?.trim();
  if (!raw) return undefined;
  let url: URL;
  let credentials: string | undefined;
  try {
    url = new URL(raw);
    if (url.username || url.password) {
      credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
    }
  } catch {
    throw new Error(`${CAPTURE_PROXY_ENV} is not a valid proxy URL`);
  }
  if (url.protocol !== "http:") {
    throw new Error(`${CAPTURE_PROXY_ENV} must be an http:// proxy URL`);
  }
  return {
    host: url.hostname.replace(/^\[(.*)\]$/, "$1"),
    port: Number(url.port || 80),
    authorization: credentials ? `Basic ${Buffer.from(credentials).toString("base64")}` : undefined,
  };
}

export function connectAuthority(target: URL): string {
  return `${target.hostname}:${defaultPort(target)}`;
}

/** Opens a CONNECT tunnel through the upstream proxy; resolves only on a 2xx reply. */
export function openUpstreamTunnel(
  proxy: UpstreamProxy,
  authority: string,
  options: { signal?: AbortSignal; onSocket?: (socket: Socket) => void } = {},
): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    const req = httpRequest({
      host: proxy.host,
      port: proxy.port,
      method: "CONNECT",
      path: authority,
      headers: {
        host: authority,
        ...(proxy.authorization ? { "proxy-authorization": proxy.authorization } : {}),
      },
      agent: false,
      signal: options.signal,
    });
    req.once("socket", (socket) => options.onSocket?.(socket));
    req.setTimeout(TUNNEL_TIMEOUT_MS, () =>
      req.destroy(new Error("Upstream proxy CONNECT timed out")),
    );
    req.once("connect", (response, socket, head) => {
      const status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        socket.destroy();
        reject(new Error(`Upstream proxy refused CONNECT with HTTP ${status}`));
        return;
      }
      socket.setTimeout(0);
      if (head.length) socket.unshift(head);
      resolve(socket);
    });
    req.once("response", (response) => {
      response.resume();
      req.destroy();
      reject(new Error(`Upstream proxy refused CONNECT with HTTP ${response.statusCode}`));
    });
    req.once("error", reject);
    req.end();
  });
}
