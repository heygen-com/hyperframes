// @vitest-environment node

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  analyzeMediaGrade,
  formatMeasuredNote,
  gradeSampleTimes,
  parseMediaTreatmentSignalStats,
  statsToAdjust,
  summarizeMediaTreatmentAnalysis,
  type GradeMediaProbe,
} from "./mediaGradeAnalyzer";

const SIGNALSTATS = `frame:0 pts:0 pts_time:0
lavfi.signalstats.YMIN=4
lavfi.signalstats.YLOW=8
lavfi.signalstats.YAVG=100
lavfi.signalstats.YHIGH=240
lavfi.signalstats.YMAX=250
lavfi.signalstats.UAVG=120
lavfi.signalstats.VAVG=140
lavfi.signalstats.SATAVG=40
frame:1 pts:1 pts_time:1
lavfi.signalstats.YMIN=20
lavfi.signalstats.YLOW=20
lavfi.signalstats.YAVG=120
lavfi.signalstats.YHIGH=220
lavfi.signalstats.YMAX=230
lavfi.signalstats.UAVG=125
lavfi.signalstats.VAVG=135
lavfi.signalstats.SATAVG=60`;

const UNDEREXPOSED_SIGNALSTATS = `frame:0 pts:0 pts_time:0
lavfi.signalstats.YMIN=2
lavfi.signalstats.YLOW=8
lavfi.signalstats.YAVG=50
lavfi.signalstats.YHIGH=120
lavfi.signalstats.YMAX=135
lavfi.signalstats.UAVG=128
lavfi.signalstats.VAVG=128
lavfi.signalstats.SATAVG=30`;

const BLOWN_HIGHLIGHT_SIGNALSTATS = `frame:0 pts:0 pts_time:0
lavfi.signalstats.YMIN=70
lavfi.signalstats.YLOW=90
lavfi.signalstats.YAVG=200
lavfi.signalstats.YHIGH=248
lavfi.signalstats.YMAX=255
lavfi.signalstats.UAVG=128
lavfi.signalstats.VAVG=128
lavfi.signalstats.SATAVG=30`;

const PROBE: GradeMediaProbe = {
  duration: 4,
  colorSpace: "bt2020nc",
  transfer: "smpte2084",
  primaries: "bt2020",
  pixelFormat: "yuv420p10le",
};

function productResult(signalStats = SIGNALSTATS) {
  const frames = parseMediaTreatmentSignalStats(signalStats);
  const summary = summarizeMediaTreatmentAnalysis(PROBE, frames);
  return {
    frames,
    summary,
    adjust: statsToAdjust(summary.measured),
    note: formatMeasuredNote("/tmp/frame.png", summary.measured),
  };
}

async function vendoredResult(signalStats = SIGNALSTATS) {
  const moduleUrl = new URL(
    "../../../packages/cli/src/media-use/lib/grade-analyzer.mjs",
    import.meta.url,
  );
  const analyzer = await import(moduleUrl.href);
  const frames = analyzer.parseMediaTreatmentSignalStats(signalStats);
  const summary = analyzer.summarizeMediaTreatmentAnalysis(PROBE, frames);
  return {
    frames,
    summary,
    adjust: analyzer.statsToAdjust(summary.measured),
    note: analyzer.formatMeasuredNote("/tmp/frame.png", summary.measured),
  };
}

describe("vendored media grade analyzer parity", () => {
  it("keeps the standalone skill copy aligned with the typed product module", async () => {
    expect(await vendoredResult()).toEqual(productResult());
  });

  it.each([
    ["underexposed", UNDEREXPOSED_SIGNALSTATS, 1],
    ["blown-highlight", BLOWN_HIGHLIGHT_SIGNALSTATS, -1],
  ])("covers the %s exposure branch", async (_, signalStats, expectedSign) => {
    const product = productResult(signalStats);

    expect(Math.sign(product.adjust.adjust.exposure)).toBe(expectedSign);
    expect(await vendoredResult(signalStats)).toEqual(product);
  });

  it("seeks to the same sample times", async () => {
    const analyzer = await import(
      new URL("../../../packages/cli/src/media-use/lib/grade-analyzer.mjs", import.meta.url).href
    );
    for (const duration of [0.4, 12, 300]) {
      expect(analyzer.gradeSampleTimes(duration)).toEqual(gradeSampleTimes(duration));
    }
  });
});

