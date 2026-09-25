// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerFileRoutes } from "./files";

const hooks = vi.hoisted(() => ({ transforming: undefined as (() => void) | undefined }));
vi.mock("../helpers/sourceMutation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../helpers/sourceMutation.js")>();
  return {
    ...actual,
    patchElementInHtml: (...args: Parameters<typeof actual.patchElementInHtml>) => {
      hooks.transforming?.();
      return actual.patchElementInHtml(...args);
    },
    removeElementFromHtml: (...args: Parameters<typeof actual.removeElementFromHtml>) => {
      hooks.transforming?.();
      return actual.removeElementFromHtml(...args);
    },
  };
});

const dirs: string[] = [];
afterEach(() => {
  hooks.transforming = undefined;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ORIGINAL = `<h1 id="title">Title</h1><p id="note">old</p>`;
const saved = (n: number | string) => `<h1 id="title">Title</h1><p id="note">agent ${n}</p>`;
const zIndex = [{ type: "inline-style", property: "z-index", value: "2" }];
const ROUTES = {
  "patch-element": ["patch-element/index.html", { target: { id: "title" }, operations: zIndex }],
  "patch-elements-batch": [
    "patch-elements-batch/index.html",
    { patches: [{ target: { id: "title" }, operations: zIndex }] },
  ],
  "patch-element-batches": [
    "patch-element-batches",
    {
      batches: [
        { sourceFile: "index.html", patches: [{ target: { id: "title" }, operations: zIndex }] },
      ],
    },
  ],
} as const;

function project() {
  const dir = mkdtempSync(join(tmpdir(), "hf-patch-race-"));
  dirs.push(dir);
  const path = join(dir, "index.html");
  writeFileSync(path, ORIGINAL);
  const app = new Hono();
  registerFileRoutes(app, {
    listProjects: () => [],
    resolveProject: async (id: string) => ({ id, dir }),
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => "/tmp/renders",
    startRender: () => ({ id: "job", status: "rendering", progress: 0, outputPath: "/tmp/o.mp4" }),
  });
  const post = (route: string, body: unknown) =>
    app.request(`http://localhost/projects/demo/file-mutations/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return { post, path, read: () => readFileSync(path, "utf-8") };
}

describe("element edits with another writer racing them", () => {
  it.each(Object.entries(ROUTES))(
    "%s keeps a write that lands mid-edit and applies the edit on top",
    async (_, [route, body]) => {
      const { post, path, read } = project();
      hooks.transforming = () => {
        hooks.transforming = undefined;
        writeFileSync(path, saved(1));
      };

      expect((await post(route, body)).status).toBe(200);
      expect(read()).toContain("agent 1");
      expect(read()).toContain("z-index: 2");
    },
  );

  it.each(Object.entries(ROUTES))(
    "%s answers 409 after three raced tries and keeps the other write",
    async (_, [route, body]) => {
      const { post, path, read } = project();
      let writes = 0;
      hooks.transforming = () => {
        writes += 1;
        writeFileSync(path, saved(writes));
      };

      const response = await post(route, body);

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ conflict: true });
      expect(writes).toBe(3);
      expect(read()).toBe(saved(writes));
    },
  );

  it("remove-element answers 409 instead of writing over a save that lands mid-edit", async () => {
    const { post, path, read } = project();
    hooks.transforming = () => writeFileSync(path, saved("x"));

    const response = await post("remove-element/index.html", { target: { id: "note" } });

    expect(response.status).toBe(409);
    expect(read()).toBe(saved("x"));
  });
});
