#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { compileCutList } from "./lib/cutlist.mjs";
import { track } from "./lib/telemetry.mjs";

const { values: args } = parseArgs({
  options: {
    input: { type: "string" },
    transcript: { type: "string" },
    remove: { type: "string" },
    "remove-words": { type: "string" },
    "remove-fillers": { type: "string" },
    "cut-silence": { type: "string" },
    keep: { type: "string" },
    copy: { type: "boolean", default: false },
    plan: { type: "boolean", default: false },
    out: { type: "string" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (args.help) {
  console.log(`media-use transcript-cut — compile transcript edits into video cuts

Usage:
  node transcript-cut.mjs --input in.mp4 --transcript transcript.json --remove "12-15" --out out.mp4

Options:
  --input             Source video/audio file
  --transcript        JSON word transcript, array or { words: [...] }
  --remove            Time ranges to remove, seconds: a-b,c-d
  --remove-words      Word-index ranges to remove: 12-18,40-41
  --remove-fillers    Comma list of filler words to remove
  --cut-silence       Remove inter-word gaps longer than this many seconds
  --keep              Inverse mode: direct kept ranges, mutually exclusive with removal
  --copy              Use stream copy for faster, keyframe-snapped cuts
  --plan              Print kept segment JSON and exit without ffmpeg
  --out               Output file
  --json              Output JSON status
  --help, -h          Show this help`);
  process.exit(0);
}

try {
  run();
  await track("media_use_transcript_cut", {
    mode: args.plan ? "plan" : "encode",
    remove_fillers: !!args["remove-fillers"],
    cut_silence: !!args["cut-silence"],
    ranges: !!args.remove,
    keep: !!args.keep,
  });
} catch (err) {
  if (args.json) console.log(JSON.stringify({ ok: false, error: err.message }));
  else console.error(`error: ${err.message}`);
  process.exit(1);
}

function run() {
  if (!args.transcript) throw new Error("--transcript is required");
  const transcript = JSON.parse(readFileSync(resolve(args.transcript), "utf8"));
  const segments = compileCutList(transcript, {
    remove: args.remove,
    removeWords: args["remove-words"],
    removeFillers: args["remove-fillers"],
    cutSilence: args["cut-silence"],
    keep: args.keep,
  });

  if (args.plan) {
    console.log(JSON.stringify(segments));
    return;
  }

  if (!args.input || !args.out)
    throw new Error("--input and --out are required unless --plan is set");
  if (segments.length === 0) throw new Error("cut list has no kept segments");

  const inputPath = resolve(args.input);
  const outPath = resolve(args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  const tmpDir = mkdtempSync(join(tmpdir(), "media-use-cut-"));
  const keptSeconds = sumDurations(segments);
  const totalSeconds = probeDuration(inputPath);

  try {
    const parts = segments.map((segment, index) => {
      const out = join(
        tmpDir,
        `segment-${String(index).padStart(4, "0")}${extname(outPath) || ".mp4"}`,
      );
      cutSegment(inputPath, segment, out, Boolean(args.copy));
      return out;
    });
    const listPath = join(tmpDir, "list.txt");
    writeFileSync(
      listPath,
      parts.map((part) => `file '${escapeConcatPath(part)}'`).join("\n") + "\n",
    );
    // Encode to a sibling temp (same extension so ffmpeg picks the right muxer),
    // then atomic-rename so a SIGKILL mid-encode can't leave a truncated outPath.
    const tmpOut = `${outPath}.part${extname(outPath) || ".mp4"}`;
    execFileSync(
      "ffmpeg",
      ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", tmpOut],
      {
        stdio: "ignore",
      },
    );
    renameSync(tmpOut, outPath);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  // Stream copy can only cut on keyframes; on sparse-keyframe footage the snap
  // can silently swallow the whole cut. Compare, then surface the drift in BOTH
  // the stderr warning (human) and the --json result (pipelines).
  let copyDrift = null;
  if (args.copy) {
    const outSeconds = probeDuration(outPath);
    if (Math.abs(outSeconds - keptSeconds) > 1) {
      copyDrift = { produced_s: round3(outSeconds), expected_s: round3(keptSeconds) };
      if (!args.json) {
        console.error(
          `warning: --copy keyframe snapping produced ${round3(outSeconds)}s instead of ${round3(keptSeconds)}s kept; drop --copy for frame-accurate cuts`,
        );
      }
    }
  }

  if (args.json) {
    console.log(
      JSON.stringify({
        ok: true,
        input: inputPath,
        out: outPath,
        segments,
        kept_s: round3(keptSeconds),
        total_s: round3(totalSeconds),
        ...(copyDrift && { copy_drift: copyDrift }),
      }),
    );
    return;
  }

  console.log(
    `cut ${inputPath} -> ${outPath} (${segments.length} segments, ${fmt(keptSeconds)}s kept of ${fmt(
      totalSeconds,
    )}s)`,
  );
  console.log(`next: resolve --from ${outPath} --type <type>`);
}

function cutSegment(inputPath, segment, outPath, copy) {
  const argv = [
    "-y",
    "-nostdin",
    "-ss",
    fmt(segment.start),
    "-i",
    inputPath,
    "-to",
    fmt(segment.end - segment.start),
  ];
  if (copy) {
    argv.push("-c", "copy", "-avoid_negative_ts", "make_zero");
  } else {
    argv.push(...encodeArgsFor(extname(outPath).toLowerCase()));
  }
  argv.push(outPath);
  execFileSync("ffmpeg", argv, { stdio: "ignore" });
}

// Codec set per output container. Audio-only outputs must not get the
// video-centric aac/x264 set (aac inside .wav breaks timing entirely).
function encodeArgsFor(ext) {
  if (ext === ".wav") return ["-c:a", "pcm_s16le"];
  if (ext === ".mp3") return ["-c:a", "libmp3lame", "-q:a", "2"];
  if (ext === ".m4a" || ext === ".aac") return ["-c:a", "aac"];
  if (ext === ".flac") return ["-c:a", "flac"];
  return [
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
  ];
}

function probeDuration(filePath) {
  const raw = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ],
    { encoding: "utf8" },
  );
  const duration = Number(raw.trim());
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error(`could not probe duration: ${filePath}`);
  return duration;
}

function escapeConcatPath(filePath) {
  return filePath.replace(/'/g, "'\\''");
}

function sumDurations(segments) {
  return segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0);
}

function fmt(n) {
  return round3(n)
    .toFixed(3)
    .replace(/\.?0+$/, "");
}

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}
