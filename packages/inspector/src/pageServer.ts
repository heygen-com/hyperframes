import type { Server } from "node:http";

export function closeServer(server: Server): Promise<void> {
  const closed = new Promise<void>((done) => server.close(() => done()));
  server.closeAllConnections();
  server.removeAllListeners("request");
  return closed;
}

export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return true;
  const name = host
    .replace(/:\d+$/, "")
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  return name === "127.0.0.1" || name === "localhost" || name === "::1";
}
