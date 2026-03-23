import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const initPath = resolve(scriptDir, "../src/runtime/init.ts");
const timelinePath = resolve(scriptDir, "../src/runtime/timeline.ts");

const initSource = readFileSync(initPath, "utf8");
const timelineSource = readFileSync(timelinePath, "utf8");

// Guard against regressions where preview duration gets capped by earliest video.
assert(
  !initSource.includes("resolveMainVideoDurationSeconds"),
  "init.ts should not use first-video duration helper",
);
assert(
  !initSource.includes("Math.max(0, Math.min(safeDuration, mediaFloor))"),
  "init.ts should not hard-clamp safe duration to media floor",
);
assert(
  initSource.includes("resolveMediaWindowDurationSeconds"),
  "init.ts should compute media window duration across timed media",
);

// Timeline payload windowing should also avoid first-video truncation.
assert(
  !timelineSource.includes("resolveMainVideoWindowEndSeconds"),
  "timeline.ts should not use first-video window end helper",
);
assert(
  timelineSource.includes("resolveMediaWindowEndSeconds"),
  "timeline.ts should compute media window end across timed media",
);

console.log(
  JSON.stringify({
    event: "hyperframe_runtime_duration_guards_verified",
    initPath,
    timelinePath,
  }),
);
