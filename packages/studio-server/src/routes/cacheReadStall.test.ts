// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { Hono } from "hono";
import { afterEach, expect, it, vi } from "vitest";
import { buildWaveformCacheKey } from "../helpers/waveform.js";
import { createPreviewDocumentStore } from "../helpers/previewDocumentStore.js";
import { fastIndexPath, writeCopyIndex } from "../helpers/proxyCacheKey.js";
import { getProxyCachePath, resolveProxy } from "../helpers/proxyTranscoder.js";
import { registerPreviewRoutes } from "./preview";
import { registerWaveformRoutes } from "./waveform";
import { stubAdapter } from "./stubAdapter.test-helpers";

// A project folder whose disk stops answering for `stall.ms` on every call inside it, sync or async. Each stall keeps
// how many pings landed while it waited: none means the server's thread was held.
const stall = vi.hoisted(() => ({ ms: 0, under: "", pings: 0, spans: [] as number[] }));
const stalls = (path: unknown) =>
  stall.ms > 0 && typeof path === "string" && path.startsWith(`${stall.under}${sep}`);

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
    realpathSync: Object.assign(slowed(actual.realpathSync), {
      native: slowed(actual.realpathSync.native),
    }),
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
    realpath: slowed(actual.realpath),
    stat: slowed(actual.stat),
    utimes: slowed(actual.utimes),
  };
});

// A video that needs a preview copy, without running ffprobe on the test's bytes.
vi.mock("../helpers/mediaCodecMap.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../helpers/mediaCodecMap.js")>()),
  probeAssetCodec: async () => ({
    codecName: "hevc",
    browserHostile: true,
    representativeMime: null,
    hasAlpha: false,
  }),
}));

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

// fails without the fix: finding a video's preview copy (its folder's real path, the copy, the index naming an earlier
// copy of the same bytes) ran sync calls inside the preview request.
it("finding a video's preview copy keeps the thread running while each read waits on the disk", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "hf-cache-stall-")));
  roots.push(dir);
  writeFileSync(join(dir, "clip.mp4"), "video");
  const fresh = await getProxyCachePath(dir, join(dir, "clip.mp4"));
  mkdirSync(dirname(fresh), { recursive: true });
  const earlier = join(dirname(fresh), `${"a".repeat(64)}.mp4`);
  writeFileSync(earlier, "copy");
  writeCopyIndex(fastIndexPath(fresh), earlier);
  let found: unknown;
  const { stalls, held } = await pingedThroughStalls(dir, async () => {
    found = await getProxyCachePath(dir, join(dir, "clip.mp4"));
  });
  expect(found).toBe(earlier);
  expect(stalls).toBeGreaterThanOrEqual(3);
  expect(held).toBe(0);
});

/** A project with a video whose preview copy was already made under another key, found through the copy index. */
async function projectWithIndexedCopy() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "hf-cache-stall-")));
  roots.push(dir);
  writeFileSync(join(dir, "clip.mp4"), "video");
  const fresh = await getProxyCachePath(dir, join(dir, "clip.mp4"));
  mkdirSync(dirname(fresh), { recursive: true });
  const earlier = join(dirname(fresh), `${"a".repeat(64)}.mp4`);
  writeFileSync(earlier, "copy");
  writeCopyIndex(fastIndexPath(fresh), earlier);
  return { dir, earlier };
}

// fails without the fix: the route's zero wait started before the copy lookup, so a slow disk turned a made copy into
// "being made" on every retry.
it("a preview copy that was already made is served while each read waits on the disk", async () => {
  const { dir } = await projectWithIndexedCopy();
  const app = new Hono();
  registerPreviewRoutes(app, stubAdapter(dir));
  let res: Response | undefined;
  await pingedThroughStalls(dir, async () => {
    res = await app.request("http://localhost/projects/p/preview/clip.mp4?hf-proxy=h264");
  });
  expect(res?.status).toBe(200);
  expect(await res?.text()).toBe("copy");
});

// fails without the fix: a lookup that failed while an earlier one held its project's turn had no handler yet.
it("a copy lookup that fails while it waits its turn reaches only its caller", async () => {
  const { dir } = await projectWithIndexedCopy();
  const unhandled: unknown[] = [];
  const note = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", note);
  try {
    let failed: unknown;
    await pingedThroughStalls(dir, async () => {
      const first = resolveProxy(dir, join(dir, "clip.mp4"));
      const second = resolveProxy(dir, join(tmpdir(), "outside.mp4")).catch(
        (err: unknown) => (failed = err),
      );
      await Promise.all([first, second]);
    });
    expect(failed).toBeInstanceOf(Error);
  } finally {
    process.off("unhandledRejection", note);
  }
  expect(unhandled).toEqual([]);
});

// fails without the fix: a copy idle past the sweep's limit is spared by the sweep its own hit starts, which runs
// before the hit's "just used" time lands.
it("a preview copy idle for months is served, not swept by the request that found it", async () => {
  const { dir, earlier } = await projectWithIndexedCopy();
  const longAgo = new Date(Date.now() - 365 * 24 * 3600_000);
  utimesSync(earlier, longAgo, longAgo);
  const app = new Hono();
  registerPreviewRoutes(app, stubAdapter(dir));
  let res: Response | undefined;
  await pingedThroughStalls(dir, async () => {
    res = await app.request("http://localhost/projects/p/preview/clip.mp4?hf-proxy=h264");
  });
  expect(res?.status).toBe(200);
  expect(await res?.text()).toBe("copy");
});
