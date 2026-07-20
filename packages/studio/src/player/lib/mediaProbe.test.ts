// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMediaProbeDiagnostics, probeMediaUrl, resetMediaProbeRegistry } from "./mediaProbe";

const dispose = vi.fn();
const getDurationFromMetadata = vi.fn(async () => 5);

vi.mock("mediabunny", () => ({
  ALL_FORMATS: {},
  UrlSource: class {
    constructor(readonly url: string) {}
  },
  Input: class {
    getDurationFromMetadata = getDurationFromMetadata;
    getPrimaryVideoTrack = vi.fn(async () => ({ displayWidth: 640, displayHeight: 360 }));
    getAudioTracks = vi.fn(async () => []);
    dispose = dispose;
  },
}));

beforeEach(() => {
  resetMediaProbeRegistry();
  vi.clearAllMocks();
  getDurationFromMetadata.mockResolvedValue(5);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("media probe registry", () => {
  it("deduplicates and caches successful probes", async () => {
    const [first, second] = await Promise.all([
      probeMediaUrl("/video.mp4"),
      probeMediaUrl("/video.mp4"),
    ]);
    expect(first).toEqual(second);
    expect(getDurationFromMetadata).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(getMediaProbeDiagnostics()).toEqual({ cached: 1, failed: 0, inflight: 0 });
  });

  it("bounds retained successes to the configured registry count", async () => {
    for (let index = 0; index < 513; index++) {
      await probeMediaUrl(`/video-${index}.mp4`);
    }
    expect(getMediaProbeDiagnostics().cached).toBe(512);
  });

  it("limits concurrent metadata probes and drains the queue", async () => {
    const resolvers: Array<(duration: number) => void> = [];
    getDurationFromMetadata.mockImplementation(
      () => new Promise<number>((resolve) => resolvers.push(resolve)),
    );

    const probes = Array.from({ length: 5 }, (_, index) => probeMediaUrl(`/queued-${index}.mp4`));
    await Promise.resolve();
    await Promise.resolve();
    expect(getDurationFromMetadata).toHaveBeenCalledTimes(4);

    resolvers[0]?.(5);
    await vi.waitFor(() => expect(getDurationFromMetadata).toHaveBeenCalledTimes(5));

    for (const resolve of resolvers.slice(1)) resolve(5);
    await expect(Promise.all(probes)).resolves.toHaveLength(5);
    expect(getMediaProbeDiagnostics()).toEqual({ cached: 5, failed: 0, inflight: 0 });
  });

  it("retries failures only after the failure TTL", async () => {
    vi.useFakeTimers();
    getDurationFromMetadata.mockRejectedValue(new Error("bad source"));
    await expect(probeMediaUrl("/bad.mp4")).resolves.toBeNull();
    await expect(probeMediaUrl("/bad.mp4")).resolves.toBeNull();
    expect(getDurationFromMetadata).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_001);
    await expect(probeMediaUrl("/bad.mp4")).resolves.toBeNull();
    expect(getDurationFromMetadata).toHaveBeenCalledTimes(2);
  });
});
