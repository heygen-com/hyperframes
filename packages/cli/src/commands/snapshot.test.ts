// fallow-ignore-file code-duplication
import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { findFFmpeg, findFFprobe } from "../browser/ffmpeg.js";
import { sourceTimeAt } from "@hyperframes/core";

const snapshotState = vi.hoisted(() => ({
  openSettledPage: vi.fn(async (): Promise<unknown> => {
    throw new Error("browser capture reached");
  }),
  seek: vi.fn(async (_page: unknown, _time: number, _options?: unknown): Promise<void> => {
    throw new Error("seek reached");
  }),
  settle: vi.fn(async (_page: unknown, _options?: unknown) => ({ pending: [], failed: [] })),
  closeServer: vi.fn(async () => undefined),
  ffmpegTimesOut: false,
  ffmpegFails: false,
  ffmpegKilled: false,
  noFfmpeg: false,
}));

vi.mock("../browser/ffmpeg.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../browser/ffmpeg.js")>();
  return {
    ...actual,
    findFFmpeg: () => (snapshotState.noFfmpeg ? undefined : actual.findFFmpeg()),
  };
});

vi.mock("../capture/captureCompositionFrame.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../capture/captureCompositionFrame.js")>();
  return {
    ...actual,
    openSettledCompositionPage: snapshotState.openSettledPage,
    seekCompositionTimelineOnly: snapshotState.seek,
    settleCompositionSeek: snapshotState.settle,
    runFfmpegOnce: (...args: Parameters<typeof actual.runFfmpegOnce>) =>
      snapshotState.ffmpegTimesOut
        ? Promise.resolve({ code: null, timedOut: true, stderr: "" })
        : snapshotState.ffmpegKilled
          ? Promise.resolve({ code: 255, timedOut: false, stderr: "" })
          : snapshotState.ffmpegFails
            ? Promise.resolve({
                code: 1,
                timedOut: false,
                stderr: "\nError while decoding stream #0:0\n",
              })
            : actual.runFfmpegOnce(...args),
  };
});

vi.mock("../utils/staticProjectServer.js", () => ({
  serveStaticProjectHtml: vi.fn(async () => ({
    url: "http://127.0.0.1:1",
    close: snapshotState.closeServer,
  })),
}));

import snapshotCommand, {
  extractVideoFrameToBuffer,
  decodeFramesInOnePass,
  extractVideoFrameOrWarn,
  probeContainingSourceFrameSeek,
  containingSourceFrameIndex,
  computeSnapshotTimes,
  formatSnapshotTimestamp,
  parseZoomScale,
  recaptureSnapshotComposite,
  renderNotReadyError,
  requireSnapshotFfmpeg,
  resolveSnapshotVideoClipStart,
  resolveSnapshotVideoFrameTime,
  resolveSnapshotVideoRateSpec,
  tailFrameTime,
} from "./snapshot.js";
import type { PlannedFrame } from "./snapshotFrameBank.js";

describe("formatSnapshotTimestamp", () => {
  it.each([
    [1.12, "1.12s"],
    [0.30000000000000004, "0.3s"],
    [0, "0s"],
    [1.5, "1.5s"],
    [12.25, "12.25s"],
    [1.5000001, "1.5s"],
  ])("formats %s without discarding useful precision", (time, expected) => {
    expect(formatSnapshotTimestamp(time)).toBe(expected);
  });
});

// --zoom's crop-region math (selector bbox + padding + clamp, exact region
// form, no-match error) is owned by and tested in
// ../capture/captureCompositionFrame.test.ts alongside its implementation.

describe("tailFrameTime", () => {
  it("backs off ~3% of duration so the final frame isn't the blank exact-end", () => {
    // Verified on the V4 3D artifact: t=8.0 of an 8s clip rendered blank white,
    // t=7.76 rendered the final hero. 8 - 8*0.03 = 7.76.
    expect(tailFrameTime(8)).toBeCloseTo(7.76, 5);
  });

  it("uses a 50ms floor for short clips", () => {
    expect(tailFrameTime(1)).toBeCloseTo(0.95, 5); // 1 - 0.05 (floor beats 3%)
  });

  it("never goes negative", () => {
    expect(tailFrameTime(0)).toBe(0);
  });

  it("stays within 250ms of the end of a long composition", () => {
    // 3% of 634 s is 19 s; the cap keeps the end frame 250 ms from the end.
    expect(tailFrameTime(634)).toBeCloseTo(633.75, 5);
    expect(computeSnapshotTimes(634, { frames: 5 }).times.at(-1)).toBeCloseTo(633.75, 5);
  });

  it("appends the end frame to --at times on a long composition at its own tail", () => {
    const { times } = computeSnapshotTimes(634, { frames: 5, at: [100] });
    expect(times).toEqual([100, 633.75]);
  });
});

describe("transparent snapshot capture", () => {
  it("asks Chrome to retain the alpha channel in review PNGs", () => {
    const source = readFileSync(new URL("./snapshot.ts", import.meta.url), "utf8");
    expect(source).toContain('page.screenshot({ type: "png", omitBackground: true })');
  });

  it("exposes --proxy and forwards it to the snapshot page server", () => {
    const source = readFileSync(new URL("./snapshot.ts", import.meta.url), "utf8");
    expect(source).toContain("proxy: {");
    expect(source).toContain("autoProxy: args.proxy as boolean | undefined");
    expect(source).toContain("serveCapturePage(projectDir, html, opts.autoProxy)");
  });

  it("pairs every frame with the frame-exact reference frame under --against", () => {
    const source = readFileSync(new URL("./snapshot.ts", import.meta.url), "utf8");
    expect(source).toContain("against: {");
    expect(source).toContain("extractVideoFrameOrWarn(warnings, opts.against, time)");
    expect(source).toContain('labels: ["render", "reference"]');
  });

  it("resolves and forwards the shared local browser GPU policy", () => {
    const source = readFileSync(new URL("./snapshot.ts", import.meta.url), "utf8");
    expect(source).toContain("resolveLocalBrowserGpuMode");
    expect(source).toContain("browserGpuMode: opts.browserGpuMode");
    expect(source).toContain('"browser-gpu": {');
  });
});

