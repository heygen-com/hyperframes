// fallow-ignore-file code-duplication
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// The mix filter graph is written to a temp file and passed via
// a file-valued filter option (not inlined via -filter_complex) so the command
// line doesn't scale with track count — production code deletes that file
// the moment the (real) ffmpeg process exits. The mock captures each call's
// filter content synchronously, while the file still exists, into an
// index-aligned side array (rather than re-reading it from disk after
// processCompositionAudio resolves, by which point it's already gone).
const { runFfmpegMock, capturedFilterScripts, extractAudioMetadataMock } = vi.hoisted(() => {
  const capturedFilterScripts: string[] = [];
  return {
    capturedFilterScripts,
    extractAudioMetadataMock: vi.fn(async () => ({
      durationSeconds: 2,
      sampleRate: 48_000,
      channels: 2,
      audioCodec: "aac",
    })),
    runFfmpegMock: vi.fn(async (args: string[]) => {
      const legacyIdx = args.indexOf("-filter_complex_script");
      const currentIdx = args.indexOf("-/filter_complex");
      const idx = legacyIdx >= 0 ? legacyIdx : currentIdx;
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

vi.mock("../utils/runFfmpeg.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/runFfmpeg.js")>();
  return { ...actual, runFfmpeg: runFfmpegMock };
});

// The FX render drives a headless browser; the mix only needs to know the
// processed file exists and how long a tail the chain asked for.
const { applyAudioFxChainMock } = vi.hoisted(() => ({
  applyAudioFxChainMock: vi.fn(
    async (_src: string, _chain: unknown, outPath: string, options?: { envelope?: unknown }) => {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(outPath, "stub");
      // The real one bakes the volume envelope into its float output, so the
      // mixer must not run its own pass afterwards.
      return { path: outPath, envelopeBaked: Boolean(options?.envelope) };
    },
  ),
}));

vi.mock("./audioFxRender.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./audioFxRender.js")>();
  return { ...actual, applyAudioFxChain: applyAudioFxChainMock };
});

vi.mock("../utils/ffprobe.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/ffprobe.js")>();
  return { ...actual, extractAudioMetadata: extractAudioMetadataMock };
});

import { parseAudioElements, processCompositionAudio } from "./audioMixer.js";

describe("parseAudioElements strict literal timing", () => {
  it.each(["", "   ", "0s", "0abc", "0px", "-1s", "Infinity", "NaN", "0x10"])(
    "does not drop hand-authored data-duration=%j as an explicit zero window",
    (duration) => {
      expect(
        parseAudioElements(
          `<audio id="a" src="tone.wav" data-start="0" data-duration="${duration}"></audio>`,
        ),
      ).toHaveLength(1);
    },
  );
});

