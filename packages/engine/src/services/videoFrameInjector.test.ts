// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Page } from "puppeteer-core";

// Hoist mocks before importing the module under test so the mock factory wins.
// The cache-hygiene block exercises createVideoFrameInjector against stubbed
// page-side primitives so we can assert on Node-side state (cache poisoning)
// without standing up a real browser.
const { injectVideoFramesBatchMock, syncVideoFrameVisibilityMock } = vi.hoisted(() => ({
  injectVideoFramesBatchMock: vi.fn<
    (page: Page, updates: Array<{ videoId: string; dataUri: string }>) => Promise<string[]>
  >(async (_page, updates) => updates.map((u) => u.videoId)),
  syncVideoFrameVisibilityMock: vi.fn<(page: Page, ids: string[]) => Promise<void>>(
    async () => undefined,
  ),
}));

vi.mock("./screenshotService.js", () => ({
  injectVideoFramesBatch: injectVideoFramesBatchMock,
  syncVideoFrameVisibility: syncVideoFrameVisibilityMock,
}));

import { __testing, createVideoFrameInjector } from "./videoFrameInjector.js";
import { type FrameLookupTable } from "./videoFrameExtractor.js";
import { DEFAULT_CONFIG } from "../config.js";

const { createFrameSourceCache } = __testing;

const SHARED_STATS = { evictions: 0, oversizedRejections: 0 };

describe("frame source cache eviction", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-frame-cache-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Each PNG is base64-encoded into the data URI, so the cached string is
  // ~4/3 the file size plus a small `data:image/png;base64,` prefix. Build
  // distinct files so eviction has predictable victims.
  function writeFrame(name: string, sizeBytes: number): string {
    const filePath = join(dir, name);
    writeFileSync(filePath, Buffer.alloc(sizeBytes, 0));
    return filePath;
  }

  it("evicts oldest entry when entry count exceeds limit", async () => {
    const cache = createFrameSourceCache(2, Number.MAX_SAFE_INTEGER);
    const a = writeFrame("a.png", 16);
    const b = writeFrame("b.png", 16);
    const c = writeFrame("c.png", 16);

    await cache.get(a);
    await cache.get(b);
    expect(cache.stats().entries).toBe(2);

    await cache.get(c);
    expect(cache.stats().entries).toBe(2);
    expect(cache.stats().evictions).toBe(1);

    // Verify the *oldest* entry (a) was the victim — the LRU contract.
    // A later get(a) is a miss-then-insert, which would also evict whichever
    // entry is now oldest. We instrument the eviction counter to detect it.
    const evictionsBefore = cache.stats().evictions;
    await cache.get(a);
    expect(cache.stats().evictions).toBe(evictionsBefore + 1);
    // After re-inserting `a`, `b` is the next oldest. `c` is now newest.
    // Touch `b` (move-to-front) → next eviction would be `c`, not `b`.
  });

  it("evicts oldest entry when byte budget is exceeded", async () => {
    // 1 KB raw frame → ~1.4 KB base64 + ~22-byte data URI prefix. Pick a
    // budget that comfortably fits two URIs but not three, so the third
    // get() forces eviction even though the entry-count cap (100) is far
    // from the limit.
    const cache = createFrameSourceCache(100, 4 * 1024);
    const a = writeFrame("a.png", 1024);
    const b = writeFrame("b.png", 1024);
    const c = writeFrame("c.png", 1024);

    await cache.get(a);
    await cache.get(b);
    expect(cache.stats().entries).toBe(2);

    await cache.get(c);
    const afterC = cache.stats();
    // The byte budget is the contract — the cache MUST stay under it after
    // an insert that would otherwise overflow. Entry count is incidental.
    expect(afterC.bytes).toBeLessThanOrEqual(4 * 1024);
    expect(afterC.entries).toBeLessThan(3);
  });

  it("returns the served URL untouched when frameSrcResolver yields one", async () => {
    let served: string | null = "/served/frame.png";
    const cache = createFrameSourceCache(4, 64 * 1024, () => served);
    const file = writeFrame("a.png", 256);

    expect(await cache.get(file)).toBe("/served/frame.png");
    // Cache stays empty because the resolver short-circuits the read.
    expect(cache.stats()).toMatchObject({ entries: 0, bytes: 0 });

    served = null;
    const dataUri = await cache.get(file);
    expect(dataUri.startsWith("data:image/png;base64,")).toBe(true);
    expect(cache.stats().entries).toBe(1);
  });

  it("treats a re-read as a cache hit (no second file read)", async () => {
    const cache = createFrameSourceCache(2, Number.MAX_SAFE_INTEGER);
    const a = writeFrame("a.png", 64);

    const first = await cache.get(a);
    const second = await cache.get(a);
    expect(second).toBe(first);
    expect(cache.stats().entries).toBe(1);
  });

  it("skips caching an entry that alone exceeds the byte budget (no self-eviction)", async () => {
    // 64 KB raw → ~88 KB base64 + prefix. Budget of 32 KB rejects this entry.
    // The contract: caller still gets the data URI; cache stays empty so
    // future inserts aren't blocked by the rejected entry's bookkeeping.
    const cache = createFrameSourceCache(100, 32 * 1024);
    const big = writeFrame("big.png", 64 * 1024);

    const dataUri = await cache.get(big);
    expect(dataUri.startsWith("data:image/png;base64,")).toBe(true);
    expect(cache.stats().entries).toBe(0);
    expect(cache.stats().bytes).toBe(0);
    expect(cache.stats().oversizedRejections).toBe(1);
    expect(cache.stats().evictions).toBe(0);

    // A subsequent normal-sized entry must cache cleanly — the rejection
    // path didn't pollute internal state.
    const small = writeFrame("small.png", 1024);
    await cache.get(small);
    expect(cache.stats().entries).toBe(1);
  });

  it("at the production default (1500 MB), 1080p frames stay cached", async () => {
    // Regression for the post-PR-#662 default: previously the cache held up
    // to 256 entries × ~8 MB ≈ 2 GB at 1080p. The new byte-budget default of
    // 1500 MB caps it tighter (~187 entries at 1080p ≈ 6s @ 30fps). This
    // test pins the math so a future tweak to the default is visible.
    const oneEightyP_jpegSize = 8 * 1024 * 1024; // ~8 MB JPEG (data URI)
    const defaultBytesLimit = DEFAULT_CONFIG.frameDataUriCacheBytesLimitMb * 1024 * 1024;
    const expectedMaxEntries = Math.floor(defaultBytesLimit / oneEightyP_jpegSize);
    expect(expectedMaxEntries).toBeGreaterThanOrEqual(180);
    expect(expectedMaxEntries).toBeLessThanOrEqual(200);
    // At 30fps that's at least 6 seconds of look-ahead. Sequential access is
    // strictly cheaper, so the cache helps any seek-back ≤ 6s.
    expect(expectedMaxEntries / 30).toBeGreaterThanOrEqual(6);
  });

  // Suppress unused-import warning when the SHARED_STATS sentinel is dropped.
  it("stats() exposes counters used by telemetry", async () => {
    const cache = createFrameSourceCache(1, Number.MAX_SAFE_INTEGER);
    expect(cache.stats()).toMatchObject({ ...SHARED_STATS, entries: 0, bytes: 0 });
  });
});

