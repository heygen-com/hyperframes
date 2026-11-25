// @vitest-environment node
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const fsUrl = (path: string) => `/@fs/${path.replace(/\\/g, "/").replace(/^\/+/, "")}`;

const SECRET = "registry-token-for-test";
const project = realpathSync(mkdtempSync(join(tmpdir(), "hf-linked-project-")));
const link = resolve(__dirname, "data", "projects", `linked-${process.pid}`);
const studioDotfile = resolve(__dirname, `.hf-dev-secret-${process.pid}`);
let server: ViteDevServer;
let origin = "";

beforeAll(async () => {
  writeFileSync(join(project, ".npmrc"), SECRET);
  writeFileSync(studioDotfile, SECRET);
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(project, link);
  server = await createServer({
    configFile: resolve(__dirname, "vite.config.ts"),
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false },
    // Dependency discovery would hold the first module request on a cold server; file serving does not need it.
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("dev server has no port");
  origin = `http://127.0.0.1:${address.port}`;
  await server.warmupRequest("/src/main.tsx");
}, 60_000);

afterAll(async () => {
  rmSync(link, { force: true });
  rmSync(studioDotfile, { force: true });
  rmSync(project, { recursive: true, force: true });
  await server?.close();
}, 30_000);

// fails without the fix: the dev server's own file serving answered for linked projects and checkout files.
describe("the dev Studio's file serving", { timeout: 30_000 }, () => {
  it("serves no byte of a linked project's or the checkout's private file", async () => {
    const name = link.split(/[\\/]/).pop();
    const dotfile = studioDotfile.split(/[\\/]/).pop();
    for (const path of [
      `/data/projects/${name}/.npmrc`,
      `/data/projects/${name}/.npmrc?raw`,
      `/data/projects/${name}/.npmrc?import&raw`,
      `/data/projects/${name}/.npmrc?url`,
      `/data/projects/${name}/.npmrc?inline`,
      fsUrl(`${project}/.npmrc?raw`),
      `/${dotfile}`,
      `/${dotfile}?raw`,
      fsUrl(`${studioDotfile}?raw`),
    ]) {
      const response = await fetch(`${origin}${path}`);
      expect(await response.text(), path).not.toContain(SECRET);
    }
  });

  it("still serves Studio's own modules", async () => {
    for (const path of ["/src/main.tsx", "/@vite/client"])
      expect((await fetch(`${origin}${path}`)).status, path).toBe(200);
  });

  it("answers with the CLI Studio's framing rule, so another site cannot frame it", async () => {
    for (const path of ["/", "/src/main.tsx"]) {
      const response = await fetch(`${origin}${path}`);
      expect(response.headers.get("content-security-policy"), path).toBe("frame-ancestors 'self'");
      expect(response.headers.get("x-frame-options"), path).toBe("SAMEORIGIN");
    }
  });

  it("lets no other loopback origin read what it serves", async () => {
    const response = await fetch(`${origin}/src/main.tsx`, {
      headers: { Origin: "http://127.0.0.1:4444" },
    });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});
