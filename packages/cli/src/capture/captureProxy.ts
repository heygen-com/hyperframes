import { createServer, request, type IncomingMessage, type ServerResponse } from "node:http";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { assertPublicHostname, resolvePublicAddress } from "./publicNetwork.js";
import {
  captureUpstreamProxy,
  connectAuthority,
  openUpstreamTunnel,
  type UpstreamProxy,
} from "./upstreamProxy.js";
import { listenOnBrowserSafePort } from "@hyperframes/engine";

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

function refuse(response: ServerResponse): void {
  if (!response.headersSent) response.writeHead(403, { Connection: "close" });
  response.end();
}

async function httpPeer(url: URL, proxy: UpstreamProxy | undefined) {
  if (!proxy) {
    const hostname = await resolvePublicAddress(url.hostname);
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
): Promise<void> {
  try {
    const url = destination(incoming.url ?? "", false);
    const peer = await httpPeer(url, proxy);
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
      if (!response.headersSent) response.writeHead(502, { Connection: "close" });
      response.end();
    });
    response.on("close", () => upstream.destroy());
    incoming.on("error", () => upstream.destroy());
    incoming.pipe(upstream);
  } catch {
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
): Promise<void> {
  let upstream: Socket;
  try {
    upstream = await openUpstreamTunnel(proxy, connectAuthority(url), {
      onSocket: (socket) => trackSocket(socket, sockets),
    });
  } catch {
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
): Promise<void> {
  try {
    const url = destination(incoming.url ?? "", true);
    if (proxy) {
      assertPublicHostname(url.hostname);
      return await forwardTunnelViaUpstream(url, proxy, client, head, sockets);
    }
    const address = await resolvePublicAddress(url.hostname);
    if (client.destroyed) return;
    const upstream = connect({ host: address, family: 4, port: Number(url.port || 443) });
    trackSocket(upstream, sockets);
    const connectDeadline = setTimeout(() => upstream.destroy(), CONNECTION_TIMEOUT_MS);
    connectDeadline.unref();
    upstream.once("close", () => clearTimeout(connectDeadline));
    upstream.setTimeout(CONNECTION_TIMEOUT_MS, () => upstream.destroy());
    upstream.once("connect", () => {
      clearTimeout(connectDeadline);
      if (client.destroyed) return upstream.destroy();
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.once("close", () => client.destroy());
    client.once("close", () => upstream.destroy());
  } catch {
    client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  }
}

/** Every browser target uses this proxy; it dials a checked numeric IPv4 or the opt-in upstream proxy. */
export async function startCaptureProxy(): Promise<{ url: string; close(): Promise<void> }> {
  const proxy = captureUpstreamProxy();
  const sockets = new Set<Socket>();
  const server = createServer(
    (incoming, response) => void forwardHttp(incoming, response, sockets, proxy),
  );
  server.on("connection", (socket) => trackSocket(socket, sockets));
  server.on(
    "connect",
    (incoming, socket, head) => void forwardTunnel(incoming, socket, head, sockets, proxy),
  );
  server.on("upgrade", (_incoming, socket) => socket.destroy());
  server.maxConnections = 128;
  server.headersTimeout = CONNECTION_TIMEOUT_MS;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 1_000;
  await listenOnBrowserSafePort(server, "127.0.0.1");
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