describe("processCompositionAudio", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    runFfmpegMock.mockClear();
    extractAudioMetadataMock.mockReset();
    extractAudioMetadataMock.mockResolvedValue({
      durationSeconds: 2,
      sampleRate: 48_000,
      channels: 2,
      audioCodec: "aac",
    });
    applyAudioFxChainMock.mockClear();
    capturedFilterScripts.length = 0;
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ["compiled EOF", 4, 2],
    ["compiled past EOF", 5, 3],
    ["ordinary explicit zero", 6, 0],
  ])(
    "drops a known zero timeline window without audio prep or mix: %s",
    async (_label, start, mediaStart) => {
      const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
      const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
      tempDirs.push(baseDir, workDir);
      writeFileSync(join(baseDir, "tone.wav"), Buffer.from("RIFF0000WAVEfmt "));
      const elements = parseAudioElements(
        `<div data-composition-id="root" data-start="0" data-duration="10"><audio id="zero-window" src="tone.wav" data-start="${start}" data-duration="0" data-end="${start}" data-media-start="${mediaStart}"></audio></div>`,
      );

      const result = await processCompositionAudio(
        elements,
        baseDir,
        workDir,
        join(baseDir, "out.m4a"),
        10,
      );

      expect(extractAudioMetadataMock).not.toHaveBeenCalled();
      expect(runFfmpegMock).toHaveBeenCalledTimes(1);
      expect(runFfmpegMock.mock.calls[0]?.[0].join(" ")).toContain("anullsrc");
      expect(runFfmpegMock.mock.calls[0]?.[0]).not.toContain(join(baseDir, "tone.wav"));
      expect(elements).toEqual([]);
      expect(result).toMatchObject({ success: true, tracksProcessed: 0 });
    },
  );

  it("classifies an HTML-as-200 audio source as deterministic user input", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("<!doctype html><html><body>denied</body></html>"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await processCompositionAudio(
      [
        {
          id: "remote-voice",
          src: "https://cdn.example/voice",
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.failures).toEqual([
      expect.objectContaining({
        stage: "download",
        owner: "user",
        retryable: false,
      }),
    ]);
  });

  it.each([
    {
      message: "AbortError: ffprobe operation aborted",
      reason: "cancelled",
      owner: "user",
      retryable: false,
    },
    {
      message: "ffprobe timed out after inactivity deadline",
      reason: "ffmpeg_timeout",
      owner: "system",
      retryable: true,
    },
  ] as const)("classifies probe failure '$reason' independently", async (expected) => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);
    writeFileSync(join(baseDir, "voice.wav"), "stub");
    extractAudioMetadataMock.mockRejectedValueOnce(new Error(expected.message));

    const result = await processCompositionAudio(
      [
        {
          id: "voice",
          src: "voice.wav",
          start: 0,
          end: 0,
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

    expect(result.failures).toEqual([
      expect.objectContaining({
        stage: "probe",
        reason: expected.reason,
        owner: expected.owner,
        retryable: expected.retryable,
      }),
    ]);
  });

  // STUDIO-5433: an audio src that resolved to an HTML/XML page (an unresolved
  // nested-composition preview URL, or a 403/404 body served as a 200) skips the
  // probe entirely when the element carries an authored duration, and used to
  // surface as `prepare/ffmpeg_failed` with owner "system" — an authoring bug
  // paged as a platform fault, after every frame had already been captured.
  it("classifies a document audio source as a user-owned invalid media source", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);
    writeFileSync(join(baseDir, "bgm.mp3"), "<!DOCTYPE html><html><body>not audio</body></html>");

    const result = await processCompositionAudio(
      [
        {
          id: "bgm",
          src: "bgm.mp3",
          // Authored duration + loop is the shape that bypasses every probe.
          start: 0,
          end: 30,
          mediaStart: 0,
          layer: 0,
          volume: 1,
          type: "audio",
        },
      ],
      baseDir,
      workDir,
      join(baseDir, "out.m4a"),
      30,
    );

    expect(result.failures).toEqual([
      expect.objectContaining({
        stage: "source",
        reason: "invalid_media",
        owner: "user",
        retryable: false,
        elementId: "bgm",
      }),
    ]);
    // Never reached ffmpeg: the whole point is failing before the work.
    expect(runFfmpegMock).not.toHaveBeenCalled();
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
    expect(filter).toContain("apad,asetpts=N/SR/TB,atrim=0:2");
    expect(filter).not.toContain("whole_dur");
    expect(filter).not.toContain("normalize=");
    expect(filter).not.toContain("weights=");
  });

  it("trims the consumed source span and applies pitch-preserving tempo at 2x", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);
    writeFileSync(join(baseDir, "timecode.wav"), "stub");

    const result = await processCompositionAudio(
      [
        {
          id: "timecode",
          src: "timecode.wav",
          start: 0,
          end: 2,
          mediaStart: 1,
          playbackRate: 2,
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
    const prepareArgs = runFfmpegMock.mock.calls[0]?.[0] ?? [];
    expect(prepareArgs).toEqual(expect.arrayContaining(["-ss", "1", "-t", "4", "-af", "atempo=2"]));
    expect(prepareArgs.filter((arg) => arg === "-t")).toHaveLength(2);
    expect(prepareArgs.at(-3)).toBe("2");
  });

  it.each([
    { rate: 0.1, filter: "atempo=0.5,atempo=0.5,atempo=0.5,atempo=0.8" },
    { rate: 5, filter: "atempo=2,atempo=2,atempo=1.25" },
  ])("builds a bounded atempo chain for normalized rate $rate", async ({ rate, filter }) => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);
    writeFileSync(join(baseDir, "timecode.wav"), "stub");

    await processCompositionAudio(
      [
        {
          id: "timecode",
          src: "timecode.wav",
          start: 0,
          end: 2,
          mediaStart: 0,
          playbackRate: rate,
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

    expect(runFfmpegMock.mock.calls[0]?.[0]).toEqual(expect.arrayContaining(["-af", filter]));
  });

  it("keeps automation on authored timeline time after constant retiming", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);
    writeFileSync(join(baseDir, "timecode.wav"), "stub");
    const automation = JSON.stringify({
      version: 1,
      lanes: [
        {
          target: "volume",
          points: [
            { t: 0, v: 0 },
            { t: 2, v: 1 },
          ],
        },
      ],
    });
    const fxChain = JSON.stringify({
      version: 1,
      nodes: [{ type: "gain", id: "gain", params: { gain: 1 } }],
    });

    await processCompositionAudio(
      [
        {
          id: "timecode",
          src: "timecode.wav",
          start: 0,
          end: 2,
          mediaStart: 0,
          playbackRate: 2,
          layer: 0,
          volume: 1,
          automation,
          fxChain,
          type: "audio",
        },
      ],
      baseDir,
      workDir,
      join(baseDir, "out.m4a"),
      2,
    );

    expect(runFfmpegMock.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining(["-t", "4", "-af", "atempo=2"]),
    );
    expect(applyAudioFxChainMock.mock.calls[0]?.[3]).toMatchObject({
      envelope: {
        keyframes: [
          { time: 0, volume: 0 },
          { time: 2, volume: 1 },
        ],
        trackStart: 0,
      },
    });
  });

  it("lets an FX tail run past the clip, still bounded by the composition", async () => {
    // A reverb is still decaying when the clip's own audio stops. Trimming at
    // the clip boundary is what cut every tail short in the render.
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);
    writeFileSync(join(baseDir, "bed.wav"), "stub");

    const result = await processCompositionAudio(
      [
        {
          id: "bed",
          src: "bed.wav",
          start: 0,
          end: 2,
          mediaStart: 0,
          layer: 0,
          volume: 1,
          type: "audio",
          fxChain: JSON.stringify({
            version: 1,
            nodes: [
              { type: "reverb", id: "r", params: { size: 0.5, damping: 0.5, wet: 0.4, dry: 0.7 } },
            ],
          }),
        },
      ],
      baseDir,
      workDir,
      join(baseDir, "out.m4a"),
      8,
    );

    expect(result.success).toBe(true);
    expect(applyAudioFxChainMock).toHaveBeenCalledTimes(1);
    const filter = capturedFilterScripts[capturedFilterScripts.length - 1];
    // 2 s clip + the 1.9 s tail 0.6 + size * 2.6 generates.
    expect(filter).toContain("atrim=0:3.9,");
    // And still cut at the composition's end, so a tail cannot extend the video.
    expect(filter).toContain("apad,asetpts=N/SR/TB,atrim=0:8");
  });

  it("hands the volume envelope to the FX pass instead of ducking the file after it", async () => {
    // The FX pass writes 16-bit PCM, so a chain that overshoots full scale is
    // clipped there. Ducking afterwards bakes that distortion in even though
    // the lane pulls the track well down; the envelope has to travel into the
    // FX pass and land on its float output.
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
          volume: 0.4,
          volumeKeyframes: [
            { time: 2, volume: 1 },
            { time: 5, volume: 0.25 },
          ],
          type: "audio",
          fxChain: JSON.stringify({
            version: 1,
            nodes: [{ type: "peaking", id: "p", params: { frequency: 440, gain: 12, q: 1 } }],
          }),
        },
      ],
      baseDir,
      workDir,
      join(baseDir, "out.m4a"),
      5,
    );

    expect(result.success).toBe(true);
    expect(applyAudioFxChainMock).toHaveBeenCalledTimes(1);
    expect(applyAudioFxChainMock.mock.calls[0]?.[3]).toMatchObject({
      envelope: {
        keyframes: [
          { time: 2, volume: 1 },
          { time: 5, volume: 0.25 },
        ],
        trackStart: 2,
        baseVolume: 0.4,
      },
    });

    // And the mixer trusts that bake: unity gain, no second pass, no ffmpeg
    // volume expression re-applying the same envelope on top of it.
    const filter = capturedFilterScripts[capturedFilterScripts.length - 1];
    expect(filter).not.toContain(":eval=frame");
  });

  it("cuts at the clip boundary when the chain has no tail", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);
    writeFileSync(join(baseDir, "bed.wav"), "stub");

    await processCompositionAudio(
      [
        {
          id: "bed",
          src: "bed.wav",
          start: 0,
          end: 2,
          mediaStart: 0,
          layer: 0,
          volume: 1,
          type: "audio",
          fxChain: JSON.stringify({
            version: 1,
            nodes: [{ type: "peaking", id: "n1", params: { frequency: 900, gain: -6, q: 1 } }],
          }),
        },
      ],
      baseDir,
      workDir,
      join(baseDir, "out.m4a"),
      8,
    );

    const filter = capturedFilterScripts[capturedFilterScripts.length - 1];
    expect(filter).toContain("atrim=0:2,");
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

  it("fails the audio result instead of silently mixing after one track preparation fails", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);

    writeFileSync(join(baseDir, "working.wav"), "stub");
    writeFileSync(join(baseDir, "missing-cue.wav"), "stub");

    const defaultImplementation = runFfmpegMock.getMockImplementation()!;
    runFfmpegMock.mockImplementation(async (args: string[]) => {
      const isMissingCuePrepare = args.includes(join(baseDir, "missing-cue.wav"));
      return {
        success: !isMissingCuePrepare,
        durationMs: 1,
        stderr: isMissingCuePrepare
          ? "https://media.example.test/private.wav?token=secret /tmp/hf/private secret.wav: Invalid data found when processing input"
          : "",
        exitCode: isMissingCuePrepare ? 1 : 0,
      };
    });

    const result = await processCompositionAudio(
      [
        {
          id: "working",
          src: "working.wav",
          start: 0,
          end: 0.5,
          mediaStart: 0,
          layer: 0,
          volume: 1,
          type: "audio",
        },
        {
          id: "missing-cue",
          src: "missing-cue.wav",
          start: 3.859,
          end: 4.359,
          mediaStart: 0,
          layer: 1,
          volume: 1,
          type: "audio",
        },
      ],
      baseDir,
      workDir,
      join(baseDir, "out.m4a"),
      5,
    );
    runFfmpegMock.mockImplementation(defaultImplementation);

    expect(result.success).toBe(false);
    expect(result.tracksProcessed).toBe(1);
    expect(result.error).toContain("Invalid data found when processing input");
    expect(result.error).toContain("<redacted-url>");
    expect(result.error).toContain("<redacted-path>");
    expect(result.error).not.toContain("token=secret");
    expect(result.error).not.toContain("/tmp/hf/private");
    expect(result.error).not.toContain("secret.wav");
    expect(result.failures).toEqual([
      expect.objectContaining({
        stage: "prepare",
        reason: "invalid_media",
        owner: "user",
        retryable: false,
        elementId: "missing-cue",
      }),
    ]);
    expect(runFfmpegMock).toHaveBeenCalledTimes(2);
  });

  it("preserves and classifies unsupported FFmpeg filter failures", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);
    writeFileSync(join(baseDir, "voice.wav"), "stub");

    runFfmpegMock
      .mockResolvedValueOnce({
        success: true,
        durationMs: 1,
        stderr: "",
        exitCode: 0,
        terminationReason: "exit",
      })
      .mockResolvedValueOnce({
        success: false,
        durationMs: 1,
        stderr: "Error applying option 'whole_dur': Option not found",
        exitCode: 8,
        terminationReason: "exit",
      });

    const result = await processCompositionAudio(
      [
        {
          id: "voice",
          src: "voice.wav",
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

    expect(result.success).toBe(false);
    expect(result.error).toContain("Option not found");
    expect(result.failures).toEqual([
      expect.objectContaining({
        stage: "mix",
        reason: "ffmpeg_unsupported",
        owner: "system",
        retryable: false,
      }),
    ]);
  });

  it("preserves a sanitized FFmpeg spawn failure cause", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);
    writeFileSync(join(baseDir, "voice.wav"), "stub");

    runFfmpegMock.mockResolvedValueOnce({
      success: false,
      durationMs: 1,
      stderr: "",
      exitCode: null,
      terminationReason: "spawn_error",
      error: new Error("spawn C:\\private\\ffmpeg.exe ENOENT"),
    });

    const result = await processCompositionAudio(
      [
        {
          id: "voice",
          src: "voice.wav",
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

    expect(result.success).toBe(false);
    expect(result.error).toContain("ENOENT");
    expect(result.error).toContain("<redacted-path>");
    expect(result.error).not.toContain("C:\\private\\ffmpeg.exe");
    expect(result.failures).toEqual([
      expect.objectContaining({
        stage: "prepare",
        reason: "ffmpeg_unavailable",
        owner: "system",
        retryable: true,
      }),
    ]);
  });

  it("keeps invalid data from producer-generated mix inputs system-owned", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);
    writeFileSync(join(baseDir, "voice.wav"), "stub");

    runFfmpegMock
      .mockResolvedValueOnce({
        success: true,
        durationMs: 1,
        stderr: "",
        exitCode: 0,
        terminationReason: "exit",
      })
      .mockResolvedValueOnce({
        success: false,
        durationMs: 1,
        stderr: "Invalid data found when processing input",
        exitCode: 1,
        terminationReason: "exit",
      });

    const result = await processCompositionAudio(
      [
        {
          id: "voice",
          src: "voice.wav",
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

    expect(result.failures).toEqual([
      expect.objectContaining({
        stage: "mix",
        reason: "ffmpeg_failed",
        owner: "system",
        retryable: false,
      }),
    ]);
  });

  it("bounds per-cause details and the aggregate error across many authored IDs", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);
    const oversizedId = "authored-id-".repeat(300);

    const result = await processCompositionAudio(
      Array.from({ length: 3 }, (_, index) => ({
        id: `${oversizedId}-${index}`,
        src: `missing-${index}.wav`,
        start: 0,
        end: 2,
        mediaStart: 0,
        layer: index,
        volume: 1,
        type: "audio" as const,
      })),
      baseDir,
      workDir,
      join(baseDir, "out.m4a"),
      2,
    );

    expect(result.success).toBe(false);
    expect(result.error?.length).toBeLessThanOrEqual(2_000);
    expect(result.failures).toHaveLength(3);
    expect(result.failures?.every((failure) => failure.detail.length <= 2_000)).toBe(true);
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
    // Each track is trimmed once to its authored clip and once after portable
    // indefinite `apad` to cap the padded stream at composition duration.
    expect((filter?.match(/atrim=/g) ?? []).length).toBe(trackCount * 2);
    expect((filter?.match(/apad,/g) ?? []).length).toBe(trackCount);
  });

  it("renumbers timestamps between apad and atrim on every mixed branch", async () => {
    // Regression: `apad` then `atrim` is the portable pad-to-length shape --
    // #2769 moved off `apad=whole_dur=` because some builds reject that option.
    // But on FFmpeg 5.x-8.0.x the padded samples carry timestamps `atrim`
    // misreads, so a delayed branch sounds at t=0 and, past three branches, the
    // last one vanishes from the mix. `asetpts=N/SR/TB` between the two rebuilds
    // the timestamps from the sample count and costs no portability, since all
    // three filters exist in every build we support.
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);
    writeFileSync(join(baseDir, "a.wav"), "stub");
    writeFileSync(join(baseDir, "b.wav"), "stub");

    // Two branches, the second delayed: the shape that misplaced audio.
    await processCompositionAudio(
      [
        {
          id: "a",
          src: "a.wav",
          start: 0,
          end: 1,
          mediaStart: 0,
          layer: 0,
          volume: 1,
          type: "audio",
        },
        {
          id: "b",
          src: "b.wav",
          start: 4,
          end: 5,
          mediaStart: 0,
          layer: 1,
          volume: 1,
          type: "audio",
        },
      ],
      baseDir,
      workDir,
      join(baseDir, "out.m4a"),
      8,
    );

    const filter = capturedFilterScripts.at(-1) ?? "";
    const branches = filter.match(/apad[^;]*/g) ?? [];
    expect(branches).toHaveLength(2);
    for (const branch of branches) {
      expect(branch).toMatch(/^apad,asetpts=N\/SR\/TB,atrim=0:/);
    }
    // The portability constraint #2769 established still holds.
    expect(filter).not.toContain("whole_dur");
  });

  it("retries with the current file-valued filter option when a nightly removes the legacy alias", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);

    writeFileSync(join(baseDir, "voice.wav"), "stub");

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
          stderr: "Unrecognized option 'filter_complex_script'.\nError splitting the argument list",
          exitCode: 8,
        };
      });

    const result = await processCompositionAudio(
      [
        {
          id: "voice",
          src: "voice.wav",
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
    expect(runFfmpegMock).toHaveBeenCalledTimes(3);
    const legacyArgs = runFfmpegMock.mock.calls[1]?.[0] as string[];
    const currentArgs = runFfmpegMock.mock.calls[2]?.[0] as string[];
    expect(legacyArgs).toContain("-filter_complex_script");
    expect(currentArgs).toContain("-/filter_complex");
    expect(currentArgs).not.toContain("-filter_complex_script");
    expect(capturedFilterScripts[2]).toContain("amix=inputs=1");
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

  it("prepares browser root-absolute audio srcs from the project root", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);

    mkdirSync(join(baseDir, ".media"), { recursive: true });
    writeFileSync(join(baseDir, ".media", "tone.wav"), "stub");

    const result = await processCompositionAudio(
      [
        {
          id: "tone",
          src: "/.media/tone.wav",
          start: 0,
          end: 1,
          mediaStart: 0,
          layer: 0,
          volume: 1,
          type: "audio",
        },
      ],
      baseDir,
      workDir,
      join(baseDir, "out.m4a"),
      1,
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(runFfmpegMock.mock.calls[0]?.[0]).toContain(join(baseDir, ".media", "tone.wav"));
  });

  it("preserves authored clip gain above unity for quiet-source boosting", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);
    writeFileSync(join(baseDir, "quiet.wav"), "stub");

    const result = await processCompositionAudio(
      [
        {
          id: "quiet",
          src: "quiet.wav",
          start: 0,
          end: 2,
          mediaStart: 0,
          layer: 0,
          volume: 3.98,
          type: "audio",
        },
      ],
      baseDir,
      workDir,
      join(baseDir, "out.m4a"),
      2,
    );

    expect(result.success).toBe(true);
    expect(capturedFilterScripts[1]).toContain("volume=3.98");
  });

  it("clamps an out-of-range gain to the shared authoring ceiling", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);
    writeFileSync(join(baseDir, "quiet.wav"), "stub");

    const result = await processCompositionAudio(
      [
        {
          id: "quiet",
          src: "quiet.wav",
          start: 0,
          end: 2,
          mediaStart: 0,
          layer: 0,
          volume: 99,
          type: "audio",
        },
      ],
      baseDir,
      workDir,
      join(baseDir, "out.m4a"),
      2,
    );

    expect(result.success).toBe(true);
    // Pins the UPPER bound: the 3.98 case above only proves the clamp is not
    // min(1, ...). Without this, changing MAX_AUDIO_GAIN's effect in the mixer
    // leaves this suite green.
    expect(capturedFilterScripts[1]).toContain("volume=3.981072");
  });
});

