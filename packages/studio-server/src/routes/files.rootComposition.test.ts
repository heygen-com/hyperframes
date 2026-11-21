// @vitest-environment node
import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { registerFileRoutes } from "./files";
import { fileContentVersion } from "../helpers/fileVersion";
import type { StudioApiAdapter } from "../types";

const INDEX = `<!doctype html><html><body>
<div id="root" data-composition-id="main" data-width="1920" data-height="1080">
  <div id="title" class="clip" data-start="0" data-duration="3" data-track-index="0">Field notes</div>
  <div id="broll-host" data-composition-id="broll" data-composition-src="compositions/broll.html"
    data-start="2" data-duration="4" data-track-index="1"></div>
</div>
</body></html>`;
const BROLL = `<template id="broll-template"><div data-composition-id="broll" data-duration="4">
  <div class="caption"><div class="label">B-roll</div></div>
</div></template>`;

let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "hf-root-composition-"));
  mkdirSync(join(project, "compositions"));
  writeFileSync(join(project, "index.html"), INDEX);
  writeFileSync(join(project, "compositions/broll.html"), BROLL);
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

function app(): Hono {
  const api = new Hono();
  registerFileRoutes(api, {
    resolveProject: async (id: string) => ({ id, dir: project }),
  } as unknown as StudioApiAdapter);
  return api;
}

const read = (file: string) => readFileSync(join(project, file), "utf-8");

function removeElements(file: string, targets: unknown[]): Promise<Response> {
  return app().request(
    `http://localhost/projects/demo/file-mutations/remove-elements/${encodeURIComponent(file)}`,
    { method: "POST", body: JSON.stringify({ targets }) },
  );
}

it("deleting a nested sub-scene child removes only that child", async () => {
  const res = await removeElements("compositions/broll.html", [{ selector: ".label" }]);
  expect(res.status).toBe(200);
  expect(read("compositions/broll.html")).not.toContain("B-roll</div>");
  expect(read("compositions/broll.html")).toContain('data-composition-id="broll"');
  expect(read("index.html")).toBe(INDEX);
});

it("refuses a delete that would remove the root composition and leaves the file untouched", async () => {
  const res = await removeElements("index.html", [{ id: "root", selector: "#root" }]);
  expect(res.status).toBe(422);
  expect(((await res.json()) as { error: string }).error).toMatch(/remove its root composition/);
  expect(read("index.html")).toBe(INDEX);
});

it("refuses a delete of a sub-scene file's own root, inside its template", async () => {
  const res = await removeElements("compositions/broll.html", [
    { selector: '[data-composition-id="broll"]' },
  ]);
  expect(res.status).toBe(422);
  expect(read("compositions/broll.html")).toBe(BROLL);
});

it("refuses a save whose body drops the root composition and leaves the file untouched", async () => {
  const res = await app().request("http://localhost/projects/demo/files/index.html", {
    method: "PUT",
    headers: { "If-Match": fileContentVersion(Buffer.from(INDEX)) },
    body: "<!doctype html><html><body></body></html>",
  });
  expect(res.status).toBe(422);
  expect(read("index.html")).toBe(INDEX);
});

it("still deletes a sub-scene host, which leaves the root composition in place", async () => {
  const res = await removeElements("index.html", [{ id: "broll-host", selector: "#broll-host" }]);
  expect(res.status).toBe(200);
  expect(read("index.html")).not.toContain("broll-host");
  expect(read("index.html")).toContain('data-composition-id="main"');
});

it("still saves a root composition renamed in the code editor", async () => {
  const renamed = INDEX.replace('data-composition-id="main"', 'data-composition-id="intro"');
  const res = await app().request("http://localhost/projects/demo/files/index.html", {
    method: "PUT",
    headers: { "If-Match": fileContentVersion(Buffer.from(INDEX)) },
    body: renamed,
  });
  expect(res.status).toBe(200);
  expect(read("index.html")).toBe(renamed);
});

it("never refuses a non-HTML file that only mentions a composition", async () => {
  const notes = 'Mount with `<div data-composition-id="main">`.';
  writeFileSync(join(project, "notes.md"), notes);
  const res = await app().request("http://localhost/projects/demo/files/notes.md", {
    method: "PUT",
    headers: { "If-Match": fileContentVersion(Buffer.from(notes)) },
    body: "Mount it by hand.",
  });
  expect(res.status).toBe(200);
});

it("refuses an element patch that strips the last composition, with a 422 not a 500", async () => {
  const res = await app().request(
    `http://localhost/projects/demo/file-mutations/patch-elements-batch/${encodeURIComponent("compositions/broll.html")}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patches: [
          {
            target: { selector: '[data-composition-id="broll"]' },
            operations: [{ type: "html-attribute", property: "data-composition-id", value: null }],
          },
        ],
      }),
    },
  );
  expect(res.status).toBe(422);
  expect(((await res.json()) as { error: string }).error).toMatch(/remove its root composition/);
  expect(read("compositions/broll.html")).toBe(BROLL);
});
