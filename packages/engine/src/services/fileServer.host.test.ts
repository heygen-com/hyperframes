import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileServer, type FileServerHandle } from "./fileServer.js";

function statusWithHost(port: number, path: string, host: string): Promise<number> {
  return new Promise((resolveStatus, rejectStatus) => {
    const req = request({ hostname: "127.0.0.1", port, path, headers: { host } }, (res) => {
      res.resume();
      res.on("end", () => resolveStatus(res.statusCode ?? 0));
    });
    req.on("error", rejectStatus);
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
    projectDir = mkdtempSync(join(tmpdir(), "hf-engine-file-server-host-"));
    writeFileSync(join(projectDir, "index.html"), "<!doctype html><html><body>page</body></html>");
    writeFileSync(join(projectDir, "style.css"), "body{}");
    writeFileSync(join(projectDir, "worker.js"), "self.onfetch = () => {};");
    server = await createFileServer({ projectDir });
    return server;
  }

  it("refuses the page and its assets when Host names another site", async () => {
    const { port } = await serve();
    for (const path of ["/", "/style.css"]) {
      expect(await statusWithHost(port, path, `rebound.example:${port}`)).toBe(403);
      expect(await statusWithHost(port, path, `127.0.0.1:${port}`)).toBe(200);
    }
  });

  it("answers its own URL and forbids another site from framing the page", async () => {
    const { url } = await serve();
    const response = await fetch(`${url}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBe("frame-ancestors 'self'");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  // fails without the fix: a pooled render browser kept a worker one render registered for later renders.
  it("refuses a project file asked for as a service worker's script, and serves it as a script", async () => {
    const { url } = await serve();
    const get = (headers: Record<string, string>) => fetch(`${url}/worker.js`, { headers });
    expect((await get({ "service-worker": "script" })).status).toBe(403);
    expect((await get({ "sec-fetch-dest": "serviceworker" })).status).toBe(403);
    expect((await get({ "sec-fetch-dest": "script" })).status).toBe(200);
  });
});