describe("snapshot lint preflight", () => {
  async function runEntryMismatch(candidate: string): Promise<string> {
    const project = mkdtempSync(join(tmpdir(), "hf-snapshot-entry-mismatch-"));
    const candidatePath = join(project, candidate);
    mkdirSync(dirname(candidatePath), { recursive: true });
    writeFileSync(
      join(project, "index.html"),
      `<html><body><div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10"></div></body></html>`,
    );
    writeFileSync(
      candidatePath,
      `<html><body><div data-composition-id="authored" data-width="1920" data-height="1080" data-start="0" data-duration="5"><div class="clip" data-start="0" data-duration="5">Visible</div></div></body></html>`,
    );
    snapshotState.openSettledPage.mockClear();
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      lines.push(parts.map(String).join(" "));
    });

    try {
      await expect(
        snapshotCommand.run?.({ args: { dir: project } } as never),
      ).rejects.toMatchObject({
        name: "CliRuntimeError",
      });
      expect(snapshotState.openSettledPage).not.toHaveBeenCalled();
      return lines.join("\n");
    } finally {
      log.mockRestore();
      rmSync(project, { recursive: true, force: true });
    }
  }

  it("does not suggest a directory for a standalone file that is not index.html", async () => {
    const output = await runEntryMismatch("compositions/card.html");

    expect(output).toContain("compositions/card.html");
    expect(output).not.toContain("hyperframes snapshot <project>/compositions");
    expect(output).toContain("snapshot accepts project directories, not individual HTML files");
  });

  it("suggests the reported index.html directory with the re-rooting caveat", async () => {
    const output = await runEntryMismatch("compositions/index.html");

    expect(output).toContain("hyperframes snapshot <project>/compositions");
    expect(output).toContain("assets are self-contained under that directory");
  });
});

