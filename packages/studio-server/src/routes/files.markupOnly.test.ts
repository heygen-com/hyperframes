import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFileRoutes } from "./files";
import { fileContentVersion } from "../helpers/fileVersion";
import type { StudioApiAdapter } from "../types";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// A page any of these edits would act on: one clip with an id, and a timeline script.
const PAGE = `<!doctype html><html><body><div data-composition-id="main" data-width="640" data-height="360" data-duration="4"><div id="a" class="clip" data-start="0" data-duration="4" data-track-index="0">text</div></div><script>const tl = gsap.timeline({ paused: true });</script></body></html>`;

function fixture(files: string[]) {
  const project = mkdtempSync(join(tmpdir(), "hf-markup-only-"));
  tempDirs.push(project);
  for (const file of files) writeFileSync(join(project, file), PAGE);
  const adapter: StudioApiAdapter = {
    listProjects: () => [],
    resolveProject: async (id) => ({ id, dir: project }),
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => join(project, "renders"),
    startRender: () => ({ id: "job", status: "rendering", progress: 0, outputPath: "out.mp4" }),
  };
  const app = new Hono();
  registerFileRoutes(app, adapter);
  const post = (path: string, body: unknown) =>
    app.request(`http://localhost/projects/demo/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return { project, post };
}

const target = { id: "a" };
const cut = { target, splitTime: 2, elementStart: 0, elementDuration: 4 };
const setText = { target, operations: [{ type: "text-content", value: "changed" }] };

/** Every route that edits an element or an animation in a file the caller names, with a body it accepts. */
const editsNamedInPath: Array<[route: string, body: unknown]> = [
  ["file-mutations/insert-composition", { src: "child.html", expectedVersion: "" }],
  ["file-mutations/remove-element", { target }],
  ["file-mutations/remove-elements", { targets: [target] }],
  ["file-mutations/split-element", { ...cut, newId: "b" }],
  ["file-mutations/patch-element", setText],
  ["file-mutations/patch-elements-batch", { patches: [setText] }],
  ["file-mutations/wrap-elements", { targets: [target], groupId: "g" }],
  ["file-mutations/unwrap-elements", { target }],
  ["file-mutations/probe-element", { target }],
  ["file-mutations/probe-elements", { targets: [target] }],
  ["gsap-mutations", { type: "add", selector: "#a", method: "to", position: 0, vars: { x: 1 } }],
  ["gsap-mutations-batch", { mutations: [] }],
  ["gsap-mutation-rollback", { expected: PAGE, restore: "restored" }],
];

describe("element and animation edits take an HTML file only", () => {
  it.each(editsNamedInPath)("%s refuses a file that is not HTML", async (route, body) => {
    const { project, post } = fixture(["notes.md"]);
    const response = await post(`${route}/notes.md`, body);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden", why: "not_html" });
    expect(readFileSync(join(project, "notes.md"), "utf-8")).toBe(PAGE);
  });

  it("patch-element-batches refuses a batch whose file is not HTML and writes none of them", async () => {
    const { project, post } = fixture(["index.html", "theme.css"]);
    const response = await post("file-mutations/patch-element-batches", {
      batches: [
        { sourceFile: "index.html", patches: [setText] },
        { sourceFile: "theme.css", patches: [setText] },
      ],
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden", sourceFile: "theme.css" });
    expect(readFileSync(join(project, "index.html"), "utf-8")).toBe(PAGE);
    expect(readFileSync(join(project, "theme.css"), "utf-8")).toBe(PAGE);
  });

  it("split-batch refuses a file that is not HTML and writes none of them", async () => {
    const { project, post } = fixture(["index.html", "data.json"]);
    const expectedVersion = fileContentVersion(PAGE);
    const response = await post("file-mutations/split-batch", {
      transactionToken: "cut",
      files: [
        { path: "index.html", expectedVersion, targets: [cut] },
        { path: "data.json", expectedVersion, targets: [cut] },
      ],
    });
    expect(response.status).toBe(403);
    expect(readFileSync(join(project, "index.html"), "utf-8")).toBe(PAGE);
    expect(readFileSync(join(project, "data.json"), "utf-8")).toBe(PAGE);
  });

  it.each(["index.html", "Title.HTML", "scene.htm"])("still edits %s", async (file) => {
    const { project, post } = fixture([file]);
    const response = await post(`file-mutations/remove-element/${file}`, { target });
    expect(response.status).toBe(200);
    expect(readFileSync(join(project, file), "utf-8")).not.toContain('id="a"');
  });
});
