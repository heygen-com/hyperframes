import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerRenderRoutes } from "./render";
import type { StudioApiAdapter } from "../types";

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-render-variables-"));
  folders.push(dir);
  return dir;
}

function appFor(projectDir: string): Hono {
  const adapter: StudioApiAdapter = {
    listProjects: () => [],
    resolveProject: async (id: string) => ({ id, dir: projectDir }),
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => join(projectDir, "renders"),
    startRender: () => {
      throw new Error("not used");
    },
  };
  const app = new Hono();
  registerRenderRoutes(app, adapter);
  return app;
}

const put = (app: Hono, body: string) =>
  app.request("http://localhost/projects/demo/render-variables", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body,
  });

describe("PUT /projects/:id/render-variables", () => {
  it("writes the values to .hyperframes/render-variables.json", async () => {
    const project = folder();
    const values = { title: `x'; calc.exe; '" & calc | $(id)`, count: 3 };

    const response = await put(appFor(project), JSON.stringify(values));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ path: ".hyperframes/render-variables.json" });
    const written = readFileSync(join(project, ".hyperframes/render-variables.json"), "utf8");
    expect(JSON.parse(written)).toEqual(values);
  });

  it.each(["[1,2]", '"text"', "null", "{not json"])(
    "refuses %s, which is not an object",
    async (body) => {
      const project = folder();

      const response = await put(appFor(project), body);

      expect(response.status).toBe(400);
      expect(existsSync(join(project, ".hyperframes/render-variables.json"))).toBe(false);
    },
  );

  it("does not write through a .hyperframes link that leaves the project", async () => {
    const project = folder();
    const elsewhere = folder();
    symlinkSync(elsewhere, join(project, ".hyperframes"), "dir");

    const response = await put(appFor(project), JSON.stringify({ title: "x" }));

    expect(response.status).toBe(403);
    expect(existsSync(join(elsewhere, "render-variables.json"))).toBe(false);
  });

  it("does not write through a .hyperframes link to a folder in the project", async () => {
    const project = folder();
    mkdirSync(join(project, "scripts"));
    symlinkSync(join(project, "scripts"), join(project, ".hyperframes"), "dir");

    const response = await put(appFor(project), JSON.stringify({ title: "x" }));

    expect(response.status).toBe(403);
    expect(existsSync(join(project, "scripts/render-variables.json"))).toBe(false);
  });

  it("replaces a file link planted in its place instead of writing to package.json", async () => {
    const project = folder();
    const manifest = '{"name":"demo"}\n';
    writeFileSync(join(project, "package.json"), manifest);
    mkdirSync(join(project, ".hyperframes"));
    const record = join(project, ".hyperframes/render-variables.json");
    symlinkSync(join(project, "package.json"), record, "file");
    const values = { scripts: { postinstall: "calc.exe" } };

    const response = await put(appFor(project), JSON.stringify(values));

    expect(response.status).toBe(200);
    expect(readFileSync(join(project, "package.json"), "utf8")).toBe(manifest);
    const fd = openSync(record, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      expect(JSON.parse(readFileSync(fd, "utf8"))).toEqual(values);
    } finally {
      closeSync(fd);
    }
  });
});