describe("parseAudioElements — relative data-start resolution", () => {
  it.each([
    {
      label: "valueless playback-start",
      attributes: 'data-playback-start data-media-start="1.5"',
      expected: 1.5,
    },
    {
      label: "empty playback-start",
      attributes: 'data-playback-start="" data-media-start="1.5"',
      expected: 1.5,
    },
    {
      label: "whitespace playback-start",
      attributes: 'data-playback-start="   " data-media-start="1.5"',
      expected: 1.5,
    },
    {
      label: "invalid playback-start",
      attributes: 'data-playback-start="later" data-media-start="1.5"',
      expected: 1.5,
    },
    { label: "missing media-start", attributes: "", expected: 0 },
    { label: "invalid media-start", attributes: 'data-media-start="later"', expected: 0 },
    {
      label: "negative playback-start",
      attributes: 'data-playback-start="-1" data-media-start="1.5"',
      expected: 1.5,
    },
    { label: "negative media-start", attributes: 'data-media-start="-1"', expected: 0 },
    {
      label: "finite playback-start",
      attributes: 'data-playback-start="2.25" data-media-start="1.5"',
      expected: 2.25,
    },
    {
      label: "zero playback-start",
      attributes: 'data-playback-start="0" data-media-start="1.5"',
      expected: 0,
    },
  ])("uses finite playback-start -> media-start -> 0 for $label", ({ attributes, expected }) => {
    const html = wrap(`<audio id="a0" data-start="0" src="a.m4a" ${attributes}></audio>`);

    expect(parseAudioElements(html)[0]?.mediaStart).toBe(expected);
  });

  it("parses and normalizes constant playback rate", () => {
    const html = wrap(
      '<audio id="fast" data-start="0" src="a.m4a" data-playback-rate="2"></audio>' +
        '<audio id="low" data-start="0" src="a.m4a" data-playback-rate="0.01"></audio>' +
        '<audio id="high" data-start="0" src="a.m4a" data-playback-rate="20"></audio>' +
        '<audio id="invalid" data-start="0" src="a.m4a" data-playback-rate="bad"></audio>',
    );
    const tracks = parseAudioElements(html);

    expect(tracks.find((track) => track.id === "fast")?.playbackRate).toBe(2);
    expect(tracks.find((track) => track.id === "low")?.playbackRate).toBe(0.1);
    expect(tracks.find((track) => track.id === "high")?.playbackRate).toBe(5);
    expect(tracks.find((track) => track.id === "invalid")?.playbackRate).toBe(1);
  });

  const wrap = (body: string) =>
    `<div id="root" class="composition" data-composition-id="c" data-start="0" data-duration="10">${body}</div>`;

  it("resolves a relative data-start reference to the target clip's end (matches video)", () => {
    // <audio data-start="v0"> means 'start when clip v0 ends' = v0.start + v0.duration.
    const html = wrap(
      `<video id="v0" class="clip" data-start="0" data-duration="3" src="a.mp4" muted></video>` +
        `<audio id="a0" data-start="v0" data-duration="2" src="a.m4a"></audio>`,
    );
    const els = parseAudioElements(html);
    const a0 = els.find((e) => e.id === "a0");
    expect(a0).toBeDefined();
    // Regression guard: the pre-fix parseFloat("v0") produced NaN, and the
    // mixer silently dropped the track.
    expect(Number.isNaN(a0!.start)).toBe(false);
    expect(a0!.start).toBe(3);
  });

  it("chains references and never emits NaN start (falls back to 0 for an unknown target)", () => {
    const html = wrap(
      `<video id="v0" class="clip" data-start="0" data-duration="2" src="a.mp4" muted></video>` +
        `<video id="v1" class="clip" data-start="v0" data-duration="2" src="b.mp4" muted></video>` +
        `<audio id="a1" data-start="v1" src="a.m4a"></audio>` +
        `<audio id="a2" data-start="does-not-exist" src="b.m4a"></audio>`,
    );
    const els = parseAudioElements(html);
    expect(els.find((e) => e.id === "a1")!.start).toBe(4); // v1 ends at 2+2
    expect(els.find((e) => e.id === "a2")!.start).toBe(0); // unknown ref → 0, not NaN
  });

  it("still reads a numeric data-start unchanged", () => {
    const html = wrap(`<audio id="a0" data-start="2.5" data-duration="1" src="a.m4a"></audio>`);
    expect(parseAudioElements(html).find((e) => e.id === "a0")!.start).toBe(2.5);
  });

  it("resolves the reference for a data-has-audio video's audio track too", () => {
    const html = wrap(
      `<video id="v0" class="clip" data-start="0" data-duration="4" src="a.mp4" muted></video>` +
        `<video id="v1" class="clip" data-start="v0" data-duration="2" src="b.mp4" data-has-audio="true"></video>`,
    );
    const track = parseAudioElements(html).find((e) => e.id === "v1-audio");
    expect(track).toBeDefined();
    expect(track!.start).toBe(4);
  });
});

