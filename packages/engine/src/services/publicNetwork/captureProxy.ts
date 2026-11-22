import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer, request, type IncomingMessage, type ServerResponse } from "node:http";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import {
  assertPublicHostname,
  NonPublicHostError,
  resolvePublicAddress,
  type RefusedHostClass,
} from "./publicNetwork.js";
import {
  captureUpstreamProxy,
  connectAuthority,
  openUpstreamTunnel,
  type UpstreamProxy,
} from "./upstreamProxy.js";
import { listenOnBrowserSafePort } from "../../utils/browserSafePort.js";
import { ABSOLUTE_MAX_WORKERS } from "../../utils/workerLimits.js";

const CONNECTION_TIMEOUT_MS = 15_000;
const HOP_HEADERS = new Set([
  "connection",
  "proxy-connection",
  "proxy-authorization",
  "proxy-authenticate",
  "keep-alive",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function forwardHeaders(message: IncomingMessage): IncomingMessage["headers"] {
  const headers = { ...message.headers };
  const connection = String(headers.connection ?? "").split(",");
  for (const name of [...HOP_HEADERS, ...connection]) delete headers[name.trim().toLowerCase()];
  return headers;
}

function destination(raw: string, tunnel: boolean): URL {
  const url = new URL(tunnel ? `https://${raw}` : raw);
  if (
    url.username ||
    url.password ||
    url.hash ||
    (tunnel
      ? url.protocol !== "https:" || url.pathname !== "/" || !!url.search
      : url.protocol !== "http:")
  ) {
    throw new Error("Unsupported capture destination");
  }
  return url;
}

type OnRefused = (hostClass: RefusedHostClass) => void;

export const BROWSER_PROXY_MAX_CONNECTIONS = 128;
export const POD_PROXY_MAX_CONNECTIONS = (ABSOLUTE_MAX_WORKERS + 1) * BROWSER_PROXY_MAX_CONNECTIONS;

export interface CaptureFailure {
  reason: "connection_cap" | "upstream_failed";
  open: number;
}
type OnFailed = (failure: CaptureFailure) => void;

export const logFailure: OnFailed = ({ reason, open }) => {
  console.warn(`[CaptureProxy:FAILED] reason=${reason} open=${open}`);
};

const refusalListeners = new Set<OnRefused>();

export function onRenderRefusal(listener: OnRefused): () => void {
  refusalListeners.add(listener);
  return () => refusalListeners.delete(listener);
}

export const logRefusal: OnRefused = (hostClass) => {
  console.warn(`[CaptureProxy:REFUSED] class=${hostClass}`);
  for (const listener of refusalListeners) listener(hostClass);
};

function reportRefusal(error: unknown, onRefused: OnRefused | undefined): void {
  if (error instanceof NonPublicHostError) onRefused?.(error.hostClass);
}

function refuse(response: ServerResponse): void {
  if (!response.headersSent) response.writeHead(403, { Connection: "close" });
  response.end();
}

async function resolveOrReportFailure(hostname: string, fail: () => void): Promise<string> {
  try {
    return await resolvePublicAddress(hostname);
  } catch (error) {
    if (!(error instanceof NonPublicHostError)) fail();
    throw error;
  }
}

async function httpPeer(url: URL, proxy: UpstreamProxy | undefined, fail: () => void) {
  if (!proxy) {
    const hostname = await resolveOrReportFailure(url.hostname, fail);
    return { hostname, family: 4, port: url.port || 80, path: url.pathname + url.search };
  }
  assertPublicHostname(url.hostname);
  return { hostname: proxy.host, port: proxy.port, path: url.href };
}

async function forwardHttp(
  incoming: IncomingMessage,
  response: ServerResponse,
  sockets: Set<Socket>,
  proxy: UpstreamProxy | undefined,
  onRefused: OnRefused | undefined,
  fail: () => void,
): Promise<void> {
  try {
    const url = destination(incoming.url ?? "", false);
    const peer = await httpPeer(url, proxy, fail);
    if (incoming.destroyed || response.destroyed) return;
    const headers = forwardHeaders(incoming);
    headers.host = url.host;
    if (proxy?.authorization) headers["proxy-authorization"] = proxy.authorization;
    const upstream = request(
      {
        ...peer,
        method: incoming.method,
        headers,
        agent: false,
        signal: AbortSignal.timeout(30_000),
      },
      (received) => {
        response.writeHead(received.statusCode ?? 502, forwardHeaders(received));
        received.on("error", () => response.destroy());
        received.pipe(response);
      },
    );
    upstream.on("socket", (socket) => trackSocket(socket, sockets));
    upstream.setTimeout(CONNECTION_TIMEOUT_MS, () =>
      upstream.destroy(new Error("Capture request timed out")),
    );
    upstream.on("error", () => {
      fail();
      if (!response.headersSent) response.writeHead(502, { Connection: "close" });
      response.end();
    });
    response.on("close", () => upstream.destroy());
    incoming.on("error", () => upstream.destroy());
    incoming.pipe(upstream);
  } catch (error) {
    reportRefusal(error, onRefused);
    refuse(response);
  }
}

function trackSocket(socket: Socket, sockets: Set<Socket>): void {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
  // Teardown can destroy either half of a tunnel while its peer is still writing.
  socket.on("error", () => socket.destroy());
}

async function forwardTunnelViaUpstream(
  url: URL,
  proxy: UpstreamProxy,
  client: Duplex,
  head: Buffer,
  sockets: Set<Socket>,
  fail: () => void,
): Promise<void> {
  let upstream: Socket;
  try {
    upstream = await openUpstreamTunnel(proxy, connectAuthority(url), {
      onSocket: (socket) => trackSocket(socket, sockets),
    });
  } catch {
    fail();
    if (!client.destroyed) {
      client.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    }
    return;
  }
  if (client.destroyed) return void upstream.destroy();
  upstream.setTimeout(CONNECTION_TIMEOUT_MS, () => upstream.destroy());
  client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
  if (head.length) upstream.write(head);
  upstream.pipe(client);
  client.pipe(upstream);
  upstream.once("close", () => client.destroy());
  client.once("close", () => upstream.destroy());
}

async function forwardTunnel(
  incoming: IncomingMessage,
  client: Duplex,
  head: Buffer,
  sockets: Set<Socket>,
  proxy: UpstreamProxy | undefined,
  onRefused: OnRefused | undefined,
  fail: () => void,
): Promise<void> {
  try {
    const url = destination(incoming.url ?? "", true);
    if (proxy) {
      assertPublicHostname(url.hostname);
      return await forwardTunnelViaUpstream(url, proxy, client, head, sockets, fail);
    }
    const address = await resolveOrReportFailure(url.hostname, fail);
    if (client.destroyed) return;
    const upstream = connect({ host: address, family: 4, port: Number(url.port || 443) });
    trackSocket(upstream, sockets);
    const connectDeadline = setTimeout(() => upstream.destroy(), CONNECTION_TIMEOUT_MS);
    connectDeadline.unref();
    upstream.once("close", () => clearTimeout(connectDeadline));
    upstream.setTimeout(CONNECTION_TIMEOUT_MS, () => upstream.destroy());
    let connected = false;
    upstream.once("connect", () => {
      connected = true;
      clearTimeout(connectDeadline);
      if (client.destroyed) return upstream.destroy();
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.once("close", () => {
      if (!connected && !client.destroyed) fail();
      client.destroy();
    });
    client.once("close", () => upstream.destroy());
  } catch (error) {
    reportRefusal(error, onRefused);
    client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  }
}

/** Every browser target uses this proxy; it dials a checked numeric IPv4, or (unless null) the upstream proxy. */
export async function startCaptureProxy(
  upstream: UpstreamProxy | null = captureUpstreamProxy() ?? null,
  onRefused?: OnRefused,
  fixedLoopbackPort?: number,
  {
    maxConnections = BROWSER_PROXY_MAX_CONNECTIONS,
    onFailed = logFailure,
  }: { maxConnections?: number; onFailed?: OnFailed } = {},
): Promise<{ url: string; close(): Promise<void> }> {
  const proxy = upstream ?? undefined;
  const sockets = new Set<Socket>();
  const clients = new Set<Socket>();
  const fail = () => closing || onFailed({ reason: "upstream_failed", open: clients.size });
  const server = createServer(
    (incoming, response) => void forwardHttp(incoming, response, sockets, proxy, onRefused, fail),
  );
  server.on("connection", (socket) => {
    trackSocket(socket, sockets);
    clients.add(socket);
    socket.once("close", () => clients.delete(socket));
  });
  server.on("drop", () => onFailed({ reason: "connection_cap", open: clients.size }));
  server.on(
    "connect",
    (incoming, socket, head) =>
      void forwardTunnel(incoming, socket, head, sockets, proxy, onRefused, fail),
  );
  server.on("upgrade", (_incoming, socket) => socket.destroy());
  server.maxConnections = maxConnections;
  server.headersTimeout = CONNECTION_TIMEOUT_MS;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 1_000;
  if (fixedLoopbackPort === undefined) await listenOnBrowserSafePort(server, "127.0.0.1");
  else
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(fixedLoopbackPort, "127.0.0.1", () => resolve());
    });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Capture proxy did not bind");
  let closing: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close() {
      closing ??= new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const socket of sockets) socket.destroy();
      });
      return closing;
    },
  };
}

export function pageServerDirectHost(pageServerUrl: string): string {
  const url = new URL(pageServerUrl);
  return `${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`;
}

export function browserProxyArgs(proxyUrl: string, directHost?: string): string[] {
  return [
    `--proxy-server=${proxyUrl}`,
    `--proxy-bypass-list=<-loopback>${directHost ? `;${directHost}` : ""}`,
    "--disable-quic",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  ];
}

export async function createPublicOnlyProfile(prefix: string): Promise<string> {
  const profile = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(profile, "Default"));
  await writeFile(
    join(profile, "Default", "Preferences"),
    JSON.stringify({ webrtc: { ip_handling_policy: "disable_non_proxied_udp" } }),
  );
  return profile;
}
