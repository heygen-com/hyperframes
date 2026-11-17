// @vitest-environment node
// Node environment: happy-dom's fetch drops the Origin and Sec-Fetch-Site headers these refusals turn on.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioApi } from "./createStudioApi";
import { stubAdapter } from "./routes/stubAdapter.test-helpers";
import type { StudioRefusal } from "./types";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createApp() {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-refusals-"));
  tempDirs.push(projectDir);
  writeFileSync(join(projectDir, "index.html"), "<html></html>");
  const heard: StudioRefusal[] = [];
  const app = createStudioApi({ ...stubAdapter(projectDir), onRefusal: (r) => heard.push(r) });
  return { app, heard };
}

const write = (
  app: ReturnType<typeof createStudioApi>,
  name: string,
  headers: Record<string, string>,
) =>
  app.request(`http://localhost/projects/demo/files/${name}`, {
    method: "POST",
    headers: { Host: "localhost", "Content-Type": "text/plain", ...headers },
    body: "<html>planted</html>",
  });

describe("createStudioApi refusal reports", () => {
  it("names a cross-origin write by its route and reason, never the file it named", async () => {
    const { app, heard } = createApp();
    const res = await write(app, "planted-secret.html", { Origin: "http://evil.example:9999" });
    expect(res.status).toBe(403);
    expect(heard).toHaveLength(1);
    expect(heard[0]?.why).toBe("cross_origin_write");
    expect(heard.map((r) => r.route)).toEqual(["/projects/:id/files/*"]);
    expect(Object.keys(heard[0] ?? {}).sort()).toEqual(["route", "why"]);
    expect(JSON.stringify(heard)).not.toMatch(/planted|evil/);
  });

  it("counts a refusal through a frame-token preview path once, not once per pass through the API", async () => {
    const { app, heard } = createApp();
    const minted = await app.request("http://localhost/projects/demo/frame-token", {
      headers: { Host: "localhost", "sec-fetch-site": "same-origin" },
    });
    const { token } = (await minted.json()) as { token: string };
    const res = await app.request(`http://localhost/projects/demo/preview/~${token}/index.html`, {
      method: "POST",
      headers: { Host: "localhost", Origin: "null", "Content-Type": "text/plain" },
      body: "<html>planted</html>",
    });
    expect(res.status).toBe(403);
    expect(heard).toHaveLength(1);
    expect(heard[0]?.why).toBe("cross_origin_write");
  });

  it("carries the file routes' own why code for a protected path", async () => {
    const { app, heard } = createApp();
    const res = await write(app, "node_modules/x.js", { Origin: "http://localhost" });
    expect(res.status).toBe(403);
    expect(heard.map((r) => r.why)).toEqual(["protected_path"]);
    expect(heard.map((r) => r.route)).toEqual(["/projects/:id/files/*"]);
  });

  it("reports a read another site asked for", async () => {
    const { app, heard } = createApp();
    const res = await app.request("http://localhost/projects/demo/lint", {
      headers: { Host: "localhost", "Sec-Fetch-Site": "cross-site" },
    });
    expect(res.status).toBe(403);
    expect(heard.map((r) => r.why)).toEqual(["another_site"]);
    expect(heard.map((r) => r.route)).toEqual(["/projects/:id/lint"]);
  });

  it("hears nothing for an allowed request", async () => {
    const { app, heard } = createApp();
    expect((await write(app, "ok.html", { Origin: "http://localhost" })).status).toBe(201);
    expect(heard).toEqual([]);
  });

  it("a host counter that throws does not change the answer", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-refusals-"));
    tempDirs.push(projectDir);
    const app = createStudioApi({
      ...stubAdapter(projectDir),
      onRefusal: () => {
        throw new Error("counter down");
      },
    });
    expect((await write(app, "x.html", { Origin: "http://evil.example" })).status).toBe(403);
  });
});
