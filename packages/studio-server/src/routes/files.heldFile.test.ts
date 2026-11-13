import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFileRoutes } from "./files";
import type { StudioApiAdapter } from "../types";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function fixture(name: string) {
  const project = mkdtempSync(join(tmpdir(), "hf-held-file-"));
  mkdirSync(join(project, "sub"));
  const file = join(project, name);
  writeFileSync(file, "<div></div>");
  cleanups.push(() => rmSync(project, { recursive: true, force: true }));
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
  const get = (query = "") => app.request(`http://localhost/projects/demo/files/${name}${query}`);
  const put = () =>
    app.request(`http://localhost/projects/demo/files/${name}`, {
      method: "PUT",
      headers: { "If-Match": '"any"' },
      body: "<div>edited</div>",
    });
  return { file, get, put };
}

const answered = async (response: Response) => ({
  status: response.status,
  why: ((await response.json()) as { why?: string }).why,
});

describe.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "a file the process may not open",
  () => {
    // fails without the fix: the read answered 404 "not found" and the save threw a 500, whatever the cause.
    it("answers a read 403 permission, not 404, and a save 403 permission, not 500", async () => {
      const { file, get, put } = fixture("locked.html");
      chmodSync(file, 0o000);
      expect(await answered(await get())).toEqual({ status: 403, why: "permission" });
      expect(await answered(await put())).toEqual({ status: 403, why: "permission" });
    });

    it("does not answer an optional read of it as a blank file", async () => {
      const { file, get } = fixture("locked.html");
      chmodSync(file, 0o000);
      expect(await answered(await get("?optional=1"))).toEqual({ status: 403, why: "permission" });
    });
  },
);

/** Holds `file` open with no sharing, as an antivirus scan or a sync client does, until the cleanup runs. */
async function holdOpen(file: string) {
  const holder: ChildProcess = spawn("powershell", [
    "-NoProfile",
    "-Command",
    `$f=[IO.File]::Open('${file}','Open','ReadWrite','None'); 'held'; Start-Sleep 120`,
  ]);
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        holder.once("exit", () => resolve());
        holder.kill();
      }),
  );
  await new Promise((resolve) => holder.stdout?.once("data", resolve));
}

describe.runIf(process.platform === "win32")("a file another program holds open on Windows", () => {
  // fails without the fix: both answers were 404 "not found" (read) and 500 (save) for a file that exists.
  it("answers a read and a save 423 busy after waiting it out", async () => {
    const { file, get, put } = fixture("held.html");
    await holdOpen(file);
    expect(await answered(await get())).toEqual({ status: 423, why: "busy" });
    expect(await answered(await put())).toEqual({ status: 423, why: "busy" });
  }, 30_000);

  it("does not answer an optional read of it as a blank file", async () => {
    const { file, get } = fixture("held.html");
    await holdOpen(file);
    expect(await answered(await get("?optional=1"))).toEqual({ status: 423, why: "busy" });
  }, 30_000);

  it("answers a save of a read-only file 403 permission and still reads it", async () => {
    const { file, get, put } = fixture("readonly.html");
    spawnSync("attrib", ["+R", file]);
    cleanups.push(() => spawnSync("attrib", ["-R", file]));
    expect((await get()).status).toBe(200);
    expect(await answered(await put())).toEqual({ status: 403, why: "permission" });
  });
});
