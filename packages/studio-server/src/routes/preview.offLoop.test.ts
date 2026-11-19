// @vitest-environment node
// A host runs these routes on its own event loop: a synchronous read of a folder whose drive stopped answering holds
// that loop, and with it every other request, for as long as the drive stays silent.
import { afterEach, expect, it, vi } from "vitest";
import fs, { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { registerPreviewRoutes } from "./preview";
import type { StudioApiAdapter } from "../types";

const SYNC = [
  "existsSync",
  "statSync",
  "lstatSync",
  "realpathSync",
  "readFileSync",
  "readdirSync",
  "accessSync",
  "openSync",
] as const;

let projectDir = "";
const wake: (() => void)[] = [];

afterEach(() => {
  for (const one of wake.splice(0)) one();
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  rmSync(projectDir, { recursive: true, force: true });
});

const adapter = (dir: string): StudioApiAdapter => ({
  listProjects: () => [],
  resolveProject: async (id: string) => ({ id, dir }),
  bundle: async () => null,
  lint: async () => ({ findings: [] }),
  runtimeUrl: "/api/runtime.js",
  rendersDir: () => "/tmp/renders",
  startRender: () => ({
    id: "job-1",
    status: "rendering",
    progress: 0,
    outputPath: "/tmp/out.mp4",
  }),
});

// fails without the fix: the private-file check resolved the project's real path, and the file's stat ran, on the
// event loop.
it("a preview file request whose project's drive stops answering asks that drive nothing on the event loop", async () => {
  projectDir = realpathSync(mkdtempSync(join(tmpdir(), "hf-preview-asleep-")));
  writeFileSync(join(projectDir, "notes.txt"), "hello");
  const onDrive = (path: unknown) => String(path).startsWith(projectDir);
  let asleep = false;
  const sync: string[] = [];
  const record = (name: string, path: unknown) => {
    if (asleep && onDrive(path)) sync.push(`${name} ${String(path)}`);
  };
  for (const name of SYNC) {
    const real = fs[name] as (...args: unknown[]) => unknown;
    vi.spyOn(fs, name).mockImplementation(((path: unknown, ...rest: unknown[]) => {
      record(name, path);
      return real(path, ...rest);
    }) as never);
  }
  const native = fs.realpathSync.native;
  vi.spyOn(fs.realpathSync, "native").mockImplementation(((path: unknown, ...rest: unknown[]) => {
    record("realpathSync.native", path);
    return (native as (...args: unknown[]) => unknown)(path, ...rest);
  }) as never);
  for (const name of ["stat", "lstat", "realpath", "readFile"] as const) {
    const real = fs.promises[name] as (...args: unknown[]) => Promise<unknown>;
    vi.spyOn(fs.promises, name).mockImplementation(((path: unknown, ...rest: unknown[]) =>
      asleep && onDrive(path)
        ? new Promise((done) => wake.push(() => done(real(path, ...rest))))
        : real(path, ...rest)) as never);
  }
  syncBuiltinESMExports();
  const app = new Hono();
  registerPreviewRoutes(app, adapter(projectDir));

  asleep = true;
  let answered = false;
  const pending = app.request("http://localhost/projects/demo/preview/notes.txt").then((res) => {
    answered = true;
    return res;
  });
  for (let turn = 0; turn < 5; turn++) await new Promise((next) => setImmediate(next));
  expect(sync).toEqual([]);
  expect(answered).toBe(false);

  asleep = false;
  for (const one of wake.splice(0)) one();
  const res = await pending;
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("hello");
});
