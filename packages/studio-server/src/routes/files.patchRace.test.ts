// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StudioApiAdapter } from "../types";
import { registerFileRoutes } from "./files";

const hooks = vi.hoisted(() => ({ folding: undefined as (() => void) | undefined }));
vi.mock("../helpers/sourceMutation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../helpers/sourceMutation.js")>();
  return {
    ...actual,
    patchElementInHtml: (...args: Parameters<typeof actual.patchElementInHtml>) => {
      hooks.folding?.();
      return actual.patchElementInHtml(...args);
    },
  };
});

const dirs: string[] = [];
afterEach(() => {
  hooks.folding = undefined;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function projectWith(html: string) {
  const dir = mkdtempSync(join(tmpdir(), "hf-patch-race-"));
  dirs.push(dir);
  writeFileSync(join(dir, "index.html"), html);
  const app = new Hono();
  registerFileRoutes(app, {
    listProjects: () => [],
    resolveProject: async (id: string) => ({ id, dir }),
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => "/tmp/renders",
    startRender: () => ({ id: "job", status: "rendering", progress: 0, outputPath: "/tmp/o.mp4" }),
  } as StudioApiAdapter);
  const patch = () =>
    app.request("http://localhost/projects/demo/file-mutations/patch-elements-batch/index.html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patches: [
          {
            target: { id: "title" },
            operations: [{ type: "inline-style", property: "z-index", value: "2" }],
          },
        ],
      }),
    });
  return {
    patch,
    read: () => readFileSync(join(dir, "index.html"), "utf-8"),
    path: join(dir, "index.html"),
  };
}

describe("element patch route with a writer racing it", () => {
  it("keeps a write that lands while the patch is folded and applies the patch on top", async () => {
    const { patch, read, path } = projectWith(`<h1 id="title">Title</h1><p id="note">old</p>`);
    hooks.folding = () => {
      hooks.folding = undefined;
      writeFileSync(path, `<h1 id="title">Title</h1><p id="note">agent</p>`);
    };

    const response = await patch();

    expect(response.status).toBe(200);
    expect(read()).toContain("agent");
    expect(read()).toContain("z-index: 2");
  });

  it("answers 409 and keeps the other write when every attempt is raced", async () => {
    const { patch, read, path } = projectWith(`<h1 id="title">Title</h1><p id="note">old</p>`);
    let writes = 0;
    hooks.folding = () => {
      writes += 1;
      writeFileSync(path, `<h1 id="title">Title</h1><p id="note">agent ${writes}</p>`);
    };

    const response = await patch();

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ conflict: true, sourceFile: "index.html" });
    expect(read()).toBe(`<h1 id="title">Title</h1><p id="note">agent ${writes}</p>`);
  });
});
