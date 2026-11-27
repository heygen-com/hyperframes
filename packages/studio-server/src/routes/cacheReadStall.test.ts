// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, expect, it, vi } from "vitest";
import { buildWaveformCacheKey } from "../helpers/waveform.js";
import { createPreviewDocumentStore } from "../helpers/previewDocumentStore.js";
import { registerWaveformRoutes } from "./waveform";
import { stubAdapter } from "./stubAdapter.test-helpers";

// A project folder whose disk stops answering for `stall.ms` on every call inside it, sync or async. Each stall keeps
// how many pings landed while it waited: none means the server's thread was held.
const stall = vi.hoisted(() => ({ ms: 0, under: "", pings: 0, spans: [] as number[] }));
const stalls = (path: unknown) =>
  stall.ms > 0 && typeof path === "string" && path.startsWith(`${stall.under}/`);

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const slowed = <F extends (...args: never[]) => unknown>(call: F) =>
    ((path: unknown, ...rest: unknown[]) => {
      if (stalls(path)) {
        const before = stall.pings;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, stall.ms);
        stall.spans.push(stall.pings - before);
      }
      return (call as (...args: unknown[]) => unknown)(path, ...rest);
    }) as unknown as F;
  return {
    ...actual,
    openSync: slowed(actual.openSync),
    readFileSync: slowed(actual.readFileSync),
    lstatSync: slowed(actual.lstatSync),
    statSync: slowed(actual.statSync),
    existsSync: slowed(actual.existsSync),
    utimesSync: slowed(actual.utimesSync),
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const slowed = <F extends (...args: never[]) => Promise<unknown>>(call: F) =>
    (async (path: unknown, ...rest: unknown[]) => {
      if (stalls(path)) {
        const before = stall.pings;
        await new Promise((settle) => setTimeout(settle, stall.ms));
        stall.spans.push(stall.pings - before);
      }
      return (call as (...args: unknown[]) => Promise<unknown>)(path, ...rest);
    }) as unknown as F;
  return {
    ...actual,
    open: slowed(actual.open),
    readFile: slowed(actual.readFile),
    lstat: slowed(actual.lstat),
    stat: slowed(actual.stat),
    utimes: slowed(actual.utimes),
  };
});

const roots: string[] = [];
afterEach(() => {
  Object.assign(stall, { ms: 0, under: "", pings: 0, spans: [] });
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function pingedThroughStalls(under: string, work: () => Promise<unknown>) {
  const ping = setInterval(() => stall.pings++, 5);
  Object.assign(stall, { ms: 120, under, pings: 0, spans: [] });
  try {
    await work();
  } finally {
    stall.ms = 0;
    clearInterval(ping);
  }
  return { stalls: stall.spans.length, held: stall.spans.filter((pinged) => pinged === 0).length };
}

// fails without the fix: a cached waveform was read with sync calls inside the request, so a project folder whose disk
// stopped answering held the whole app.
it("serving a cached waveform keeps the thread running while each read waits on the disk", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-cache-stall-"));
  roots.push(dir);
  writeFileSync(join(dir, "bed.wav"), "audio");
  mkdirSync(join(dir, ".waveform-cache"));
  const key = buildWaveformCacheKey("bed.wav", statSync(join(dir, "bed.wav")));
  writeFileSync(join(dir, ".waveform-cache", key), JSON.stringify([0.25, 0.5]));
  const app = new Hono();
  registerWaveformRoutes(app, stubAdapter(dir));
  let body: unknown;
  const { stalls, held } = await pingedThroughStalls(dir, async () => {
    body = await (await app.request("http://localhost/projects/p/waveform/bed.wav")).json();
  });
  expect(body).toEqual({ peaks: [0.25, 0.5] });
  expect(stalls).toBeGreaterThanOrEqual(3);
  expect(held).toBe(0);
});

// fails without the fix: a kept preview document was read with sync calls inside the preview request.
it("reading a kept preview document keeps the thread running while each read waits on the disk", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-cache-stall-"));
  roots.push(dir);
  const store = createPreviewDocumentStore(dir, "salt", "secret");
  store.write("key", "<html>kept</html>");
  let html: unknown;
  const { stalls, held } = await pingedThroughStalls(dir, async () => {
    html = await store.read("key");
  });
  expect(html).toBe("<html>kept</html>");
  expect(stalls).toBeGreaterThanOrEqual(2);
  expect(held).toBe(0);
});
