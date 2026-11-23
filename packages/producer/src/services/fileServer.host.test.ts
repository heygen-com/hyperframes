import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileServer, type FileServerHandle } from "./fileServer.js";

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function getWithHost(port: number, path: string, host: string): Promise<Answer> {
  return new Promise((resolveAnswer, rejectAnswer) => {
    const req = request({ hostname: "127.0.0.1", port, path, headers: { host } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () =>
        resolveAnswer({ status: res.statusCode ?? 0, headers: res.headers, body }),
      );
    });
    req.on("error", rejectAnswer);
    req.end();
  });
}

describe("createFileServer Host and framing", () => {
  let projectDir: string;
  let server: FileServerHandle | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
    rmSync(projectDir, { recursive: true, force: true });
  });

  async function serve(): Promise<FileServerHandle> {
    projectDir = mkdtempSync(join(tmpdir(), "hf-file-server-host-"));
    writeFileSync(join(projectDir, "index.html"), "<!doctype html><html><body>page</body></html>");
    writeFileSync(join(projectDir, "style.css"), "body{}");
    server = await createFileServer({ projectDir, preHeadScripts: [], headScripts: [] });
    return server;
  }

  it.each(["/", "/index.html", "/style.css"])(
    "refuses %s when Host names another site",
    async (path) => {
      const { port } = await serve();
      for (const host of [`rebound.example:${port}`, "rebound.example", `localhost:${port + 1}`]) {
        const answer = await getWithHost(port, path, host);
        expect(answer.status).toBe(403);
        expect(answer.body).not.toContain("page");
        expect(answer.body).not.toContain("body{}");
      }
    },
  );

  it.each(["127.0.0.1", "localhost", "[::1]"])("answers its own port on %s", async (name) => {
    const { port } = await serve();
    const page = await getWithHost(port, "/index.html", `${name}:${port}`);
    expect(page.status).toBe(200);
    expect(page.body).toContain("page");
    const asset = await getWithHost(port, "/style.css", `${name}:${port}`);
    expect(asset.status).toBe(200);
    expect(asset.body).toBe("body{}");
  });

  // fails without the fix: a pooled render browser kept a worker one render registered for later renders.
  it("refuses a project file asked for as a service worker's script, and serves it as a script", async () => {
    const { url } = await serve();
    const get = (headers: Record<string, string>) => fetch(`${url}/style.css`, { headers });
    expect((await get({ "service-worker": "script" })).status).toBe(403);
    expect((await get({ "sec-fetch-dest": "serviceworker" })).status).toBe(403);
    expect((await get({ "sec-fetch-dest": "style" })).status).toBe(200);
  });

  it("answers the URL it hands the capture browser", async () => {
    const { url } = await serve();
    const response = await fetch(`${url}/index.html`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("page");
  });

  it("forbids another site from framing the page", async () => {
    const { url } = await serve();
    const response = await fetch(`${url}/`);
    expect(response.headers.get("content-security-policy")).toBe("frame-ancestors 'self'");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });
});
