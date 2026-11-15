import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import config from "./vite.config";

const ENV = "HYPERFRAMES_PREVIEW_ALLOWED_HOSTS";

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => unknown;

interface Reply {
  status: number | undefined;
  body: string;
}

const httpServers: EventEmitter[] = [];

afterEach(() => {
  // Closes the plugin's project watcher.
  for (const httpServer of httpServers.splice(0)) httpServer.emit("close");
  vi.unstubAllEnvs();
});

function devApiPlugin(): Plugin {
  const plugin = (config.plugins ?? [])
    .flat(Infinity)
    .find(
      (p): p is Plugin =>
        typeof p === "object" && p !== null && "name" in p && p.name === "studio-dev-api",
    );
  if (!plugin) throw new Error("studio-dev-api plugin not found");
  return plugin;
}

// Stands in for the studio-server module so an allowed /api/ request has something to reach.
function fakeStudioServerModule(): Record<string, unknown> {
  return {
    createStudioApi: () => ({ fetch: async () => Response.json({ ok: true }) }),
    previewAllowedHostsFromEnv: () => [],
    identifyFileWrite: () => null,
    fileContentVersion: () => "v",
    affectsPreview: () => true,
    openProjectHistory: async () => null,
    DELETED_VERSION: "deleted",
  };
}

function startPlugin(): Middleware[] {
  const middlewares: Middleware[] = [];
  const httpServer = new EventEmitter();
  httpServers.push(httpServer);
  const server = {
    middlewares: { use: (fn: Middleware) => void middlewares.push(fn) },
    config: { server: { host: "127.0.0.1" } },
    httpServer,
    ws: { send: () => {} },
    ssrLoadModule: async () => fakeStudioServerModule(),
  } as unknown as ViteDevServer;
  const configureServer = devApiPlugin().configureServer as (s: ViteDevServer) => void;
  configureServer(server);
  return middlewares;
}

// Runs the request down the plugin's middlewares the way connect would; `undefined` status means every one passed it on.
function request(middlewares: Middleware[], url: string, host: string): Promise<Reply> {
  return new Promise((resolve) => {
    const reply: Reply = { status: undefined, body: "" };
    const res = Object.assign(new EventEmitter(), {
      headersSent: false,
      writeHead(status: number) {
        reply.status = status;
        res.headersSent = true;
        return res;
      },
      write(chunk: Uint8Array | string) {
        reply.body += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
        return true;
      },
      end(chunk?: string) {
        if (chunk) reply.body += chunk;
        resolve(reply);
      },
    });
    const req = { url, method: "GET", headers: { host } } as IncomingMessage;
    const run = (index: number): void => {
      const middleware = middlewares[index];
      if (!middleware) return resolve(reply);
      void middleware(req, res as unknown as ServerResponse, () => run(index + 1));
    };
    run(0);
  });
}

describe("studio dev server host check", () => {
  it("refuses a foreign Host on the plugin's API and config routes", async () => {
    vi.stubEnv("HYPERFRAMES_PREVIEW_PROJECT_DIR", "/tmp/project");
    vi.stubEnv("HYPERFRAMES_PREVIEW_PROJECT_NAME", "project");
    const middlewares = startPlugin();
    for (const url of ["/api/projects", "/__hyperframes_config", "/api/runtime.js"]) {
      const reply = await request(middlewares, url, "other.example:5190");
      expect(reply.status, url).toBe(403);
      expect(JSON.parse(reply.body).error, url).toContain(`"other.example:5190"`);
      expect(JSON.parse(reply.body).error, url).toContain(ENV);
    }
  });

  it("serves loopback and IP-literal hosts", async () => {
    vi.stubEnv("HYPERFRAMES_PREVIEW_PROJECT_DIR", "/tmp/project");
    vi.stubEnv("HYPERFRAMES_PREVIEW_PROJECT_NAME", "project");
    const middlewares = startPlugin();
    for (const host of ["localhost:5190", "127.0.0.1:5190", "[::1]:5190", "192.168.1.20:5190"]) {
      expect((await request(middlewares, "/api/projects", host)).status, host).toBe(200);
      expect((await request(middlewares, "/__hyperframes_config", host)).status, host).toBe(200);
    }
    expect((await request(middlewares, "/api/projects", "[fe80::1]:5190")).status).toBe(200);
  });

  it(`serves a host listed in ${ENV}`, async () => {
    vi.stubEnv(ENV, "studio.tunnel.example, other.tunnel.example");
    const middlewares = startPlugin();
    expect((await request(middlewares, "/api/projects", "studio.tunnel.example")).status).toBe(200);
    expect((await request(middlewares, "/api/projects", "evil.tunnel.example")).status).toBe(403);
  });

  it("serves the *.localhost and leading-dot hosts Vite serves the page on", async () => {
    vi.stubEnv(ENV, ".tunnel.example");
    const middlewares = startPlugin();
    for (const host of ["studio.localhost:5190", "tunnel.example", "a.b.tunnel.example:443"]) {
      expect((await request(middlewares, "/api/projects", host)).status, host).toBe(200);
    }
    for (const host of ["localhost.evil.example", "eviltunnel.example", "tunnel.example.evil"]) {
      expect((await request(middlewares, "/api/projects", host)).status, host).toBe(403);
    }
  });

  it("leaves routes the plugin does not own to Vite's own host check", async () => {
    const middlewares = startPlugin();
    expect((await request(middlewares, "/", "other.example:5190")).status).toBeUndefined();
  });

  it(`adds ${ENV} hosts to server.allowedHosts so Vite serves the page on them`, async () => {
    vi.stubEnv(ENV, "studio.tunnel.example");
    vi.resetModules();
    const { default: fresh } = await import("./vite.config");
    expect(fresh.server?.allowedHosts).toEqual(["studio.tunnel.example"]);
  });
});
