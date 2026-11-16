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
