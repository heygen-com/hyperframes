import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compileForRenderInWorker } from "./compileInWorker.js";
import { scratchOutputOf } from "./compileScratch.js";
import { compileForRender } from "./htmlCompiler.js";
import { extractSafeRenderErrorMetadata } from "../server.js";

const FAKE = resolve(import.meta.dirname, "__fixtures__/compileWorkerFake.mjs");
const REAL = resolve(import.meta.dirname, "__fixtures__/compileWorkerTs.mjs");

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("compileForRenderInWorker", () => {
  it("ends a compile stuck in a synchronous pass at its deadline, with a typed non-retryable error", async () => {
    const terminate = vi.spyOn(Worker.prototype, "terminate");
    cleanups.push(() => terminate.mockRestore());
    const began = performance.now();
    const error = await compileForRenderInWorker(
      "hang",
      "x.html",
      "d",
      {},
      {
        entry: FAKE,
        timeoutMs: 300,
      },
    ).catch((e: unknown) => e);
    expect(performance.now() - began).toBeLessThan(3_000);
    expect(extractSafeRenderErrorMetadata(error)).toEqual({
      errorCode: "COMPILE_TIMEOUT",
      errorOwner: "user",
      retryable: false,
      errorMetadata: { timeoutMs: 300 },
    });
    // The stuck thread itself ends, not only the promise.
    await vi.waitFor(() => expect(terminate).toHaveBeenCalled(), { timeout: 5_000 });
    await expect(terminate.mock.results[0]?.value).resolves.toBeTypeOf("number");
  });

  it("keeps the main thread answering /health while the compile is stuck", async () => {
    const server: Server = createServer((_req, res) => res.end("ok"));
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    cleanups.push(() => server.close());
    const { port } = server.address() as AddressInfo;

    let settled = false;
    const compile = compileForRenderInWorker(
      "hang",
      "x.html",
      "d",
      {},
      {
        entry: FAKE,
        timeoutMs: 1_500,
      },
    ).catch(() => {});
    void compile.then(() => (settled = true));
    const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.text());
    expect(health).toBe("ok");
    expect(settled).toBe(false);
    await compile;
  });

  it("ends the compile with the render's abort reason when the render is cancelled", async () => {
    const controller = new AbortController();
    const reason = new Error("render cancelled");
    setTimeout(() => controller.abort(reason), 100);
    const began = performance.now();
    const error = await compileForRenderInWorker(
      "hang",
      "x.html",
      "d",
      { abortSignal: controller.signal },
      { entry: FAKE, timeoutMs: 10_000 },
    ).catch((e: unknown) => e);
    expect(error).toBe(reason);
    expect(performance.now() - began).toBeLessThan(3_000);
  });

  it("ends a stopped compile's child processes and removes their temp output, only inside its folders", async () => {
    const parent = mkdtempSync(join(tmpdir(), "hf-compile-child-"));
    cleanups.push(() => rmSync(parent, { recursive: true, force: true }));
    const dir = join(parent, "downloads");
    mkdirSync(dir);
    const outside = join(parent, "outside.webm.tmp-1-2");
    writeFileSync(outside, "not this compile's");
    const error = await compileForRenderInWorker(
      "child",
      "x.html",
      dir,
      {},
      {
        entry: FAKE,
        timeoutMs: 500,
      },
    ).catch((e: unknown) => e);
    expect(extractSafeRenderErrorMetadata(error)?.errorCode).toBe("COMPILE_TIMEOUT");
    // The thread never hears the abort, so the parent ends its children itself once the thread is gone.
    // Under plain node the thread's teardown then waits on them; vitest's own worker doesn't, so a zombie counts as ended.
    const running = (pidFile: string) =>
      spawnSync("ps", ["-o", "stat=", "-p", readFileSync(join(dir, pidFile), "utf8")], {
        encoding: "utf8",
      })
        .stdout.trim()
        .replace(/^Z.*/, "");
    await vi.waitFor(
      () => {
        expect(running("child.pid")).toBe("");
        expect(running("other.pid")).toBe("");
        expect(existsSync(join(dir, "clip.webm.tmp-1-2"))).toBe(false);
      },
      { timeout: 6_000, interval: 200 },
    );
    expect(existsSync(outside)).toBe(true);
  }, 15_000);

  it("counts only an ffmpeg run's own temp file as its scratch output", () => {
    const tmp = "/dl/clip.webm.tmp-42-3f2a9c1e-0b7d-4e55-9a1f-2c6d8e4b7a10";
    expect(scratchOutputOf("/usr/bin/ffmpeg", ["-i", "in.gif", tmp])).toBe(tmp);
    expect(scratchOutputOf("/opt/ffmpeg/bin/ffprobe", ["-i", tmp])).toBeUndefined();
    expect(scratchOutputOf("ffmpeg", ["-i", "in.gif", "/a.tmp-1-2/finished.webm"])).toBeUndefined();
  });

  it("keeps a typed compile error's code, owner, retryability and metadata across the thread", async () => {
    const error = await compileForRenderInWorker("typed", "x.html", "d", {}, { entry: FAKE }).catch(
      (e: unknown) => e,
    );
    expect(extractSafeRenderErrorMetadata(error)).toEqual({
      errorCode: "COMPOSITION_TOO_LARGE",
      errorOwner: "user",
      retryable: false,
      errorMetadata: { bytes: 2, limitBytes: 1 },
    });
  });

  it("brings a real compile's typed refusal back with its wire fields", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-compile-worker-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(
      join(dir, "index.html"),
      `<!doctype html><html><head></head><body><main data-composition-id="main" data-start="0" data-width="320" data-height="180" data-duration="1">${"<i></i>".repeat(100_001)}</main></body></html>`,
    );
    const error = await compileForRenderInWorker(
      dir,
      join(dir, "index.html"),
      dir,
      {},
      {
        entry: REAL,
      },
    ).catch((e: unknown) => e);
    expect(extractSafeRenderErrorMetadata(error)).toMatchObject({
      errorCode: "COMPOSITION_TOO_LARGE",
      errorOwner: "user",
      retryable: false,
      errorMetadata: { exceeded: "elements" },
    });
  }, 60_000);

  it("compiles a project on the real worker exactly as in-process", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-compile-worker-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, "downloads"));
    writeFileSync(
      join(dir, "index.html"),
      `<!doctype html><html><head></head><body>
<main data-composition-id="main" data-start="0" data-width="320" data-height="180" data-duration="1"><p>x</p></main>
</body></html>`,
    );
    const html = join(dir, "index.html");
    const downloads = join(dir, "downloads");
    const logged: string[] = [];
    const log = {
      error: (m: string) => logged.push(m),
      warn: (m: string) => logged.push(m),
      info: (m: string) => logged.push(m),
      debug: (m: string) => logged.push(m),
    };
    const inProcess = await compileForRender(dir, html, downloads, { log });
    const onWorker = await compileForRenderInWorker(dir, html, downloads, { log }, { entry: REAL });
    expect(onWorker).toEqual(inProcess);
  }, 60_000);
});
