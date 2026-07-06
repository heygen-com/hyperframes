import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// The mix filter graph is written to a temp file and passed via
// -filter_complex_script (not inlined via -filter_complex) so the command
// line doesn't scale with track count — production code deletes that file
// the moment the (real) ffmpeg process exits. The mock captures each call's
// filter content synchronously, while the file still exists, into an
// index-aligned side array (rather than re-reading it from disk after
// processCompositionAudio resolves, by which point it's already gone).
const { runFfmpegMock, capturedFilterScripts } = vi.hoisted(() => {
  const capturedFilterScripts: string[] = [];
  return {
    capturedFilterScripts,
    runFfmpegMock: vi.fn(async (args: string[]) => {
      const idx = args.indexOf("-filter_complex_script");
      if (idx >= 0) {
        const { readFileSync } = await import("node:fs");
        capturedFilterScripts.push(readFileSync(args[idx + 1], "utf8"));
      } else {
        capturedFilterScripts.push("");
      }
      return { success: true, durationMs: 1, stderr: "", exitCode: 0 };
    }),
  };
});

vi.mock("../utils/runFfmpeg.js", () => ({
  runFfmpeg: runFfmpegMock,
}));

import { processCompositionAudio } from "./audioMixer.js";

describe("processCompositionAudio", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    runFfmpegMock.mockClear();
    capturedFilterScripts.length = 0;
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves muted tracks and uses unity master gain by default", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);

    writeFileSync(join(baseDir, "voice.wav"), "stub");

    const result = await processCompositionAudio(
      [
        {
          id: "voice",
          src: "voice.wav",
          start: 0,
          end: 2,
          mediaStart: 0,
          layer: 0,
          volume: 0,
          type: "audio",
        },
      ],
      baseDir,
      workDir,
      join(baseDir, "out.m4a"),
      2,
    );

    expect(result.success).toBe(true);
    expect(runFfmpegMock).toHaveBeenCalledTimes(2);

    const filter = capturedFilterScripts[1];

    expect(filter).toContain("volume=0");
    expect(filter).toContain("[mixed]volume=1[out]");
    expect(filter).not.toContain("normalize=");
    expect(filter).not.toContain("weights=");
  });

  it("compensates amix normalization so multi-track master gain equals track count", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);

    writeFileSync(join(baseDir, "a.wav"), "stub");
    writeFileSync(join(baseDir, "b.wav"), "stub");
    writeFileSync(join(baseDir, "c.wav"), "stub");

    const result = await processCompositionAudio(
      [
        {
          id: "a",
          src: "a.wav",
          start: 0,
          end: 2,
          mediaStart: 0,
          layer: 0,
          volume: 0.8,
          type: "audio",
        },
        {
          id: "b",
          src: "b.wav",
          start: 0,
          end: 2,
          mediaStart: 0,
          layer: 1,
          volume: 1,
          type: "audio",
        },
        {
          id: "c",
          src: "c.wav",
          start: 0,
          end: 2,
          mediaStart: 0,
          layer: 2,
          volume: 0.5,
          type: "audio",
        },
      ],
      baseDir,
      workDir,
      join(baseDir, "out.m4a"),
      2,
    );

    expect(result.success).toBe(true);
    // 3 prepare calls (one per track via Promise.all) precede the mix call,
    // so the mix is at index 3, not index 1.
    expect(runFfmpegMock).toHaveBeenCalledTimes(4);
    const filter = capturedFilterScripts[3];

    expect(filter).toContain("amix=inputs=3");
    expect(filter).not.toContain("normalize=");
    // masterOutputGain(1) × tracks(3) = 3
    expect(filter).toContain("[mixed]volume=3[out]");
  });

  it("uses frame-evaluated volume automation when keyframes are present", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);

    writeFileSync(join(baseDir, "voice.wav"), "stub");

    const result = await processCompositionAudio(
      [
        {
          id: "voice",
          src: "voice.wav",
          start: 2,
          end: 5,
          mediaStart: 0,
          layer: 0,
          volume: 0,
          volumeKeyframes: [
            { time: 2, volume: 0 },
            { time: 3, volume: 1 },
            { time: 5, volume: 0.5 },
          ],
          type: "audio",
        },
      ],
      baseDir,
      workDir,
      join(baseDir, "out.m4a"),
      5,
    );

    expect(result.success).toBe(true);

    const filter = capturedFilterScripts[1];

    expect(filter).toContain("volume=");
    expect(filter).toContain(":eval=frame");
    expect(filter).toContain("lt(t\\,1)");
    expect(filter).toContain("adelay=2000|2000");
  });

  it("bounds expression nesting for dense keyframe automation without dropping the envelope", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);

    writeFileSync(join(baseDir, "bgm.wav"), "stub");

    // Mirrors the 60 Hz timeline probe: a 10s eased fade emits hundreds of
    // keyframes. The nested-if volume expression must not grow one level per
    // keyframe — past ~95 levels FFmpeg fails filter-graph init and the audio
    // track is dropped entirely (GH #1066 follow-up).
    const keyframes = Array.from({ length: 300 }, (_, i) => {
      const time = (i / 299) * 10;
      const volume =
        time < 3 ? 0.8 * (time / 3) ** 2 : time < 7 ? 0.8 : 0.8 * (1 - (time - 7) / 3) ** 2;
      return { time, volume };
    });

    const result = await processCompositionAudio(
      [
        {
          id: "bgm",
          src: "bgm.wav",
          start: 0,
          end: 10,
          mediaStart: 0,
          layer: 0,
          volume: 0,
          volumeKeyframes: keyframes,
          type: "audio",
        },
      ],
      baseDir,
      workDir,
      join(baseDir, "out.m4a"),
      10,
    );

    expect(result.success).toBe(true);

    const filter = capturedFilterScripts[1];

    // One nested `if(lt(...))` is emitted per segment; cap it well under the
    // FFmpeg evaluator's nesting limit (MAX_VOLUME_SEGMENTS = 32).
    const nestingDepth = (filter.match(/if\(lt\(t/g) ?? []).length;
    expect(nestingDepth).toBeGreaterThan(1);
    expect(nestingDepth).toBeLessThan(32);

    // The simplified envelope still spans the clip: silent start, audible peak.
    expect(filter).toContain(":eval=frame");
    expect(filter).toMatch(/volume=if\(lt\(t\\,[0-9.]+\)\\,0\+/);
  });

  it("falls back to a static-volume mix instead of dropping audio when the automated mix fails", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);

    writeFileSync(join(baseDir, "bgm.wav"), "stub");

    // Simulate an ffmpeg build that rejects the automation expression: the
    // first mix attempt fails, the static-volume retry succeeds. (prepare =
    // call 0, automated mix = call 1, fallback mix = call 2.) These two
    // one-time overrides bypass the default mock's capturedFilterScripts
    // push, so they push an empty placeholder themselves to keep the array
    // index-aligned with call order for the fallback mix's assertion below.
    runFfmpegMock
      .mockImplementationOnce(async () => {
        capturedFilterScripts.push("");
        return { success: true, durationMs: 1, stderr: "", exitCode: 0 };
      })
      .mockImplementationOnce(async () => {
        capturedFilterScripts.push("");
        return {
          success: false,
          durationMs: 1,
          stderr: "Error initializing filters",
          exitCode: 234,
        };
      });

    const result = await processCompositionAudio(
      [
        {
          id: "bgm",
          src: "bgm.wav",
          start: 0,
          end: 5,
          mediaStart: 0,
          layer: 0,
          volume: 0.8,
          volumeKeyframes: [
            { time: 0, volume: 0.8 },
            { time: 5, volume: 0 },
          ],
          type: "audio",
        },
      ],
      baseDir,
      workDir,
      join(baseDir, "out.m4a"),
      5,
    );

    expect(result.success).toBe(true);
    expect(result.tracksProcessed).toBe(1);
    expect(runFfmpegMock).toHaveBeenCalledTimes(3);
    // Degradation is surfaced, not silent — the track rendered at base volume.
    expect(result.error).toMatch(/base volume/i);

    // The fallback mix omits the automation expression (base volume only).
    const fallbackFilter = capturedFilterScripts[2];
    expect(fallbackFilter).not.toContain(":eval=frame");
    expect(fallbackFilter).toContain("volume=0.8");
  });

  it("keeps the ffmpeg command line short with a large track count (regression for spawn ENAMETOOLONG)", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);

    // Reported in the wild at 146 timed audio clips: the old inline
    // -filter_complex string scaled with track count and blew past the OS
    // command-line length limit. 150 tracks reproduces the same shape.
    const trackCount = 150;
    const elements = Array.from({ length: trackCount }, (_, i) => {
      const filename = `clip-${i}.wav`;
      writeFileSync(join(baseDir, filename), "stub");
      return {
        id: `clip-${i}`,
        src: filename,
        start: i * 0.1,
        end: i * 0.1 + 0.5,
        mediaStart: 0,
        layer: i,
        volume: 1,
        type: "audio" as const,
      };
    });

    const result = await processCompositionAudio(
      elements,
      baseDir,
      workDir,
      join(baseDir, "out.m4a"),
      trackCount * 0.1 + 0.5,
    );

    expect(result.success).toBe(true);
    expect(result.tracksProcessed).toBe(trackCount);

    const mixArgs = runFfmpegMock.mock.calls.at(-1)?.[0] as string[];
    expect(mixArgs).toContain("-filter_complex_script");
    expect(mixArgs).not.toContain("-filter_complex");

    // The only things that scale with track count are the -i pairs (short,
    // fixed-size each) and the filter SCRIPT FILE's content (off the command
    // line entirely) — not the args array's own total character length.
    const argsLength = mixArgs.join(" ").length;
    expect(argsLength).toBeLessThan(20_000);

    const filter = capturedFilterScripts.at(-1);
    expect(filter).toContain(`amix=inputs=${trackCount}`);
    expect((filter?.match(/atrim=/g) ?? []).length).toBe(trackCount);
  });

  it("prepares percent-encoded non-Latin audio srcs from decoded filesystem paths", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);

    const encodedFilename =
      "%D9%87%D9%86%D8%A7%20%D9%85%D8%B1%D9%88%D8%A7%20-%20%D9%85%D8%A8%D8%A7%D8%B1%D9%83.mp4";
    const filename = decodeURIComponent(encodedFilename);
    mkdirSync(join(baseDir, "assets"), { recursive: true });
    writeFileSync(join(baseDir, "assets", filename), "stub");

    const result = await processCompositionAudio(
      [
        {
          id: "voice",
          src: `assets/${encodedFilename}`,
          start: 0,
          end: 2,
          mediaStart: 0,
          layer: 0,
          volume: 1,
          type: "audio",
        },
      ],
      baseDir,
      workDir,
      join(baseDir, "out.m4a"),
      2,
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(runFfmpegMock).toHaveBeenCalledTimes(2);

    const prepareArgs = runFfmpegMock.mock.calls[0]?.[0];
    expect(prepareArgs).toContain(join(baseDir, "assets", filename));
  });
});