describe("parseAudioElements — hidden tracks", () => {
  it("excludes directly hidden audio and audible video from the render mix", () => {
    const html =
      `<div data-composition-id="main" data-start="0" data-duration="3">` +
      `<audio id="master" src="master.wav" data-start="0" data-duration="3"></audio>` +
      `<audio id="hidden" src="hidden.wav" data-start="0" data-duration="3" data-hidden></audio>` +
      `<video id="hidden-video" src="hidden.mp4" data-has-audio="true" data-hidden></video>` +
      `</div>`;

    expect(parseAudioElements(html).map((track) => track.id)).toEqual(["master"]);
  });

  it("excludes audio and audible video beneath a hidden ancestor", () => {
    const html =
      `<div data-composition-id="main" data-start="0" data-duration="3">` +
      `<audio id="master" src="master.wav" data-start="0" data-duration="3"></audio>` +
      `<section data-hidden>` +
      `<audio id="nested-audio" src="nested.wav"></audio>` +
      `<video id="nested-video" src="nested.mp4" data-has-audio="true"></video>` +
      `</section>` +
      `<video id="visible-video" src="visible.mp4" data-has-audio="true"></video>` +
      `</div>`;

    expect(parseAudioElements(html).map((track) => track.id)).toEqual([
      "master",
      "visible-video-audio",
    ]);
  });

  it("excludes every member of a hidden group, even though the members carry no data-hidden of their own", () => {
    const html =
      `<div data-composition-id="main" data-start="0" data-duration="3">` +
      `<hf-audio-group id="vo" data-hidden></hf-audio-group>` +
      `<audio id="master" src="master.wav" data-start="0" data-duration="3"></audio>` +
      `<audio id="a" src="a.wav" data-start="0" data-duration="3" data-audio-group="vo"></audio>` +
      `<audio id="b" src="b.wav" data-start="0" data-duration="3" data-audio-group="vo"></audio>` +
      `</div>`;

    expect(parseAudioElements(html).map((track) => track.id)).toEqual(["master"]);
  });
});

describe("parseAudioElements data-fx-chain", () => {
  it("captures the serialised chain when present", () => {
    const chain = `{"version":1,"nodes":[{"type":"peaking"}]}`;
    const html = `<audio id="music" src="bgm.mp3" data-start="0" data-end="10" data-fx-chain='${chain}'></audio>`;
    const [el] = parseAudioElements(html);
    expect(el!.fxChain).toBe(chain);
  });

  it("leaves fxChain undefined when the attribute is absent", () => {
    const html = `<audio id="music" src="bgm.mp3" data-start="0" data-end="10"></audio>`;
    const [el] = parseAudioElements(html);
    expect(el!.fxChain).toBeUndefined();
  });
});
