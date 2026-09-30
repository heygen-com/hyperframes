// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { registerFileRoutes } from "./files";
import type { StudioApiAdapter } from "../types";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    openSync: vi.fn(actual.openSync),
    writeFileSync: vi.fn(actual.writeFileSync),
  };
});

let project: string;
beforeEach(() => {
  project = fs.mkdtempSync(join(tmpdir(), "hf-atomic-create-"));
  fs.writeFileSync(join(project, "index.html"), "<html>index</html>");
  vi.clearAllMocks();
});
afterEach(() => fs.rmSync(project, { recursive: true, force: true }));

function app(): Hono {
  const api = new Hono();
  registerFileRoutes(api, {
    resolveProject: async (id: string) => ({ id, dir: project }),
  } as unknown as StudioApiAdapter);
  return api;
}

// A write opened on the destination itself exposes an empty file until it finishes.
function writesOpenedOn(name: string): unknown[][] {
  const dests = [join(project, name), join(fs.realpathSync(project), name)];
  const onDest = ([path]: unknown[]) => dests.includes(String(path));
  return [
    ...vi.mocked(fs.writeFileSync).mock.calls.filter(onDest),
    ...vi.mocked(fs.openSync).mock.calls.filter((call) => onDest(call) && call[1] !== "r"),
  ];
}

it.each([
  [
    "create",
    "new.html",
    () =>
      app().request("http://localhost/projects/demo/files/new.html", {
        method: "POST",
        body: "<html>new</html>",
      }),
    "<html>new</html>",
  ],
  [
    "create-only save",
    "saved.html",
    () =>
      app().request("http://localhost/projects/demo/files/saved.html", {
        method: "PUT",
        headers: { "If-None-Match": "*" },
        body: "<html>saved</html>",
      }),
    "<html>saved</html>",
  ],
  [
    "duplicate",
    "index (copy).html",
    () =>
      app().request("http://localhost/projects/demo/duplicate-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "index.html" }),
      }),
    "<html>index</html>",
  ],
  [
    "upload",
    "clip.txt",
    () => {
      const form = new FormData();
      form.append("files", new File(["upload bytes"], "clip.txt"));
      return app().request("http://localhost/projects/demo/upload", { method: "POST", body: form });
    },
    "upload bytes",
  ],
])("%s publishes the file only once it is complete", async (_route, name, send, content) => {
  const response = await send();

  expect(response.status).toBeLessThan(300);
  expect(fs.readFileSync(join(project, name), "utf-8")).toBe(content);
  expect(writesOpenedOn(name)).toEqual([]);
  expect(fs.readdirSync(project).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
});
