import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { scanActiveServers, type ActiveServer } from "../server/portUtils.js";
import type {
  LintResult,
  ResolvedProject,
  StudioSelectionResponse,
} from "@hyperframes/studio-server";

export type StudioLintResponse = LintResult;

const VITE_STUDIO_DISCOVERY_PORTS = [5190] as const;

interface StudioProjectsResponse {
  projects?: ResolvedProject[];
}

interface FindPreviewServerOptions {
  preferredPort?: number;
}

export class AmbiguousPreviewServerError extends Error {
  readonly ports: number[];

  constructor(servers: ActiveServer[]) {
    const ports = servers.map((server) => server.port).sort((a, b) => a - b);
    super(
      `Multiple Studio preview servers match this project (${ports.join(", ")}). Pass --port <port> to choose one.`,
    );
    this.name = "AmbiguousPreviewServerError";
    this.ports = ports;
  }
}

export class PreviewServerPortMismatchError extends Error {
  readonly requestedPort: number;
  readonly ports: number[];

  constructor(requestedPort: number, servers: ActiveServer[]) {
    const ports = servers.map((server) => server.port).sort((a, b) => a - b);
    super(
      `No Studio preview server for this project is running on port ${requestedPort}. Matching server port${ports.length === 1 ? "" : "s"}: ${ports.join(", ")}. Rerun with --port ${ports[0]}${ports.length > 1 ? " or omit --port to see all candidates" : ""}.`,
    );
    this.name = "PreviewServerPortMismatchError";
    this.requestedPort = requestedPort;
    this.ports = ports;
  }
}

function normalizePath(path: string): string {
  const resolved = resolve(path);
  try {
    if (existsSync(resolved)) {
      return realpathSync(resolved).replace(/\\/g, "/").toLowerCase();
    }
  } catch {
    // Fall through to resolved-path normalization.
  }
  return resolved.replace(/\\/g, "/").toLowerCase();
}

export async function findPreviewServerForProject(
  projectDir: string,
  startPort = 3002,
  scan: (startPort?: number) => Promise<ActiveServer[]> = scanActiveServers,
  fetchImpl: typeof fetch = fetch,
  options: FindPreviewServerOptions = {},
): Promise<ActiveServer | null> {
  const normalizedProjectDir = normalizePath(projectDir);
  const servers = await scan(startPort);
  const embeddedServers = servers.filter(
    (server) => normalizePath(server.projectDir) === normalizedProjectDir,
  );
  if (options.preferredPort !== undefined) {
    const preferred = embeddedServers.find((server) => server.port === options.preferredPort);
    if (preferred) return preferred;
    const viteServer = await findViteStudioServerForProject(normalizedProjectDir, fetchImpl, [
      options.preferredPort,
    ]);
    if (viteServer) return viteServer;
    if (embeddedServers.length > 0) {
      throw new PreviewServerPortMismatchError(options.preferredPort, embeddedServers);
    }
    return null;
  }
  if (embeddedServers.length === 1) return embeddedServers[0]!;
  if (embeddedServers.length > 1) throw new AmbiguousPreviewServerError(embeddedServers);
  return findViteStudioServerForProject(normalizedProjectDir, fetchImpl);
}

export function studioSelectionUrl(server: ActiveServer): string {
  return studioApiUrl(server, "selection");
}

export function studioApiUrl(server: ActiveServer, route: string): string {
  const host = server.host ?? "127.0.0.1";
  return `http://${host}:${server.port}/api/projects/${encodeURIComponent(server.projectName)}/${route}`;
}

// Vite dev servers bind IPv6 loopback (`::1`) by default while embedded servers
// bind IPv4 (`127.0.0.1`), so probe both — a single family misses the other and
// is exactly why `--selection`/`--context` failed against a local-studio preview.
const LOOPBACK_HOSTS = ["127.0.0.1", "[::1]"] as const;

async function findViteStudioServerForProject(
  normalizedProjectDir: string,
  fetchImpl: typeof fetch,
  ports: readonly number[] = VITE_STUDIO_DISCOVERY_PORTS,
): Promise<ActiveServer | null> {
  for (const port of ports) {
    for (const host of LOOPBACK_HOSTS) {
      try {
        const response = await fetchImpl(`http://${host}:${port}/api/projects`);
        if (!response.ok) continue;
        const payload = (await response.json()) as StudioProjectsResponse;
        const project = payload.projects?.find(
          (candidate) => normalizePath(candidate.dir) === normalizedProjectDir,
        );
        if (!project) continue;
        return {
          port,
          host,
          projectName: project.id,
          projectDir: project.dir,
          version: "studio-dev",
          pid: null,
        };
      } catch {
        // Not a Vite-served Studio on this host/port, or unreachable. Try next.
      }
    }
  }
  return null;
}

export async function fetchStudioSelection(
  server: ActiveServer,
  fetchImpl: typeof fetch = fetch,
): Promise<StudioSelectionResponse> {
  const url = studioSelectionUrl(server);
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`selection endpoint returned ${response.status}`);
  }
  return (await response.json()) as StudioSelectionResponse;
}

export async function fetchStudioLint(
  server: ActiveServer,
  fetchImpl: typeof fetch = fetch,
): Promise<StudioLintResponse> {
  const url = studioApiUrl(server, "lint");
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`lint endpoint returned ${response.status}`);
  }
  return (await response.json()) as StudioLintResponse;
}