describe("snapshot --at seeks", () => {
  it("asks the runtime for the exact requested instant, not its 30fps grid", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-snapshot-exact-at-"));
    writeFileSync(
      join(project, "index.html"),
      `<html><body><div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="20" data-fps="29.97"><div class="clip" data-start="0" data-duration="20">Visible</div></div></body></html>`,
    );
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce({ loaded: [], errored: [], unused: [] })
      .mockResolvedValueOnce(20)
      .mockResolvedValueOnce(true);
    const close = vi.fn(async () => undefined);
    snapshotState.openSettledPage.mockResolvedValueOnce({
      browser: { close },
      page: { evaluate },
      renderReadyTimedOut: false,
    });
    snapshotState.seek.mockClear();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await expect(
        snapshotCommand.run?.({
          args: { dir: project, at: "19.019018", end: false, output: join(project, "out") },
        } as never),
      ).rejects.toBeDefined();
      expect(snapshotState.seek).toHaveBeenCalledWith(
        expect.anything(),
        19.019018,
        expect.objectContaining({ exactTime: true }),
      );
      expect(close).toHaveBeenCalled();
    } finally {
      log.mockRestore();
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe("snapshot video overlays and the blurred frame", () => {
  // The runtime draws a blurred frame when the seek settles, so the video <img> overlays must
  // be in by then (the engine injects before it waits, too).
  it("settles the seek only after the video overlays were read and injected", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-snapshot-blur-order-"));
    writeFileSync(
      join(project, "index.html"),
      `<html><body><div data-composition-id="main" data-width="640" data-height="360" data-start="0" data-duration="3" data-motion-blur="on"><div class="clip" data-start="0" data-duration="3">Visible</div></div></body></html>`,
    );
    const log: string[] = [];
    let calls = 0;
    const evaluate = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return { loaded: [], errored: [], unused: [] };
      if (calls === 2) return 3;
      if (calls === 3) return true;
      if (calls === 4) {
        log.push("read videos");
        return [];
      }
      return undefined;
    });
    snapshotState.openSettledPage.mockResolvedValueOnce({
      browser: { close: vi.fn(async () => undefined) },
      page: { evaluate },
      renderReadyTimedOut: false,
    });
    snapshotState.seek.mockReset();
    snapshotState.seek.mockImplementation(async () => {
      log.push("seek");
    });
    snapshotState.settle.mockClear();
    snapshotState.settle.mockImplementation(async () => {
      log.push("settle");
      return { pending: [], failed: [] };
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await expect(
        snapshotCommand.run?.({
          args: { dir: project, at: "1", end: false, output: join(project, "out") },
        } as never),
      ).rejects.toBeDefined();
      expect(log).toEqual(["seek", "read videos", "settle"]);
    } finally {
      logSpy.mockRestore();
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe("resolveSnapshotVideoFrameTime", () => {
  it("holds a clip ending with the composition on its last decodable frame", () => {
    expect(
      resolveSnapshotVideoFrameTime({
        globalTime: 15,
        clipStart: 0,
        clipDuration: 15,
        relativeTime: 15,
        sourceDuration: 15,
        compositionDuration: 15,
      }),
    ).toBeCloseTo(15 - 1 / 30, 6);
  });

  it.each([
    [0.3, 0.1 + 0.2],
    [26.2, 19.8 + 6.4],
  ])(
    "samples the first frame of a clip starting on a float sum at %s, as the preview does",
    (globalTime, clipStart) => {
      expect(
        resolveSnapshotVideoFrameTime({
          globalTime,
          clipStart,
          clipDuration: 0.2,
          relativeTime: globalTime - clipStart,
          sourceDuration: 10,
          compositionDuration: 1,
        }),
      ).toBe(0);
    },
  );

  it.each([
    [5, 0, 5],
    [7, 0, 7],
    [3, 0, 8],
  ])(
    "holds a video whose source ends before its slot on its last frame at %s, as the preview does",
    (globalTime, clipStart, relativeTime) => {
      expect(
        resolveSnapshotVideoFrameTime({
          globalTime,
          clipStart,
          clipDuration: 10,
          relativeTime,
          sourceDuration: 5,
          compositionDuration: 20,
        }),
      ).toBeCloseTo(5 - 1 / 30, 6);
    },
  );

  it("keeps ordinary in-window media timestamps unchanged", () => {
    expect(
      resolveSnapshotVideoFrameTime({
        globalTime: 7.5,
        clipStart: 0,
        clipDuration: 15,
        relativeTime: 7.5,
        sourceDuration: 15,
        compositionDuration: 15,
      }),
    ).toBe(7.5);
  });

  it.each([
    [15.001, 0, 15],
    [15, 0, 15],
    [0.3, 0.1, 0.1 + 0.2],
  ])(
    "leaves a clip that ends before the composition does at %s",
    (globalTime, clipStart, clipEnd) => {
      expect(
        resolveSnapshotVideoFrameTime({
          globalTime,
          clipStart,
          clipDuration: clipEnd - clipStart,
          relativeTime: globalTime - clipStart,
          sourceDuration: 15,
          compositionDuration: 30,
        }),
      ).toBeNull();
    },
  );

  it.each([
    {
      name: "before clip start",
      input: {
        globalTime: 4.9,
        clipStart: 5,
        clipDuration: 10,
        relativeTime: 0,
        sourceDuration: 10,
        compositionDuration: 15,
      },
      expected: null,
    },
    {
      name: "negative relative time",
      input: {
        globalTime: 5,
        clipStart: 5,
        clipDuration: 10,
        relativeTime: -0.1,
        sourceDuration: 10,
        compositionDuration: 15,
      },
      expected: null,
    },
    {
      name: "unknown source duration",
      input: {
        globalTime: 15,
        clipStart: 5,
        clipDuration: 10,
        relativeTime: 10,
        sourceDuration: 0,
        compositionDuration: 15,
      },
      expected: 10 - 1 / 30,
    },
    {
      name: "offset clip held at the composition end",
      input: {
        globalTime: 15,
        clipStart: 5,
        clipDuration: 10,
        relativeTime: 10,
        sourceDuration: 10,
        compositionDuration: 15,
      },
      expected: 10 - 1 / 30,
    },
    {
      name: "clip end within floating-point tolerance",
      input: {
        globalTime: 15 + 5e-10,
        clipStart: 5,
        clipDuration: 10,
        relativeTime: 10,
        sourceDuration: 10,
        compositionDuration: 15,
      },
      expected: 10 - 1 / 30,
    },
  ])("handles $name", ({ input, expected }) => {
    const result = resolveSnapshotVideoFrameTime(input);
    if (expected === null) expect(result).toBeNull();
    else expect(result).toBeCloseTo(expected, 6);
  });
});

describe("containingSourceFrameIndex", () => {
  it.each([
    [0.4, 9],
    [22 / 30, 17],
    [10 / 30, 8],
    [4.1, 98],
  ])("selects frame %s on the source presentation grid", (time, expected) => {
    expect(
      containingSourceFrameIndex(
        Array.from({ length: 120 }, (_, n) => n / 24),
        time,
      ),
    ).toBe(expected);
  });
  it("keeps exact boundaries despite floating-point round-off", () => {
    expect(containingSourceFrameIndex([0, 4.1], 4.1 - 4 * Number.EPSILON)).toBe(1);
    expect(containingSourceFrameIndex([0, 4.1], 4.1 - 0.00001)).toBe(0);
  });
  it("uses irregular presentation intervals", () => {
    expect(containingSourceFrameIndex([0, 0.02, 0.08, 0.15], 0.07)).toBe(1);
    expect(containingSourceFrameIndex([0, 0.02, 0.08, 0.15], 0.08)).toBe(2);
  });
});

/** The pixel data of a PNG: the colour-tag chunks a retag adds are not part of the picture. */
function samePixels(actual: Buffer | null | undefined, expected: Buffer): boolean {
  const idat = (png: Buffer): Buffer => {
    const chunks: Buffer[] = [];
    for (let at = 8; at < png.length; at += 12 + png.readUInt32BE(at)) {
      if (png.toString("latin1", at + 4, at + 8) === "IDAT") {
        chunks.push(png.subarray(at + 8, at + 8 + png.readUInt32BE(at)));
      }
    }
    return Buffer.concat(chunks);
  };
  return !!actual && idat(actual).equals(idat(expected));
}

describe("extractVideoFrameToBuffer", () => {
  const ffmpeg = findFFmpeg();
  const ffprobe = findFFprobe();
  const noProbe = !ffmpeg || !ffprobe;
  const hasX265 =
    !noProbe &&
    execFileSync(ffmpeg!, ["-hide_banner", "-encoders"], { encoding: "utf-8" }).includes("libx265");

  it.skipIf(noProbe)("selects containing frames for snapshots and reference pairs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-snapshot-containing-"));
    try {
      const clip = join(dir, "clip.mp4");
      execFileSync(ffmpeg!, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc=d=2:r=24:s=160x90",
        "-pix_fmt",
        "yuv420p",
        clip,
      ]);
      for (const [time, index] of [
        [0.4, 9],
        [22 / 30, 17],
        [10 / 30, 8],
        [9 / 24, 9],
      ] as const) {
        const expected = join(dir, `frame-${index}.png`);
        execFileSync(ffmpeg!, [
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          clip,
          "-vf",
          `select=eq(n\\,${index})`,
          "-frames:v",
          "1",
          "-y",
          expected,
        ]);
        const actual = await extractVideoFrameToBuffer(clip, time);
        expect(samePixels(actual, readFileSync(expected))).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(noProbe)("selects a variable-frame-rate presentation interval", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-snapshot-vfr-"));
    try {
      const clip = join(dir, "clip.mp4");
      execFileSync(ffmpeg!, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc=d=1:r=10:s=160x90",
        "-vf",
        "select=eq(n\\,0)+eq(n\\,1)+eq(n\\,4)+eq(n\\,8)",
        "-fps_mode",
        "vfr",
        "-pix_fmt",
        "yuv420p",
        clip,
      ]);
      const expected = join(dir, "frame.png");
      execFileSync(ffmpeg!, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        clip,
        "-vf",
        "select=eq(n\\,1)",
        "-frames:v",
        "1",
        "-y",
        expected,
      ]);
      expect(samePixels(await extractVideoFrameToBuffer(clip, 0.3), readFileSync(expected))).toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still stops with the install hint when FFmpeg is missing, instead of blanking every clip", async () => {
    snapshotState.noFfmpeg = true;
    try {
      await expect(extractVideoFrameOrWarn([], "clip.mp4", 0.5)).rejects.toThrow(
        /FFmpeg is required to extract video frames for snapshots/,
      );
    } finally {
      snapshotState.noFfmpeg = false;
    }
  });

  it.skipIf(noProbe).each([
    ["fragmented MP4", "clip.mp4", ["-movflags", "frag_keyframe+empty_moov"]],
    ["MPEG-TS", "clip.ts", []],
    ["MP4", "clip.mp4", []],
    ["open-GOP MPEG-TS", "clip.ts", ["-x264-params", "open-gop=1"]],
  ])("matches a full decode past keyframes in %s with B-frames", async (_, name, muxArgs) => {
    const dir = mkdtempSync(join(tmpdir(), "hf-snapshot-gop-"));
    try {
      const clip = join(dir, name);
      const quiet = ["-hide_banner", "-loglevel", "error"];
      execFileSync(ffmpeg!, [
        ...quiet,
        ...["-f", "lavfi", "-i", "testsrc2=d=3:r=30:s=160x90", "-pix_fmt", "yuv420p"],
        ...["-c:v", "libx264", "-bf", "3", "-g", "30", "-keyint_min", "30", "-sc_threshold", "0"],
        ...muxArgs,
        clip,
      ]);
      // Frames 29 and 59 sit just before a keyframe; 47 and 80 decode from a later keyframe.
      for (const index of [29, 47, 59, 80]) {
        const expected = join(dir, `frame-${index}.png`);
        execFileSync(ffmpeg!, [
          ...quiet,
          ...["-i", clip, "-vf", `select=eq(n\\,${index})`, "-frames:v", "1", "-y", expected],
        ]);
        const actual = await extractVideoFrameToBuffer(clip, (index + 0.5) / 30);
        expect(samePixels(actual, readFileSync(expected)), `frame ${index}`).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(noProbe || !hasX265)(
    "seeks into a stream-copied HEVC cut instead of decoding it from the start",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "hf-snapshot-hevc-cut-"));
      try {
        const quiet = ["-hide_banner", "-loglevel", "error"];
        const source = join(dir, "source.mov");
        const x265 = "bframes=3:keyint=250:min-keyint=250:open-gop=0:scenecut=0:log-level=error";
        execFileSync(ffmpeg!, [
          ...quiet,
          ...["-f", "lavfi", "-i", "testsrc2=d=70:r=30:s=160x90", "-pix_fmt", "yuv420p"],
          ...[
            "-c:v",
            "libx265",
            "-preset",
            "ultrafast",
            "-x265-params",
            x265,
            "-tag:v",
            "hvc1",
            source,
          ],
        ]);
        const clip = join(dir, "cut.mov");
        execFileSync(ffmpeg!, [...quiet, ...["-ss", "31.77", "-i", source, "-c", "copy", clip]]);

        const seek = await probeContainingSourceFrameSeek(clip, 35.2, false);
        expect(seek?.seek, "must seek, not decode from the start").toBeDefined();

        const expected = join(dir, "frame.png");
        execFileSync(ffmpeg!, [
          ...quiet,
          ...["-i", clip, "-vf", "select=eq(n\\,1056)", "-frames:v", "1", "-y", expected],
        ]);
        const actual = await extractVideoFrameToBuffer(clip, 1056.5 / 30);
        expect(samePixels(actual, readFileSync(expected))).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(noProbe)(
    "decodes several times of one video in one pass, frame for frame as each decodes alone",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "hf-snapshot-pass-"));
      try {
        const clip = join(dir, "one-keyframe.mp4");
        // A single keyframe at 0, as a long screen recording has: every frame decodes from the start.
        execFileSync(ffmpeg!, [
          ...[
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=d=12:r=25:s=320x180",
          ],
          ...["-c:v", "libx264", "-g", "10000", "-keyint_min", "10000", "-sc_threshold", "0"],
          ...["-pix_fmt", "yuv420p", clip],
        ]);
        const times = [6.2, 8.97, 11.5];
        const frames: PlannedFrame[] = [];
        for (const time of times) {
          const plan = await probeContainingSourceFrameSeek(clip, time, false);
          expect(plan?.decodesFrom, "decodes from the only keyframe").toBe(0);
          frames.push({
            time,
            displayedPixels: 160,
            holdLastFrame: false,
            seek: plan!.seek!,
            select: plan!.select!,
            decodesFrom: plan!.decodesFrom!,
          });
        }
        const together = await decodeFramesInOnePass(clip, frames);
        for (const [i, time] of times.entries()) {
          const alone = await extractVideoFrameToBuffer(clip, time, false, false, 160);
          expect(samePixels(together[i]!, alone!), `the frame at ${time}s`).toBe(true);
        }
        expect(new Set(together.map((png) => png.toString("base64"))).size).toBe(times.length);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(noProbe)(
    "gives two times inside one source frame the same frame, without decoding on",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "hf-snapshot-pass-same-"));
      try {
        const clip = join(dir, "one-keyframe.mp4");
        execFileSync(ffmpeg!, [
          ...[
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=d=60:r=25:s=320x180",
          ],
          ...["-c:v", "libx264", "-g", "10000", "-keyint_min", "10000", "-sc_threshold", "0"],
          ...["-pix_fmt", "yuv420p", clip],
        ]);
        const frames: PlannedFrame[] = [];
        for (const time of [8.97, 8.98]) {
          const plan = await probeContainingSourceFrameSeek(clip, time, false);
          frames.push({
            time,
            displayedPixels: 160,
            holdLastFrame: false,
            seek: plan!.seek!,
            select: plan!.select!,
            decodesFrom: plan!.decodesFrom!,
          });
        }
        const startedAt = Date.now();
        const [first, second] = await decodeFramesInOnePass(clip, frames);
        expect(first!.equals(second!)).toBe(true);
        expect(Date.now() - startedAt, "stops at the frame, not the end of the file").toBeLessThan(
          4_000,
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  const oneSecondClip = (dir: string) => {
    const clip = join(dir, "clip.mp4");
    execFileSync(ffmpeg!, [
      ...["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=d=1:r=24:s=160x90"],
      ...["-pix_fmt", "yuv420p", clip],
    ]);
    return clip;
  };

  it.skipIf(noProbe)(
    "says FFmpeg was stopped, not that a frame is bad, when it exits 255 with no output",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "hf-snapshot-killed-"));
      snapshotState.ffmpegKilled = true;
      try {
        const warnings: string[] = [];
        expect(await extractVideoFrameOrWarn(warnings, oneSecondClip(dir), 0.5)).toBeNull();
        expect(warnings).toEqual([
          expect.stringContaining("FFmpeg was stopped before it finished"),
        ]);
      } finally {
        snapshotState.ffmpegKilled = false;
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(noProbe)(
    "records the clip, time and FFmpeg's reason when the extract fails",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "hf-snapshot-fails-"));
      snapshotState.ffmpegFails = true;
      try {
        const warnings: string[] = [];
        expect(await extractVideoFrameOrWarn(warnings, oneSecondClip(dir), 0.5)).toBeNull();
        expect(warnings).toEqual([
          expect.stringMatching(/clip\.mp4 at 0\.50s: Error while decoding stream #0:0$/),
        ]);
      } finally {
        snapshotState.ffmpegFails = false;
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(noProbe)("names the clip and time when FFmpeg times out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-snapshot-timeout-"));
    try {
      const clip = oneSecondClip(dir);
      snapshotState.ffmpegTimesOut = true;
      await expect(extractVideoFrameToBuffer(clip, 0.5)).rejects.toThrow(/clip\.mp4 at 0\.50s/);
    } finally {
      snapshotState.ffmpegTimesOut = false;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(noProbe)(
    "keeps the snapshot going and records the clip when FFmpeg times out",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "hf-snapshot-finding-"));
      try {
        const clip = oneSecondClip(dir);
        snapshotState.ffmpegTimesOut = true;
        const warnings: string[] = [];
        expect(await extractVideoFrameOrWarn(warnings, clip, 0.5)).toBeNull();
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/clip\.mp4 at 0\.50s/);
      } finally {
        snapshotState.ffmpegTimesOut = false;
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(noProbe).each([
    [24, 10.02],
    [60, 10.02],
    [60, 11.3],
    [12, 10.02],
    [12.04, 10.02],
  ])(
    "decodes from near the target at %s fps, %ss, when no keyframe seek is usable",
    async (fps, time) => {
      const dir = mkdtempSync(join(tmpdir(), "hf-snapshot-onegop-"));
      try {
        const clip = join(dir, "clip.mp4");
        execFileSync(ffmpeg!, [
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          `testsrc=d=13:r=${fps}:s=160x90`,
          "-pix_fmt",
          "yuv420p",
          "-g",
          "10000",
          "-sc_threshold",
          "0",
          clip,
        ]);
        const seek = await probeContainingSourceFrameSeek(clip, time, false);
        expect(seek?.seek).toBeGreaterThan(4);
        const index = Math.floor(time * fps + 1e-6);
        const expected = join(dir, "expected.png");
        execFileSync(ffmpeg!, [
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          clip,
          "-vf",
          `select=eq(n\\,${index})`,
          "-frames:v",
          "1",
          "-q:v",
          "2",
          "-y",
          expected,
        ]);
        expect(
          samePixels(await extractVideoFrameToBuffer(clip, time), readFileSync(expected)),
        ).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(noProbe)(
    "leaves an unreadable video blank, naming it and why, instead of failing the snapshot",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "hf-snapshot-unreadable-"));
      try {
        const garbage = join(dir, "garbage.mp4");
        writeFileSync(garbage, "not a video");
        const warnings: string[] = [];
        expect(await extractVideoFrameOrWarn(warnings, join(dir, "missing.mp4"), 1)).toBeNull();
        expect(await extractVideoFrameOrWarn(warnings, garbage, 1)).toBeNull();
        expect(warnings).toEqual([
          expect.stringMatching(/FFprobe could not read .*missing\.mp4: .*No such file/),
          expect.stringMatching(/FFprobe could not read .*garbage\.mp4: .*Invalid data found/),
        ]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(noProbe)(
    "selects exact frame times in a fragmented MP4 whose start rounds down",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "hf-snapshot-start-"));
      try {
        // B-frames start this clip at 1024/12288 s, which ffprobe prints as 0.083333.
        const clip = join(dir, "clip.mp4");
        const quiet = ["-hide_banner", "-loglevel", "error"];
        execFileSync(ffmpeg!, [
          ...quiet,
          ...["-f", "lavfi", "-i", "testsrc2=d=2:r=24:s=160x90", "-pix_fmt", "yuv420p"],
          ...["-c:v", "libx264", "-bf", "3", "-movflags", "frag_keyframe+empty_moov", clip],
        ]);
        for (const index of [0, 1, 12, 47]) {
          const expected = join(dir, `frame-${index}.png`);
          execFileSync(ffmpeg!, [
            ...quiet,
            ...["-i", clip, "-vf", `select=eq(n\\,${index})`, "-frames:v", "1", "-y", expected],
          ]);
          const actual = await extractVideoFrameToBuffer(clip, index / 24);
          expect(samePixels(actual, readFileSync(expected)), `frame ${index}`).toBe(true);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(noProbe)(
    "selects frames in a stream-copy trim whose preroll starts before the video",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "hf-snapshot-editlist-"));
      try {
        // The trim keeps 1.3 s of preroll packets before the first visible frame (an MP4 edit list).
        const source = join(dir, "source.mp4");
        const clip = join(dir, "clip.mp4");
        const quiet = ["-hide_banner", "-loglevel", "error"];
        execFileSync(ffmpeg!, [
          ...quiet,
          ...["-f", "lavfi", "-i", "testsrc2=d=4:r=24:s=160x90", "-pix_fmt", "yuv420p"],
          ...["-c:v", "libx264", "-bf", "2", source],
        ]);
        execFileSync(ffmpeg!, [...quiet, "-ss", "1.3", "-i", source, "-c", "copy", clip]);
        for (const index of [1, 3, 10, 30]) {
          const expected = join(dir, `frame-${index}.png`);
          execFileSync(ffmpeg!, [
            ...quiet,
            ...["-i", clip, "-vf", `select=eq(n\\,${index})`, "-frames:v", "1", "-y", expected],
          ]);
          const actual = await extractVideoFrameToBuffer(clip, index / 24);
          expect(samePixels(actual, readFileSync(expected)), `frame ${index}`).toBe(true);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(noProbe).each([
    // Audio leads video by 23 ms in a TS mux: frame n sits at 0.0232 + n/30 on the file's clock.
    [
      "MPEG-TS with leading audio",
      "clip.ts",
      [],
      [
        [0, 0],
        [0.01, 0],
        [0.05, 0],
        [0.1, 2],
        [1, 29],
      ],
    ],
    // Video starts 0.5 s after the audio, so earlier times hold the first frame.
    [
      "MP4 with late video",
      "clip.mp4",
      ["-vf", "setpts=PTS+0.5/TB", "-fps_mode", "passthrough"],
      [
        [0, 0],
        [0.1, 0],
        [0.55, 1],
        [1, 15],
      ],
    ],
  ] as const)("measures frame times on the file clock in %s", async (_, name, videoArgs, cases) => {
    const dir = mkdtempSync(join(tmpdir(), "hf-snapshot-av-"));
    try {
      const clip = join(dir, name);
      const quiet = ["-hide_banner", "-loglevel", "error"];
      execFileSync(ffmpeg!, [
        ...quiet,
        ...["-f", "lavfi", "-i", "testsrc2=d=2:r=30:s=160x90", "-f", "lavfi", "-i", "sine=d=3"],
        ...videoArgs,
        ...["-c:v", "libx264", "-bf", "3", "-pix_fmt", "yuv420p", "-c:a", "aac", clip],
      ]);
      for (const [time, index] of cases) {
        const expected = join(dir, `frame-${index}.png`);
        execFileSync(ffmpeg!, [
          ...quiet,
          ...["-i", clip, "-map", "0:v:0", "-vf", `select=eq(n\\,${index})`],
          ...["-frames:v", "1", "-y", expected],
        ]);
        const actual = await extractVideoFrameToBuffer(clip, time);
        expect(samePixels(actual, readFileSync(expected)), `t=${time}`).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(noProbe)("selects frames in a TS whose timestamps start below zero", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "hf-snapshot-negative-"));
    try {
      const clip = join(dir, "clip.ts");
      const quiet = ["-hide_banner", "-loglevel", "error"];
      execFileSync(ffmpeg!, [
        ...quiet,
        ...["-f", "lavfi", "-i", "testsrc2=d=3:r=30:s=160x90", "-c:v", "libx264", "-g", "1"],
        ...[
          "-output_ts_offset",
          "-2",
          "-avoid_negative_ts",
          "disabled",
          "-mpegts_copyts",
          "1",
          clip,
        ],
      ]);
      const frameAt = async (time: number, index: number) => {
        const expected = join(dir, `frame-${index}.png`);
        execFileSync(ffmpeg!, [
          ...quiet,
          ...["-i", clip, "-vf", `select=eq(n\\,${index})`, "-frames:v", "1", "-y", expected],
        ]);
        const actual = await extractVideoFrameToBuffer(clip, time);
        expect(samePixels(actual, readFileSync(expected)), `t=${time}`).toBe(true);
      };
      for (const [time, index] of [
        [0, 0],
        [0.05, 1],
        [0.1, 3],
        [1, 30],
        [2.5, 75],
      ] as const) {
        await frameAt(time, index);
      }
      // Without ffprobe, the plain seek keeps main's first-frame-at-or-after behaviour.
      vi.stubEnv("HYPERFRAMES_FFPROBE_PATH", join(dir, "missing-ffprobe"));
      for (const [time, index] of [
        [0, 0],
        [0.05, 2],
        [1, 30],
      ] as const)
        await frameAt(time, index);
      // Colours cannot be matched to render without ffprobe: said once, not per frame.
      expect(warn.mock.calls.filter(([m]) => /colours may differ/.test(String(m)))).toHaveLength(1);
    } finally {
      warn.mockRestore();
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(noProbe)("selects frames in a TS with frequent open-GOP keyframes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-snapshot-open-gop-"));
    try {
      // A seek to 0.5 s lands on the keyframe at 1 s here, so the frames between are never decoded.
      const clip = join(dir, "clip.ts");
      const quiet = ["-hide_banner", "-loglevel", "error"];
      execFileSync(ffmpeg!, [
        ...quiet,
        ...["-f", "lavfi", "-i", "testsrc2=d=3:r=30:s=160x90", "-c:v", "libx264", "-g", "15"],
        ...["-bf", "3", "-x264-params", "open-gop=1:scenecut=0", clip],
      ]);
      for (const [time, index] of [
        [0.5, 15],
        [0.51, 15],
        [0.99, 29],
        [1.5, 45],
        [1.99, 59],
      ] as const) {
        const expected = join(dir, `frame-${index}.png`);
        execFileSync(ffmpeg!, [
          ...quiet,
          ...["-i", clip, "-vf", `select=eq(n\\,${index})`, "-frames:v", "1", "-y", expected],
        ]);
        const actual = await extractVideoFrameToBuffer(clip, time);
        expect(samePixels(actual, readFileSync(expected)), `t=${time}`).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(noProbe)("retags SDR footage as sRGB, as render does", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-snapshot-retag-"));
    try {
      const clip = join(dir, "clip.mp4");
      execFileSync(ffmpeg!, [
        ...["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=d=1:r=24:s=160x90"],
        ...["-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_trc", "bt709", clip],
      ]);
      const png = await extractVideoFrameToBuffer(clip, 0.5);
      expect(png?.includes("sRGB", 0, "latin1")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!ffmpeg)("extracts without ffprobe, as before frame selection needed it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-snapshot-no-ffprobe-"));
    vi.stubEnv("HYPERFRAMES_FFPROBE_PATH", join(dir, "missing-ffprobe"));
    try {
      const clip = join(dir, "clip.mp4");
      execFileSync(ffmpeg!, [
        ...["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=d=1:r=24:s=160x90"],
        ...["-pix_fmt", "yuv420p", clip],
      ]);
      const expected = join(dir, "frame.png");
      execFileSync(ffmpeg!, [
        ...["-hide_banner", "-loglevel", "error", "-i", clip, "-vf", "select=eq(n\\,12)"],
        ...["-frames:v", "1", "-y", expected],
      ]);
      expect(samePixels(await extractVideoFrameToBuffer(clip, 0.5), readFileSync(expected))).toBe(
        true,
      );
    } finally {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(noProbe)(
    "gives a 24 fps clip's real last frame for a held tail that lands past it",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "hf-snapshot-tail-"));
      try {
        const clip = join(dir, "clip.mp4");
        const source = ["-f", "lavfi", "-i", "testsrc=d=1:r=24:s=160x90", "-pix_fmt", "yuv420p"];
        execFileSync(ffmpeg!, ["-hide_banner", "-loglevel", "error", ...source, clip]);

        const held = await extractVideoFrameToBuffer(clip, 1 - 1 / 30, false, true);
        const lastFrame = await extractVideoFrameToBuffer(clip, 23 / 24);

        expect((await extractVideoFrameToBuffer(clip, 1 - 1 / 30))?.equals(lastFrame!)).toBe(true);
        expect(lastFrame).not.toBeNull();
        expect(held?.equals(lastFrame!)).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(noProbe)(
    "extracts a frame at its displayed size, never larger than the source",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "hf-snapshot-displayed-"));
      try {
        const size = async (clip: string, displayedPixels: number) => {
          const png = await extractVideoFrameToBuffer(clip, 0.5, false, false, displayedPixels);
          if (!png) throw new Error(`no frame from ${clip}`);
          return [png.readUInt32BE(16), png.readUInt32BE(20)];
        };
        for (const { name, width, height } of [
          { name: "landscape", width: 160, height: 90 },
          { name: "portrait", width: 90, height: 160 },
        ]) {
          const clip = join(dir, `${name}.mp4`);
          const input = [
            "-f",
            "lavfi",
            "-i",
            `testsrc=d=1:r=24:s=${width}x${height}`,
            "-pix_fmt",
            "yuv420p",
          ];
          execFileSync(ffmpeg!, ["-hide_banner", "-loglevel", "error", ...input, clip]);
          expect(await size(clip, 0)).toEqual([width, height]);
          expect(await size(clip, 1000)).toEqual([width, height]);
          expect(Math.min(...(await size(clip, 32)))).toBe(32);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe("resolveSnapshotVideoClipStart", () => {
  it("offsets a scene-local video start by its later template host", () => {
    expect(
      resolveSnapshotVideoClipStart({
        authoredStart: 0,
        runtimeResolvedStart: 3,
      }),
    ).toBe(3);
  });

  it("uses the runtime's recursively resolved start for deeply nested media", () => {
    expect(
      resolveSnapshotVideoClipStart({
        authoredStart: 1,
        runtimeResolvedStart: 8,
      }),
    ).toBe(8);
  });

  it("keeps authored starts as a compatibility fallback", () => {
    expect(
      resolveSnapshotVideoClipStart({
        authoredStart: 3,
        runtimeResolvedStart: null,
      }),
    ).toBe(3);
  });
});

describe("resolveSnapshotVideoRateSpec", () => {
  it("prefers the authored data-playback-rate over the browser default", () => {
    expect(resolveSnapshotVideoRateSpec({ authoredRate: "1.8", defaultRate: 1 })).toBe(1.8);
  });

  it("falls back to the browser default when the authored rate is invalid", () => {
    expect(resolveSnapshotVideoRateSpec({ authoredRate: "abc", defaultRate: 2 })).toBe(2);
    expect(resolveSnapshotVideoRateSpec({ authoredRate: "0", defaultRate: 2 })).toBe(2);
  });

  it("allows rates up to the shared 10x bound", () => {
    expect(resolveSnapshotVideoRateSpec({ authoredRate: "8", defaultRate: 1 })).toBe(8);
  });

  it("maps a frame through a rate lane instead of the constant", () => {
    const lane = JSON.stringify({
      version: 1,
      lanes: [
        {
          target: "rate",
          points: [
            { t: 0, v: 1 },
            { t: 2, v: 3 },
          ],
        },
      ],
    });
    const spec = resolveSnapshotVideoRateSpec({
      authoredRate: "1",
      authoredAutomation: lane,
      defaultRate: 1,
    });
    expect(typeof spec).toBe("object");
    expect(sourceTimeAt(spec, 2)).toBeCloseTo(3.641, 2);
  });
});

describe("computeSnapshotTimes (FINDING [7]: tail is always captured)", () => {
  it("default frames: last point is the readable tail, never exact duration", () => {
    const { times, appendedTail } = computeSnapshotTimes(8, { frames: 5 });
    expect(times).toHaveLength(5);
    expect(times[0]).toBe(0);
    expect(times[times.length - 1]).toBeCloseTo(7.76, 5);
    expect(times[times.length - 1]).toBeLessThan(8); // not the blank exact-end
    expect(appendedTail).toBe(false);
  });

  it("single frame samples the midpoint", () => {
    expect(computeSnapshotTimes(8, { frames: 1 }).times).toEqual([4]);
  });

  it("explicit --at: keeps the user's times AND appends an end-of-timeline frame", () => {
    const { times, appendedTail } = computeSnapshotTimes(8, { frames: 5, at: [1, 2, 3] });
    expect(times.slice(0, 3)).toEqual([1, 2, 3]);
    expect(times[times.length - 1]).toBeCloseTo(7.76, 5);
    expect(appendedTail).toBe(true);
  });

  it("explicit --at: does not double-add when the user already sampled the tail", () => {
    const { times, appendedTail } = computeSnapshotTimes(8, { frames: 5, at: [1, 7.76] });
    expect(times).toEqual([1, 7.76]);
    expect(appendedTail).toBe(false);
  });

  it("explicit --at: a sample at exact duration counts as the tail (no append)", () => {
    const { appendedTail } = computeSnapshotTimes(8, { frames: 5, at: [1, 8] });
    expect(appendedTail).toBe(false);
  });

  it("respects includeEnd:false opt-out for --at", () => {
    const { times, appendedTail } = computeSnapshotTimes(8, {
      frames: 5,
      at: [1, 2],
      includeEnd: false,
    });
    expect(times).toEqual([1, 2]);
    expect(appendedTail).toBe(false);
  });

  it("preserves exact explicit transition timestamps", () => {
    const exactTransition = 3.3666666666666667;
    const { times } = computeSnapshotTimes(8, {
      frames: 5,
      at: [exactTransition],
      includeEnd: false,
    });
    expect(times).toEqual([exactTransition]);
  });
});

describe("parseZoomScale (--zoom-scale)", () => {
  it("defaults to 3 when unset", () => {
    expect(parseZoomScale(undefined)).toBe(3);
  });

  it("honors an explicit scale", () => {
    expect(parseZoomScale("2")).toBe(2);
  });

  it("falls back to the default for invalid or non-positive input", () => {
    expect(parseZoomScale("abc")).toBe(3);
    expect(parseZoomScale("0")).toBe(3);
    expect(parseZoomScale("-1")).toBe(3);
  });
});

describe("requireSnapshotFfmpeg", () => {
  it("rejects video snapshot extraction when FFmpeg is unavailable", () => {
    expect(() => requireSnapshotFfmpeg(undefined)).toThrow(
      /FFmpeg is required to extract video frames for snapshots/,
    );
  });

  it("preserves the resolved FFmpeg executable", () => {
    expect(requireSnapshotFfmpeg("C:\\tools\\ffmpeg.exe")).toBe("C:\\tools\\ffmpeg.exe");
  });
});

describe("snapshot composite recapture", () => {
  it.each([false, true])("recaptures only when a resolver exists: %s", async (hasResolver) => {
    const order: string[] = [];
    const runtimeWindow = {
      __hf_page_composite_prepare: vi.fn(async () => {
        order.push("prepare");
        return true;
      }),
      __hf_page_composite_resolve: hasResolver
        ? vi.fn(() => {
            order.push("resolve");
            return true;
          })
        : undefined,
    };
    vi.stubGlobal("window", runtimeWindow);
    try {
      await recaptureSnapshotComposite({
        async evaluate<T>(callback: () => T): Promise<Awaited<T>> {
          return await callback();
        },
        async screenshot(options) {
          expect(options).toEqual({
            type: "jpeg",
            quality: 1,
            clip: { x: 0, y: 0, width: 1, height: 1 },
          });
          order.push("paint");
          return new Uint8Array();
        },
      });
      expect(order).toEqual(hasResolver ? ["prepare", "paint", "resolve"] : []);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("places recapture after frame injection and visibility sync, before final capture", () => {
    const source = readFileSync(new URL("./snapshot.ts", import.meta.url), "utf8");
    const injection = source.indexOf("await injectVideoFramesBatch(page, updates)");
    const visibility = source.indexOf("await syncVideoFrameVisibility(", injection);
    const recapture = source.indexOf("await recaptureSnapshotComposite(page)", visibility);
    const finalCapture = source.indexOf('page.screenshot({ type: "png"', recapture);
    expect(injection).toBeGreaterThan(-1);
    expect(visibility).toBeGreaterThan(injection);
    expect(recapture).toBeGreaterThan(visibility);
    expect(finalCapture).toBeGreaterThan(recapture);
  });
});

it("addresses colliding scene videos by the capture page's render identity", async () => {
  const project = mkdtempSync(join(tmpdir(), "hf-snapshot-media-id-"));
  writeFileSync(
    join(project, "index.html"),
    '<html><body><div data-composition-id="main" data-width="320" data-height="180" data-duration="20"></div></body></html>',
  );
  const videos = ["clip", "clip__hf2"].map((renderId) => ({
    id: "clip",
    renderId,
    dataset: { start: "0", duration: "10" },
    duration: 20,
    currentSrc: "http://127.0.0.1/source.mov",
    src: "",
    defaultPlaybackRate: 1,
    loop: false,
    getBoundingClientRect: () => ({ width: 320, height: 180 }),
  }));
  let ids: string[] = [];
  let calls = 0;
  const evaluate = vi.fn(async (fn: () => unknown) => {
    calls++;
    if (calls === 1) return { loaded: [], errored: [], unused: [] };
    if (calls === 2) return 20;
    if (calls === 3) return true;
    ids = (fn() as Array<{ id: string }>).map((video) => video.id);
    throw new Error("candidate witness captured");
  });
  snapshotState.openSettledPage.mockResolvedValueOnce({
    browser: { close: vi.fn(async () => undefined) },
    page: { evaluate },
    renderReadyTimedOut: false,
  });
  snapshotState.seek.mockResolvedValue(undefined);
  vi.stubGlobal("window", {
    devicePixelRatio: 1,
    __hfMediaId: (video: { renderId: string }) => video.renderId,
  });
  vi.stubGlobal("document", { querySelectorAll: () => videos });
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    await expect(
      snapshotCommand.run?.({
        args: { dir: project, at: "1", end: false, output: join(project, "out") },
      } as never),
    ).rejects.toBeDefined();
    expect(ids).toEqual(["clip", "clip__hf2"]);
  } finally {
    log.mockRestore();
    vi.unstubAllGlobals();
    rmSync(project, { recursive: true, force: true });
  }
});

describe("renderNotReadyError", () => {
  it("names the buildReady keys still pending and the time waited", async () => {
    const page = {
      evaluate: async () => ({
        renderReady: false,
        hasHf: true,
        hasSeek: false,
        hasPlayer: true,
        duration: -1,
        hasTimeline: true,
        declaredDuration: 12,
        pendingBuildReadyKeys: ["gltf"],
        rejectedBuildReadyKeys: [],
      }),
    };
    const error = await renderNotReadyError(page as never, 45_000);
    expect(error.message).toContain("not render-ready after 45000ms");
    expect(error.message).toContain("buildReady never resolved for: gltf");
  });

  it("still fails when the page cannot be asked why", async () => {
    const page = {
      evaluate: async () => {
        throw new Error("Target closed");
      },
    };
    const error = await renderNotReadyError(page as never, 5000);
    expect(error.message).toContain("not render-ready after 5000ms");
  });
});
