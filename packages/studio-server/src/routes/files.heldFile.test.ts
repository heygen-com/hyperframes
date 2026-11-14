import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

import * as fs from "node:fs";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFileRoutes } from "./files";
import { fileContentVersion } from "../helpers/fileVersion";
import type { StudioApiAdapter } from "../types";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function fixture(name: string, onError?: (error: Error) => void) {
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
  if (onError)
    app.onError((error, c) => {
      onError(error);
      return c.json({ error: "failed" }, 500);
    });
  registerFileRoutes(app, adapter);
  const get = (query = "") => app.request(`http://localhost/projects/demo/files/${name}${query}`);
  const put = () =>
    app.request(`http://localhost/projects/demo/files/${name}`, {
      method: "PUT",
      headers: { "If-Match": '"any"' },
      body: "<div>edited</div>",
    });
  const remove = (id: string) =>
    app.request(`http://localhost/projects/demo/file-mutations/remove-elements/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targets: [{ id }] }),
    });
  const patch = (color: string) =>
    app.request(`http://localhost/projects/demo/file-mutations/patch-element/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: { id: "title" },
        operations: [{ type: "inline-style", property: "color", value: color }],
      }),
    });
  const cut = (version: string) =>
    app.request("http://localhost/projects/demo/file-mutations/split-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactionToken: "cut",
        files: [
          {
            path: name,
            expectedVersion: version,
            targets: [{ target: { id: "a" }, splitTime: 2, elementStart: 0, elementDuration: 4 }],
          },
        ],
      }),
    });
  return { file, get, put, remove, patch, cut };
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

    // fails without the fix: the edit replaced the read-only file (a rename ignores its mode) and answered 200.
    it("leaves a read-only file as it is when an element is removed, and answers 403", async () => {
      const { file, remove } = fixture("readonly.html");
      writeFileSync(file, '<div id="keep">kept</div><p id="gone">tag</p>');
      chmodSync(file, 0o444);
      cleanups.push(() => chmodSync(file, 0o644));
      expect(await answered(await remove("gone"))).toEqual({ status: 403, why: "permission" });
      expect(readFileSync(file, "utf8")).toBe('<div id="keep">kept</div><p id="gone">tag</p>');
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

/** Windows refusing every replace of `file` (EBUSY, as a scanner's open handle does) for `ms`. */
function holdFor(file: string, ms: number) {
  const platform = process.platform;
  const realRenameSync = vi.mocked(fs.renameSync).getMockImplementation()!;
  const releaseAt = Date.now() + ms;
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  vi.mocked(fs.renameSync).mockImplementation((from, to) => {
    if (to === file && Date.now() < releaseAt) {
      throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
    }
    return realRenameSync(from, to);
  });
  cleanups.push(() => {
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
    vi.mocked(fs.renameSync).mockImplementation(realRenameSync);
  });
}

/** The longest the event loop went without running a 5 ms timer while `work` ran. */
async function longestStall(work: () => Promise<unknown>) {
  let last = performance.now();
  let longest = 0;
  const tick = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 5);
  try {
    await work();
  } finally {
    clearInterval(tick);
  }
  return longest;
}

describe("an element edit while Windows briefly holds the file", () => {
  const edited = '<div id="keep">kept</div>';

  it.each([200, 3_000])(
    "still saves the edit when the hold clears after %i ms, and reports nothing",
    async (ms) => {
      const reported: unknown[] = [];
      const { file, remove } = fixture("held.html", (error) => reported.push(error));
      writeFileSync(file, `${edited}<p id="gone">tag</p>`);
      holdFor(file, ms);
      expect((await remove("gone")).status).toBe(200);
      expect(readFileSync(file, "utf8")).not.toContain("tag");
      expect(reported).toEqual([]);
    },
    10_000,
  );

  it("still saves a cut, whose route answers a failed write itself, when the hold clears", async () => {
    const { file, cut } = fixture("held.html");
    const before = '<div id="a" data-start="0" data-duration="4">A</div>';
    writeFileSync(file, before);
    holdFor(file, 200);
    expect((await cut(fileContentVersion(before))).status).toBe(200);
    expect(readFileSync(file, "utf8").match(/data-duration/g)).toHaveLength(2);
  }, 10_000);

  it("keeps a later edit to the project behind the held one, so the later edit stands", async () => {
    const { file, patch } = fixture("held.html");
    writeFileSync(file, '<h1 id="title">A</h1>');
    holdFor(file, 1_000);
    const order: string[] = [];
    const send = (color: string) =>
      patch(color).then((response) => {
        order.push(color);
        return response.status;
      });
    const first = send("red");
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    const second = send("blue");
    expect([await first, await second]).toEqual([200, 200]);
    expect(order).toEqual(["red", "blue"]);
    expect(readFileSync(file, "utf8")).toContain("color: blue");
  }, 10_000);

  // fails without the fix: each retry slept the whole process, up to 640 ms in one go.
  it("keeps the app answering while it waits", async () => {
    const { file, remove } = fixture("held.html");
    writeFileSync(file, `${edited}<p id="gone">tag</p>`);
    holdFor(file, 1_500);
    expect(
      await longestStall(async () => expect((await remove("gone")).status).toBe(200)),
    ).toBeLessThan(100);
  }, 10_000);

  it("answers 423 busy once the hold outlasts the wait, reports it once, and leaves the file as it was", async () => {
    const reported: string[] = [];
    const { file, remove } = fixture("held.html", (error) =>
      reported.push(String((error as NodeJS.ErrnoException).code)),
    );
    writeFileSync(file, `${edited}<p id="gone">tag</p>`);
    holdFor(file, 60_000);
    expect(await answered(await remove("gone"))).toEqual({ status: 423, why: "busy" });
    expect(readFileSync(file, "utf8")).toBe(`${edited}<p id="gone">tag</p>`);
    expect(reported).toEqual(["EBUSY"]);
  }, 15_000);

  it.skipIf(process.getuid?.() === 0)(
    "refuses a read-only file at once, without waiting",
    async () => {
      const { file, remove } = fixture("readonly.html");
      writeFileSync(file, `${edited}<p id="gone">tag</p>`);
      chmodSync(file, 0o444);
      cleanups.push(() => chmodSync(file, 0o644));
      holdFor(file, 0);
      const started = performance.now();
      expect((await remove("gone")).status).toBe(403);
      expect(performance.now() - started).toBeLessThan(500);
    },
  );
});
