import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createChromeMemorySampler,
  mergeSample,
  type ChromeMemoryStats,
  type ChromePids,
} from "./chromeMemorySampler.js";

const empty: ChromeMemoryStats = { samples: 0 };

describe("mergeSample", () => {
  it("tracks browser and renderer peaks separately and sums the last sample", () => {
    const pids: ChromePids = { browser: 1, renderers: [2, 3], gpu: [4] };
    const first = mergeSample(empty, pids, [
      { pid: 1, rssMb: 100 },
      { pid: 2, rssMb: 300 },
      { pid: 3, rssMb: 200 },
      { pid: 4, rssMb: 50 },
    ]);
    expect(first).toEqual({
      browserRssPeakMb: 100,
      rendererRssPeakMb: 300,
      rssLastMb: 650,
      gpuProcessSeenLastSample: true,
      samples: 1,
    });
    const second = mergeSample(first, { browser: 1, renderers: [2], gpu: [] }, [
      { pid: 1, rssMb: 90 },
      { pid: 2, rssMb: 250 },
    ]);
    expect(second).toEqual({
      browserRssPeakMb: 100,
      rendererRssPeakMb: 300,
      rssLastMb: 340,
      gpuProcessSeenLastSample: false,
      samples: 2,
    });
  });

  it("does not count a sample that returned no rows", () => {
    expect(mergeSample(empty, { renderers: [], gpu: [] }, [])).toEqual(empty);
  });
});

describe("createChromeMemorySampler", () => {
  afterEach(() => vi.useRealTimers());

  it("samples on the interval, reports via onSample, and stops cleanly", async () => {
    vi.useFakeTimers();
    const seen: ChromeMemoryStats[] = [];
    const sampler = createChromeMemorySampler({
      getPids: async () => ({ browser: 1, renderers: [2], gpu: [] }),
      sampleRss: async () => [
        { pid: 1, rssMb: 10 },
        { pid: 2, rssMb: 20 },
      ],
      intervalMs: 1000,
      onSample: (s) => seen.push(s),
    });
    sampler.start();
    await vi.advanceTimersByTimeAsync(2500);
    sampler.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(seen.length).toBe(2);
    expect(sampler.stats()).toEqual({
      browserRssPeakMb: 10,
      rendererRssPeakMb: 20,
      rssLastMb: 30,
      gpuProcessSeenLastSample: false,
      samples: 2,
    });
  });

  it("never lets a dependency error escape and keeps sampling", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const sampler = createChromeMemorySampler({
      getPids: async () => {
        calls += 1;
        if (calls === 1) throw new Error("cdp gone");
        return { browser: 1, renderers: [], gpu: [] };
      },
      sampleRss: async () => [{ pid: 1, rssMb: 5 }],
      intervalMs: 100,
    });
    sampler.start();
    await vi.advanceTimersByTimeAsync(250);
    sampler.stop();
    expect(sampler.stats().samples).toBe(1);
  });

  it("resolves sampleOnce() even when a dependency throws", async () => {
    // Direct pin on the catch: the interval test above still ends at one
    // sample if the catch is removed (the next tick succeeds), so only this
    // assertion fails when the guard is gone.
    const sampler = createChromeMemorySampler({
      getPids: async () => {
        throw new Error("cdp gone");
      },
      sampleRss: async () => [],
      intervalMs: 100,
    });
    await expect(sampler.sampleOnce()).resolves.toBeUndefined();
    expect(sampler.stats()).toEqual(empty);
  });

  it("skips a tick while the previous sample is still in flight", async () => {
    vi.useFakeTimers();
    let inFlight = 0;
    let maxInFlight = 0;
    const sampler = createChromeMemorySampler({
      getPids: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 350));
        inFlight -= 1;
        return { browser: 1, renderers: [], gpu: [] };
      },
      sampleRss: async () => [{ pid: 1, rssMb: 1 }],
      intervalMs: 100,
    });
    sampler.start();
    await vi.advanceTimersByTimeAsync(1000);
    sampler.stop();
    expect(maxInFlight).toBe(1);
  });

  it("stop(); await sampleOnce() joins an in-flight tick: stats current at close, no late onSample", async () => {
    // Mirrors the closeCaptureSession sequence. The tick at 100 ms is still
    // waiting on getPids (350 ms) when close runs; the close-time sample must
    // resolve after that tick has merged, not before.
    vi.useFakeTimers();
    const onSample = vi.fn();
    const sampler = createChromeMemorySampler({
      getPids: async () => {
        await new Promise((r) => setTimeout(r, 350));
        return { browser: 1, renderers: [], gpu: [] };
      },
      sampleRss: async () => [{ pid: 1, rssMb: 1 }],
      intervalMs: 100,
      onSample,
    });
    sampler.start();
    await vi.advanceTimersByTimeAsync(150);
    sampler.stop();
    let samplesAtClose = -1;
    let onSampleCallsAtClose = -1;
    const closing = sampler.sampleOnce().then(() => {
      samplesAtClose = sampler.stats().samples;
      onSampleCallsAtClose = onSample.mock.calls.length;
    });
    await vi.advanceTimersByTimeAsync(1000);
    await closing;
    expect(samplesAtClose).toBe(1);
    expect(onSampleCallsAtClose).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSample).toHaveBeenCalledTimes(1);
  });

  it("does not invoke onSample when a sample returned no rows", async () => {
    const onSample = vi.fn();
    const sampler = createChromeMemorySampler({
      getPids: async () => ({ browser: 1, renderers: [], gpu: [] }),
      sampleRss: async () => [],
      intervalMs: 100,
      onSample,
    });
    await sampler.sampleOnce();
    expect(onSample).not.toHaveBeenCalled();
    expect(sampler.stats()).toEqual(empty);
  });

  it("unrefs the interval so a forgotten stop() cannot hold the process open", () => {
    // Real timers: a real NodeJS.Timeout reports hasRef(); the interval is far
    // enough out that no tick fires during the test.
    let handle: NodeJS.Timeout | undefined;
    const sampler = createChromeMemorySampler({
      getPids: async () => ({ browser: 1, renderers: [], gpu: [] }),
      sampleRss: async () => [{ pid: 1, rssMb: 1 }],
      intervalMs: 60_000,
      setIntervalFn: (callback, ms) => {
        handle = setInterval(callback, ms);
        return handle;
      },
    });
    sampler.start();
    if (handle === undefined) throw new Error("start() did not schedule an interval");
    const refed = handle.hasRef();
    sampler.stop();
    expect(refed).toBe(false);
  });

  it("start() twice schedules a single interval; stop() is safe before start and twice", async () => {
    vi.useFakeTimers();
    const sampler = createChromeMemorySampler({
      getPids: async () => ({ browser: 1, renderers: [], gpu: [] }),
      sampleRss: async () => [{ pid: 1, rssMb: 1 }],
      intervalMs: 100,
    });
    sampler.stop();
    sampler.start();
    sampler.start();
    await vi.advanceTimersByTimeAsync(250);
    sampler.stop();
    sampler.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(sampler.stats().samples).toBe(2);
  });
});
