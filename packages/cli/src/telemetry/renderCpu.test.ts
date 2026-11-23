import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const osState = vi.hoisted(() => ({
  readings: [] as { busy: number; idle: number }[][],
  cpuReads: 0,
  loads: [] as number[],
  platform: "linux",
}));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  cpus: () => {
    const cores = osState.readings[osState.cpuReads++] ?? [];
    return cores.map(({ busy, idle }) => ({
      model: "test",
      speed: 1,
      times: { user: busy, nice: 0, sys: 0, idle, irq: 0 },
    }));
  },
  loadavg: () => [osState.loads.shift() ?? 0, 0, 0],
  platform: () => osState.platform,
}));

const trackingState = vi.hoisted(() => ({ shouldTrack: true }));
vi.mock("./client.js", () => ({ shouldTrack: () => trackingState.shouldTrack }));

const { startRenderCpuSampler, SAMPLE_INTERVAL_MS } = await import("./renderCpu.js");

// Cumulative per-core times for two cores: start, two interval samples, stop.
// Windows: 90% (both cores busy), 30%, then 50% (one core busy). Start to end: 3400/6000.
const READINGS = [
  [
    { busy: 0, idle: 0 },
    { busy: 0, idle: 0 },
  ],
  [
    { busy: 900, idle: 100 },
    { busy: 900, idle: 100 },
  ],
  [
    { busy: 1200, idle: 800 },
    { busy: 1200, idle: 800 },
  ],
  [
    { busy: 2100, idle: 900 },
    { busy: 1300, idle: 1700 },
  ],
];

describe("startRenderCpuSampler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    osState.readings = READINGS;
    osState.cpuReads = 0;
    osState.loads = [1.234, 3.456];
    osState.platform = "linux";
    trackingState.shouldTrack = true;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports the render's average, its busiest sample window, and load at start and end", () => {
    const sampler = startRenderCpuSampler();
    vi.advanceTimersByTime(SAMPLE_INTERVAL_MS * 2);

    expect(sampler.stop()).toEqual({
      cpuBusyAvgPct: 57,
      cpuBusyPeakPct: 90,
      cpuCoresBusyPeak: 2,
      loadAvgStart: 1.23,
      loadAvgEnd: 3.46,
    });
  });

  it("clears its interval on stop and returns the first result on a repeat stop", () => {
    const sampler = startRenderCpuSampler();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(SAMPLE_INTERVAL_MS * 2);
    const first = sampler.stop();

    expect(vi.getTimerCount()).toBe(0);
    expect(sampler.stop()).toBe(first);
    expect(osState.cpuReads).toBe(4);
  });

  it("measures a render shorter than one sample window from its start and end", () => {
    osState.readings = [READINGS[0]!, READINGS[3]!];
    const sampler = startRenderCpuSampler();

    expect(sampler.stop()).toMatchObject({
      cpuBusyAvgPct: 57,
      cpuBusyPeakPct: 57,
      cpuCoresBusyPeak: 0,
    });
  });

  it("leaves load average out on Windows, where Node always reports 0", () => {
    osState.platform = "win32";
    const usage = startRenderCpuSampler().stop();

    expect(usage.loadAvgStart).toBeUndefined();
    expect(usage.loadAvgEnd).toBeUndefined();
  });

  it.each([
    ["telemetry is off", false, true],
    ["the requester opted out", true, false],
  ])("samples nothing when %s", (_label, tracking, requesterOptedIn) => {
    trackingState.shouldTrack = tracking;
    const sampler = startRenderCpuSampler(requesterOptedIn);

    expect(vi.getTimerCount()).toBe(0);
    expect(sampler.stop()).toEqual({});
    expect(osState.cpuReads).toBe(0);
  });
});
