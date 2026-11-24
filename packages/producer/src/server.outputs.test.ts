import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./services/renderOrchestrator.js", () => ({
  RenderCancelledError: class extends Error {},
  resolveRenderDebugDir: () => join(tmpdir(), "hf-server-outputs-debug"),
  createRenderJob: (config: Record<string, unknown>) => ({
    id: "job-id",
    config,
    progress: 0,
    currentStage: "queued",
    warnings: [],
  }),
  executeRenderJob: async (job: Record<string, unknown>, _projectDir: string, output: string) => {
    writeFileSync(output, "rendered video");
    job.outcome = "completed";
  },
}));

import { createProducerApp, type HandlerOptions } from "./server.js";

const noUid = process.getuid === undefined;

function setup(options: HandlerOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), "hf-server-outputs-"));
  const projectsDir = join(root, "projects");
  const rendersDir = join(root, "renders");
  mkdirSync(join(projectsDir, "demo"), { recursive: true });
  writeFileSync(join(projectsDir, "demo", "index.html"), "<html></html>");
  const secret = join(root, "secret.txt");
  writeFileSync(secret, "not a render");
  const app = createProducerApp({ projectsDir, rendersDir, ...options });
  return { root, rendersDir, secret, app };
}

async function render(app: Hono, body: Record<string, unknown>) {
  const res = await app.request("http://localhost:9847/render", {
    method: "POST",
    headers: { host: "localhost:9847" },
    body: JSON.stringify({ projectDir: "demo", ...body }),
  });
  const json = (await res.json()) as { outputPath: string; outputUrl: string; error?: string };
  return { status: res.status, ...json };
}

function download(app: Hono, url: string) {
  return app.request(`http://localhost:9847${url}`, { headers: { host: "localhost:9847" } });
}

const settle = () => new Promise((done) => setImmediate(done));

describe("producer outputs: download tokens", () => {
  it("serves a render the server named, then removes it once downloaded", async () => {
    const { app, rendersDir } = setup();
    const { status, outputPath, outputUrl } = await render(app, {});
    expect(status).toBe(200);
    expect(dirname(outputPath)).toBe(rendersDir);

    const res = await download(app, outputUrl);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("rendered video");
    await vi.waitFor(() => expect(existsSync(outputPath)).toBe(false));
    expect((await download(app, outputUrl)).status).toBe(404);
  });

  it("gives two renders of one project a file each", async () => {
    const { app } = setup();
    const first = await render(app, {});
    const second = await render(app, {});
    expect(basename(first.outputPath)).toMatch(/^demo-/);
    expect(second.outputPath).not.toBe(first.outputPath);
  });

  it("keeps an output the caller named after it is downloaded", async () => {
    const { app, rendersDir } = setup();
    const { outputPath, outputUrl } = await render(app, {
      outputPath: join(rendersDir, "mine.mp4"),
    });
    expect(await (await download(app, outputUrl)).text()).toBe("rendered video");
    await settle();
    expect(existsSync(outputPath)).toBe(true);
    expect(await (await download(app, outputUrl)).text()).toBe("rendered video");
  });

  it("removes a render the server named when its token expires", async () => {
    const { app } = setup({ artifactTtlMs: 0 });
    const { outputPath, outputUrl } = await render(app, {});
    expect((await download(app, outputUrl)).status).toBe(404);
    expect(existsSync(outputPath)).toBe(false);
  });

  it("never serves a link put at the output's name", async () => {
    const { app, rendersDir, secret } = setup();
    const { outputPath, outputUrl } = await render(app, { outputPath: join(rendersDir, "a.mp4") });
    rmSync(outputPath);
    symlinkSync(secret, outputPath);
    const res = await download(app, outputUrl);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("not a render");
  });

  it("never serves another file put at the name of a render the server named", async () => {
    const { app } = setup();
    const { outputPath, outputUrl } = await render(app, {});
    rmSync(outputPath);
    writeFileSync(outputPath, "someone else's file");
    const res = await download(app, outputUrl);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("someone else's file");
  });
});

describe.skipIf(!existsSync("/proc/self/fd"))("producer outputs: open files", () => {
  it("holds nothing open on an output the caller named, so deleting it frees the space", async () => {
    const { app, rendersDir } = setup();
    const { outputPath } = await render(app, { outputPath: join(rendersDir, "theirs.mp4") });
    rmSync(outputPath);
    const open = readdirSync("/proc/self/fd").map((fd) => {
      try {
        return readlinkSync(join("/proc/self/fd", fd));
      } catch {
        return "";
      }
    });
    expect(open.filter((target) => target.startsWith(outputPath))).toEqual([]);
  });
});

describe.skipIf(noUid)("producer outputs: renders folder", () => {
  const envBefore = process.env.PRODUCER_RENDERS_DIR;
  afterEach(() => {
    if (envBefore === undefined) delete process.env.PRODUCER_RENDERS_DIR;
    else process.env.PRODUCER_RENDERS_DIR = envBefore;
  });

  it("refuses an output folder another account can change, and creates nothing", async () => {
    const { app, rendersDir } = setup();
    const shared = join(rendersDir, "shared");
    mkdirSync(shared, { recursive: true });
    chmodSync(shared, 0o777);
    const { status, error } = await render(app, { outputPath: join(shared, "sub", "x.mp4") });
    expect(status).toBe(400);
    expect(error).toContain(`another account can change ${shared}`);
    expect(existsSync(join(shared, "sub"))).toBe(false);
  });

  it("still renders straight into a shared sticky root such as /tmp", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-server-outputs-sticky-"));
    chmodSync(root, 0o1777);
    const { app } = setup({ rendersDir: root });
    const { status } = await render(app, { outputPath: join(root, "x.mp4") });
    expect(status).toBe(200);
  });

  it("defaults to a private renders folder of its own, not the shared temp dir", async () => {
    delete process.env.PRODUCER_RENDERS_DIR;
    const { app } = setup({ rendersDir: undefined });
    const { status, outputPath } = await render(app, {});
    expect(status).toBe(200);
    const folder = dirname(outputPath);
    expect(folder).not.toBe(tmpdir());
    expect(folder).not.toBe("/tmp");
    expect(lstatSync(folder).mode & 0o077).toBe(0);
  });
});
