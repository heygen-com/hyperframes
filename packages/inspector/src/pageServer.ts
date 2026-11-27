import type { Server } from "node:http";
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { isPrivateFileUnder, isStudioPrivatePath } from "../../core/src/safePath";

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

export function isOwnPageHost(host: string | undefined, port: number): boolean {
  const name = host?.toLowerCase();
  return name === `127.0.0.1:${port}` || name === `localhost:${port}` || name === `[::1]:${port}`;
}

export function fromAnotherSite(fetchSite: string | string[] | undefined): boolean {
  return typeof fetchSite === "string" && fetchSite !== "same-origin" && fetchSite !== "none";
}

export const NO_FRAMING_HEADERS = {
  "Content-Security-Policy": "frame-ancestors 'self'",
  "X-Frame-Options": "SAMEORIGIN",
  "Cross-Origin-Resource-Policy": "same-origin",
} as const;

export function servableProjectFile(project: string, urlPath: string): string | null {
  const requested = resolve(project, `.${urlPath}`);
  if (isPrivateFileUnder(project, requested, isStudioPrivatePath)) return null;
  try {
    const file = realpathSync(requested);
    return file.startsWith(project + sep) ? file : null;
  } catch {
    return null;
  }
}
