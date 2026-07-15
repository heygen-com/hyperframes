import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function waitFor(predicate: () => boolean, timeoutMs: number, intervalMs = 20) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// The mix filter graph is written to a temp file and passed via
// a file-valued filter option (not inlined via -filter_complex) so the command
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

vi.mock("../utils/runFfmpeg.js", () => ({
  runFfmpeg: runFfmpegMock,
}));

import { parseAudioElements, processCompositionAudio } from "./audioMixer.js";

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
        stderr: isMissingCuePrepare ? "Invalid data found when processing input" : "",
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
    expect(result.error).toMatch(/Prepare failed: missing-cue/);
    expect(runFfmpegMock).toHaveBeenCalledTimes(2);
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
});

describe("processCompositionAudio VST chain application", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    delete process.env.HF_VST_HOST_CMD;
    delete process.env.HF_TEST_PIDFILE;
    delete process.env.HF_TEST_SENTINEL;
    runFfmpegMock.mockClear();
    capturedFilterScripts.length = 0;
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeFakeSidecar(dir: string, body: string): string {
    const script = join(dir, "fake-vst.sh");
    writeFileSync(script, `#!/bin/sh\n${body}\n`);
    chmodSync(script, 0o755);
    return script;
  }

  it("applies the chain via the sidecar before the volume-envelope bake, with no errors", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);

    writeFileSync(join(baseDir, "music.wav"), "stub");
    writeFileSync(join(baseDir, "chain.json"), "{}");
    process.env.HF_VST_HOST_CMD = makeFakeSidecar(
      workDir,
      `
out=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--output" ]; then out="$a"; fi
  prev="$a"
done
echo processed > "$out"
`,
    );

    const result = await processCompositionAudio(
      [
        {
          id: "music",
          src: "music.wav",
          start: 0,
          end: 2,
          mediaStart: 0,
          layer: 0,
          volume: 1,
          vstChain: "chain.json",
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
  });

  it("hard-fails the track (never falls back to unprocessed audio) and names the missing plugin", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);

    writeFileSync(join(baseDir, "music.wav"), "stub");
    writeFileSync(join(baseDir, "chain.json"), "{}");
    process.env.HF_VST_HOST_CMD = makeFakeSidecar(
      workDir,
      `echo "PLUGIN_MISSING FabFilter Pro-Q 3" >&2; exit 3`,
    );

    // A hard failure must actually block a successful-looking render, not
    // just leave an error string somewhere on an otherwise-`success: true`
    // result — assert the call rejects (never resolves with `success: true`
    // and the track silently dropped).
    await expect(
      processCompositionAudio(
        [
          {
            id: "music",
            src: "music.wav",
            start: 0,
            end: 2,
            mediaStart: 0,
            layer: 0,
            volume: 1,
            vstChain: "chain.json",
            type: "audio",
          },
        ],
        baseDir,
        workDir,
        join(baseDir, "out.m4a"),
        2,
      ),
    ).rejects.toThrow('for track "music": plugin "FabFilter Pro-Q 3" is not installed');
  });

  it("hard-fails when the referenced VST chain file doesn't exist on disk", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    tempDirs.push(baseDir, workDir);

    writeFileSync(join(baseDir, "music.wav"), "stub");

    // Same requirement as above: the missing chain file must reject the call
    // (naming the track and the missing file), not degrade to a "successful"
    // mix with the track quietly dropped.
    await expect(
      processCompositionAudio(
        [
          {
            id: "music",
            src: "music.wav",
            start: 0,
            end: 2,
            mediaStart: 0,
            layer: 0,
            volume: 1,
            vstChain: "does-not-exist.json",
            type: "audio",
          },
        ],
        baseDir,
        workDir,
        join(baseDir, "out.m4a"),
        2,
      ),
    ).rejects.toThrow('VST chain file not found for track "music"');
  });

  it("kills a sibling's still-running VST sidecar when another track's chain hard-fails", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hf-audio-base-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-audio-work-"));
    // Separate from workDir on purpose: workDir is deleted by
    // processCompositionAudio's `finally` block the moment the call rejects,
    // so a sentinel/pid file written there would disappear regardless of
    // whether the sidecar was actually killed — that would make this test
    // pass even without the fix. Writing to an independent control dir keeps
    // the assertions about the sidecar's own lifecycle.
    const controlDir = mkdtempSync(join(tmpdir(), "hf-audio-control-"));
    tempDirs.push(baseDir, workDir, controlDir);

    writeFileSync(join(baseDir, "music-slow.wav"), "stub");
    writeFileSync(join(baseDir, "music-fail.wav"), "stub");
    writeFileSync(join(baseDir, "chain-slow.json"), "{}");
    writeFileSync(join(baseDir, "chain-fail.json"), "{}");

    const pidFile = join(controlDir, "slow.pid");
    const sentinelFile = join(controlDir, "slow.done");
    process.env.HF_TEST_PIDFILE = pidFile;
    process.env.HF_TEST_SENTINEL = sentinelFile;
    // Branches on the `--chain` filename: the "fail" track exits 3 (missing
    // plugin) immediately; the "slow" track records its own pid, sleeps
    // (simulating a slow bounce/convolution reverb), then — only if it ran to
    // completion uninterrupted — writes a sentinel and its output.
    process.env.HF_VST_HOST_CMD = makeFakeSidecar(
      workDir,
      `
chain=""
out=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--chain" ]; then chain="$a"; fi
  if [ "$prev" = "--output" ]; then out="$a"; fi
  prev="$a"
done
case "$chain" in
  *fail*)
    echo "PLUGIN_MISSING FabFilter Pro-Q 3" >&2
    exit 3
    ;;
  *)
    echo $$ > "$HF_TEST_PIDFILE"
    sleep 1.2
    echo done > "$HF_TEST_SENTINEL"
    echo processed > "$out"
    ;;
esac
`,
    );

    const startedAt = Date.now();
    await expect(
      processCompositionAudio(
        [
          {
            id: "musicSlow",
            src: "music-slow.wav",
            start: 0,
            end: 1,
            mediaStart: 0,
            layer: 0,
            volume: 1,
            vstChain: "chain-slow.json",
            type: "audio",
          },
          {
            id: "musicFail",
            src: "music-fail.wav",
            start: 0,
            end: 1,
            mediaStart: 0,
            layer: 0,
            volume: 1,
            vstChain: "chain-fail.json",
            type: "audio",
          },
        ],
        baseDir,
        workDir,
        join(baseDir, "out.m4a"),
        1,
      ),
    ).rejects.toThrow(/plugin "FabFilter Pro-Q 3" is not installed/);

    // Rejects promptly on the failing sibling — it must not wait out the
    // slow sibling's full sleep.
    expect(Date.now() - startedAt).toBeLessThan(1000);

    // The slow sidecar had actually started (recorded its own pid) before
    // the rejection tore things down.
    await waitFor(() => existsSync(pidFile), 500);
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    expect(Number.isFinite(pid)).toBe(true);

    // The fix under test: once the sibling's VstChainProcessingError rejects
    // processCompositionAudio, the still-running slow sidecar must actually
    // be terminated, not left running unmanaged.
    await waitFor(() => {
      try {
        process.kill(pid, 0);
        return false; // still alive
      } catch {
        return true; // ESRCH — process is gone
      }
    }, 1500);
    expect(() => process.kill(pid, 0)).toThrow();

    // Let the sidecar's full sleep duration elapse; the sentinel — written
    // only on an uninterrupted run — must never appear, proving the process
    // was killed rather than merely racing the assertions above.
    const remaining = 1500 - (Date.now() - startedAt);
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    expect(existsSync(sentinelFile)).toBe(false);
  });
});

describe("parseAudioElements — relative data-start resolution", () => {
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

describe("parseAudioElements data-vst-chain", () => {
  it("captures the chain path when present", () => {
    const html = `<audio id="music" src="assets/bgm.mp3" data-start="0" data-end="10" data-vst-chain="fx/music.vstchain.json"></audio>`;
    const [el] = parseAudioElements(html);
    expect(el.vstChain).toBe("fx/music.vstchain.json");
  });

  it("leaves vstChain undefined when absent", () => {
    const html = `<audio id="music" src="assets/bgm.mp3" data-start="0" data-end="10"></audio>`;
    const [el] = parseAudioElements(html);
    expect(el.vstChain).toBeUndefined();
  });
});
