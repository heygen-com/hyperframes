import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeAudio, probeAudio } from "./decode.js";
import { analyzeTargets } from "./run.js";

vi.mock("./decode.js", () => ({ decodeAudio: vi.fn(), probeAudio: vi.fn() }));
const dir = mkdtempSync(join(tmpdir(), "hf-kind-run-"));
const path = join(dir, "source.wav");
const stream = { sampleRate: 48000, channels: 2, duration: 1200, audioStream: 0 };
const signal = { sampleRate: 8000, channels: [new Float32Array(8000)] };
const target = {
  path,
  file: "source.wav",
  kind: "audio" as const,
  ref: "#music",
  placement: null,
  window: { from: 30, seconds: 1 },
  clip: { from: 0, seconds: 1200 },
};
const request = { capabilities: ["kind", "moments"] as const, quality: "fast" as const };
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  vi.resetAllMocks();
  writeFileSync(path, "source");
  vi.mocked(probeAudio).mockResolvedValue(stream);
  vi.mocked(decodeAudio).mockResolvedValue({ signal, stream });
});

describe("clip kind isolation", () => {
  it("decodes long clip kind at a reduced rate without changing the window decode", async () => {
    await analyzeTargets([target], request);
    expect(decodeAudio).toHaveBeenNthCalledWith(
      1,
      path,
      { from: 29.9, seconds: expect.closeTo(1.2) },
      stream,
    );
    expect(decodeAudio).toHaveBeenNthCalledWith(2, path, target.clip, stream, {
      sampleRate: 16000,
    });
  });

  it("reuses the native-rate window signal when it covers the whole clip", async () => {
    const whole = { ...target, window: target.clip };
    await analyzeTargets([whole], request);
    expect(decodeAudio).toHaveBeenCalledTimes(1);
  });

  it("keeps the native rate for clip evidence that fits the budget", async () => {
    const short = { ...target, clip: { from: 0, seconds: 60 } };
    await analyzeTargets([short], request);
    expect(decodeAudio).toHaveBeenNthCalledWith(2, path, short.clip, stream, { sampleRate: 48000 });
  });

  it("does not attempt an oversized whole-clip decode", async () => {
    vi.mocked(probeAudio).mockResolvedValue({ ...stream, duration: 86400 });
    const oversized = { ...target, clip: { from: 0, seconds: 86400 } };
    const [item] = (await analyzeTargets([oversized], request)).items;
    expect(decodeAudio).toHaveBeenCalledTimes(1);
    expect(item?.error).toBeUndefined();
    expect(item?.moments).toBeNull();
    expect(item?.warnings[0]).toMatch(/kind analysis decode limit/);
  });

  it("keeps the window measurements and warns when full-clip decoding exceeds its limit", async () => {
    vi.mocked(decodeAudio)
      .mockResolvedValueOnce({ signal, stream })
      .mockRejectedValueOnce(new Error("stdout maxBuffer exceeded"));
    const [item] = (await analyzeTargets([target], request, true)).items;
    expect(item?.error).toBeUndefined();
    expect(item?.moments).toBeNull();
    expect(item?.kind).toMatchObject({ value: "sfx" });
    expect(item?.ladder?.kind).toEqual([{ provider: "signal", outcome: "answered" }]);
    expect(item?.warnings).toEqual([
      "kind uses only the selected range: could not analyze the whole clip (stdout maxBuffer exceeded)",
    ]);
  });

  it("reuses kind across calls and ranges, but invalidates media, trim and provider changes", async () => {
    const cache = join(dir, "cache");
    const first = await analyzeTargets([target], request, true, cache);
    const next = await analyzeTargets(
      [{ ...target, window: { from: 40, seconds: 1 } }],
      request,
      true,
      cache,
    );
    expect(decodeAudio).toHaveBeenCalledTimes(3);
    expect(next.items[0]?.kind).toEqual(first.items[0]?.kind);
    expect(next.items[0]?.ladder).toEqual(first.items[0]?.ladder);
    writeFileSync(path, "changed source");
    await analyzeTargets([target], request, false, cache);
    expect(decodeAudio).toHaveBeenCalledTimes(5);
    await analyzeTargets([{ ...target, clip: { from: 1, seconds: 1199 } }], request, false, cache);
    expect(decodeAudio).toHaveBeenCalledTimes(7);
    const pinned = await analyzeTargets(
      [target],
      { ...request, provider: { kind: "missing" } },
      true,
      cache,
    );
    expect(pinned.items[0]?.kind).toBeNull();
    expect(pinned.items[0]?.warnings.length).toBeGreaterThan(0);
  });

  it("does not cache a reused full-window signal under a source changed during decode", async () => {
    const cache = join(dir, "changed-full-decode");
    vi.mocked(decodeAudio).mockImplementationOnce(async () => {
      writeFileSync(path, "source replaced while decoding full window");
      return { signal, stream };
    });
    await analyzeTargets([{ ...target, window: target.clip }], request, false, cache);
    expect(existsSync(cache)).toBe(false);
  });

  it("does not cache evidence if the source changes during its decode", async () => {
    const cache = join(dir, "changed-during-decode");
    vi.mocked(decodeAudio)
      .mockResolvedValueOnce({ signal, stream })
      .mockImplementationOnce(async () => {
        writeFileSync(path, "new source while decoding");
        return { signal, stream };
      });
    await analyzeTargets([target], request, false, cache);
    await analyzeTargets([target], request, false, cache);
    expect(decodeAudio).toHaveBeenCalledTimes(4);
  });

  it("does not cache a failed full-clip attempt as the whole clip's kind", async () => {
    const cache = join(dir, "retry-cache");
    vi.mocked(decodeAudio)
      .mockResolvedValueOnce({ signal, stream })
      .mockRejectedValueOnce(new Error("decode failed"));
    await analyzeTargets([target], request, false, cache);
    await analyzeTargets([target], request, false, cache);
    expect(decodeAudio).toHaveBeenCalledTimes(4);
  });
});
