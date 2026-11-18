import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveStaticProjectHtml, type StaticProjectServer } from "./staticProjectServer.js";

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function getWithHost(port: number, path: string, host: string): Promise<Answer> {
  return new Promise((resolveAnswer, rejectAnswer) => {
    const headers = { host, "sec-fetch-site": "same-origin" };
    const req = request({ hostname: "127.0.0.1", port, path, headers }, (res) => {
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

describe("serveStaticProjectHtml Host and framing", () => {
  let projectDir: string;
  let server: StaticProjectServer;

  afterEach(async () => {
    await server?.close();
    rmSync(projectDir, { recursive: true, force: true });
  });

  async function serve(): Promise<StaticProjectServer> {
    projectDir = mkdtempSync(join(tmpdir(), "hf-static-host-"));
    writeFileSync(join(projectDir, "style.css"), "body{}");
    server = await serveStaticProjectHtml(projectDir, "<html><body>page</body></html>");
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
    const page = await getWithHost(port, "/", `${name}:${port}`);
    expect(page.status).toBe(200);
    expect(page.body).toContain("page");
    const asset = await getWithHost(port, "/style.css", `${name}:${port}`);
    expect(asset.status).toBe(200);
    expect(asset.body).toBe("body{}");
  });

  it("forbids another site from framing the page", async () => {
    const { port } = await serve();
    const page = await getWithHost(port, "/", `127.0.0.1:${port}`);
    expect(page.headers["content-security-policy"]).toBe("frame-ancestors 'self'");
    expect(page.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });

  it("refuses a project file asked for as a service worker's script, and serves it as a script", async () => {
    const { port } = await serve();
    writeFileSync(join(projectDir, "worker.js"), "self.onfetch = () => {};");
    const ask = (dest: string, worker?: string) =>
      new Promise<number>((done, fail) => {
        const headers = {
          host: `127.0.0.1:${port}`,
          "sec-fetch-site": "same-origin",
          "sec-fetch-dest": dest,
          ...(worker && { "service-worker": worker }),
        };
        const req = request({ hostname: "127.0.0.1", port, path: "/worker.js", headers }, (res) => {
          res.resume();
          done(res.statusCode ?? 0);
        });
        req.on("error", fail);
        req.end();
      });
    expect(await ask("serviceworker", "script")).toBe(403);
    expect(await ask("serviceworker")).toBe(403);
    expect(await ask("script")).toBe(200);
  });
});