// Stand-in ffprobe and ffmpeg that log every call's arguments and answer as the analyzers expect: a demuxer listing
// (for the core module's format list), probe JSON, and signal stats.
function standIns(dir: string): {
  ffprobePath: string;
  ffmpegPath: string;
  calls: () => string[][];
} {
  mkdirSync(dir, { recursive: true });
  const log = join(dir, "calls.log");
  const listing = [
    "mov,mp4,m4a,3gp,3g2,mj2",
    ...["matroska,webm", "mxf", "avi", "mpeg", "mpegts", "mpegvideo", "flv", "asf", "ogg"],
    ...["wav", "mp3", "aac", "flac", "aiff", "caf", "w64", "wv", "au", "ac3"],
    ...["gif", "ico", "image2", "png_pipe", "jpeg_pipe"],
    ...["webp_pipe", "bmp_pipe", "tiff_pipe", "hls", "concat", "dash", "avisynth", "tty"],
  ]
    .map((name) => ` D  ${name} demuxer`)
    .join("\\n");
  const script = [
    "#!/bin/sh",
    `for a in "$@"; do printf '%s\\n' "$a"; done >> '${log}'`,
    `echo @@END@@ >> '${log}'`,
    'case " $* " in',
    `  *" -demuxers "*) printf '${listing}\\n' ;;`,
    `  *"-show_entries"*) echo '{"streams":[{"pix_fmt":"yuv420p","duration":"2"}],"format":{"duration":"2"}}' ;;`,
    `  *) printf '${SIGNALSTATS.replaceAll("\n", "\\n")}\\n' ;;`,
    "esac",
  ].join("\n");
  for (const name of ["ffprobe", "ffmpeg"]) {
    writeFileSync(join(dir, name), `${script}\n`);
    chmodSync(join(dir, name), 0o755);
  }
  const calls = () =>
    readFileSync(log, "utf8")
      .split("@@END@@\n")
      .map((call) => call.split("\n").filter(Boolean))
      .filter((call) => call.length > 0 && !call.includes("-demuxers"));
  return { ffprobePath: join(dir, "ffprobe"), ffmpegPath: join(dir, "ffmpeg"), calls };
}

/** The readers a call allows for `file`, from its `-format_whitelist`; null when it sets none before the file. */
function readersFor(call: string[], file: string): Set<string> | null {
  const at = call.indexOf("-format_whitelist");
  if (at < 0 || at > call.indexOf(file)) return null;
  return new Set(call[at + 1]!.split(","));
}

describe.skipIf(process.platform === "win32")("vendored analyzer input limits", () => {
  it("open each file with no reader the core module would not use, and only from a local file", async () => {
    const root = mkdtempSync(join(tmpdir(), "grade-inputs-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const file = join(root, "clip.mp4");
    writeFileSync(file, "not read");
    const core = standIns(join(root, "core"));
    analyzeMediaGrade(file, core);
    const vendored = standIns(join(root, "vendored"));
    const analyzer = await import(
      new URL("../../../packages/cli/src/media-use/lib/grade-analyzer.mjs", import.meta.url).href
    );
    analyzer.analyzeMediaGrade(file, vendored);
    const coreCalls = core.calls();
    const vendoredCalls = vendored.calls();
    expect(coreCalls.length).toBeGreaterThanOrEqual(2);
    expect(vendoredCalls.length).toBe(coreCalls.length);
    vendoredCalls.forEach((call, index) => {
      const allowed = readersFor(coreCalls[index]!, file);
      const ours = readersFor(call, file);
      expect(allowed, coreCalls[index]!.join(" ")).not.toBeNull();
      expect(ours, call.join(" ")).not.toBeNull();
      expect([...ours!].filter((reader) => !allowed!.has(reader))).toEqual([]);
      expect(call[call.indexOf("-protocol_whitelist") + 1]).toBe("file");
    });
  });
});

describe("signal-stats frame headers", () => {
  it.each([
    ["frame:123 pts:42 pts_time:-12.5", -12.5],
    ["frame:000pts_time:+.25", 0.25],
    ["frame:1 pts_time:1 pts_time:2.5", 2.5],
    ["frame:1 pts_time:1 pts_time:invalid", 1],
    ["frame:1 pts_time:12.", 12],
    ["frame:1 pts_time:2e3", 2],
    ["frame: pts_time:1", undefined],
    ["frame:-1 pts_time:1", undefined],
    ["prefix frame:1 pts_time:1", undefined],
    ["frame:1\u2028pts_time:1", undefined],
    ["frame:" + "0".repeat(100_000) + "!", undefined],
    ["frame:" + "0".repeat(100_000) + " pts_time:-.5", -0.5],
  ])("preserves header parsing (case %#)", async (header, ptsTime) => {
    const raw = SIGNALSTATS.replace("frame:0 pts:0 pts_time:0", String(header));
    const product = productResult(raw);
    expect(product.frames).toHaveLength(2);
    expect(product.frames[0]?.ptsTime).toBe(ptsTime);
    expect(product.frames[1]?.ptsTime).toBe(1);
    expect(await vendoredResult(raw)).toEqual(product);
  });
});