describe("createVideoFrameInjector cache hygiene against page-side skips", () => {
  // Build a minimal FrameLookupTable stand-in that returns one fixed payload
  // for every time so we can drive the hook deterministically. The real
  // table is exercised exhaustively in videoFrameExtractor.test.ts.
  function fakeTable(payload: { videoId: string; framePath: string; frameIndex: number }) {
    return {
      getActiveFramePayloads: () =>
        new Map([
          [payload.videoId, { framePath: payload.framePath, frameIndex: payload.frameIndex }],
        ]),
    } as unknown as FrameLookupTable;
  }

  // Bypass the on-disk frame cache by handing back a synthetic data URI.
  function inlineResolver(framePath: string): string {
    return `data:image/png;base64,fake-${framePath}`;
  }

  beforeEach(() => {
    injectVideoFramesBatchMock.mockReset();
    syncVideoFrameVisibilityMock.mockReset();
    syncVideoFrameVisibilityMock.mockResolvedValue(undefined);
  });

  it("does not poison the lastInjected cache when the page reports zero ids injected", async () => {
    // Regression for the agentic-finecut scenario after PR #1028's ancestor
    // skip: when injectVideoFramesBatch silently drops a video (its sub-comp
    // host is hidden), the caller used to record `lastInjectedFrame[v] = N`
    // anyway. On the next frame, if the source frameIndex is unchanged
    // (low-fps source, multiple output frames per source frame, or
    // non-frame-aligned host start), the cache short-circuits the second
    // call and the host's first visible frame paints blank because the
    // replacement <img> was never created.
    //
    // Pin the contract: when the page returns `[]` (no ids actually
    // injected), the cache must not record those frameIndexes, so a follow-
    // up call at the same frameIndex still issues an inject.
    // The injector calls page.evaluate after injecting frames (GPU reseek);
    // stub it so these cache-hygiene cases exercise the real code path.
    const fakePage = { evaluate: async () => undefined } as unknown as Page;
    const hook = createVideoFrameInjector(
      fakeTable({ videoId: "pip", framePath: "/p", frameIndex: 5 }),
      {
        frameSrcResolver: inlineResolver,
      },
    );
    expect(hook).not.toBeNull();

    // First call: simulate the ancestor-hidden skip — page-side reports it
    // injected nothing.
    injectVideoFramesBatchMock.mockResolvedValueOnce([]);
    await hook!(fakePage, 0);
    expect(injectVideoFramesBatchMock).toHaveBeenCalledTimes(1);
    expect(injectVideoFramesBatchMock).toHaveBeenLastCalledWith(fakePage, [
      { videoId: "pip", dataUri: "data:image/png;base64,fake-/p" },
    ]);

    // Second call: same frameIndex, but the previous call did not really
    // paint. The cache must NOT short-circuit; the inject must run again.
    injectVideoFramesBatchMock.mockResolvedValueOnce(["pip"]);
    await hook!(fakePage, 0);
    expect(injectVideoFramesBatchMock).toHaveBeenCalledTimes(2);
    expect(injectVideoFramesBatchMock).toHaveBeenLastCalledWith(fakePage, [
      { videoId: "pip", dataUri: "data:image/png;base64,fake-/p" },
    ]);
  });

  it("does cache normally when the page reports the id as injected", async () => {
    // Counter-test: when injection succeeds for a videoId, the cache must
    // record it and a second call at the same frameIndex must short-circuit.
    // This pins the happy path so a future refactor can't trade the skip
    // bug for a never-cache regression.
    // The injector calls page.evaluate after injecting frames (GPU reseek);
    // stub it so these cache-hygiene cases exercise the real code path.
    const fakePage = { evaluate: async () => undefined } as unknown as Page;
    const hook = createVideoFrameInjector(
      fakeTable({ videoId: "pip", framePath: "/p", frameIndex: 5 }),
      {
        frameSrcResolver: inlineResolver,
      },
    );

    injectVideoFramesBatchMock.mockResolvedValueOnce(["pip"]);
    await hook!(fakePage, 0);
    expect(injectVideoFramesBatchMock).toHaveBeenCalledTimes(1);

    await hook!(fakePage, 0);
    // Cache hit — no second inject for the same frameIndex.
    expect(injectVideoFramesBatchMock).toHaveBeenCalledTimes(1);
  });

  // Regression: WebGL/WebGPU compositions that sample a <video> as a texture
  // render on `hf-seek` BEFORE frames are injected. After injecting the
  // decoded frames, the hook must re-render the GPU adapters at the same time
  // (window.__hfReseekGpu) so they re-upload their textures from the fresh
  // frames — otherwise the facet flickers / goes black non-deterministically.
  it("re-renders GPU adapters after injecting frames (post-injection reseek)", async () => {
    const evaluate = vi.fn(async () => undefined);
    const page = { evaluate } as unknown as Page;
    const hook = createVideoFrameInjector(
      fakeTable({ videoId: "facet", framePath: "/f", frameIndex: 3 }),
      { frameSrcResolver: inlineResolver },
    );

    injectVideoFramesBatchMock.mockResolvedValueOnce(["facet"]);
    await hook!(page, 1.5);

    expect(evaluate).toHaveBeenCalledTimes(1);
    // Re-render is requested at the same time as the seek.
    expect(evaluate.mock.calls[0]![1]).toBe(1.5);
    // The evaluated page function invokes window.__hfReseekGpu(time).
    const pageFn = evaluate.mock.calls[0]![0] as (t: number) => void;
    const reseek = vi.fn();
    (globalThis as unknown as { window?: unknown }).window = { __hfReseekGpu: reseek };
    pageFn(1.5);
    delete (globalThis as unknown as { window?: unknown }).window;
    expect(reseek).toHaveBeenCalledWith(1.5);
  });

  it("does not reseek GPU when the page injected no frames", async () => {
    const evaluate = vi.fn(async () => undefined);
    const page = { evaluate } as unknown as Page;
    const hook = createVideoFrameInjector(
      fakeTable({ videoId: "facet", framePath: "/f", frameIndex: 3 }),
      { frameSrcResolver: inlineResolver },
    );

    // Page dropped the video (e.g. hidden host) → nothing injected → no reseek.
    injectVideoFramesBatchMock.mockResolvedValueOnce([]);
    await hook!(page, 1.5);

    expect(evaluate).not.toHaveBeenCalled();
  });
});
