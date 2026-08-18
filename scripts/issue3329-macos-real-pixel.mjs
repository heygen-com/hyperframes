import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateArtifactRoot } from "./issue3329-artifact-safety.mjs";

const repo = process.cwd();
const artifactRoot = validateArtifactRoot(
  process.env.HF_ISSUE3329_ARTIFACT_DIR ?? join(".artifacts", "issue3329-macos"),
  repo,
);
const projectsRoot = join(artifactRoot, "projects");
const outputsRoot = join(artifactRoot, "outputs");
rmSync(artifactRoot, { recursive: true, force: true });
mkdirSync(projectsRoot, { recursive: true });
mkdirSync(outputsRoot, { recursive: true });

function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    cwd: repo,
    encoding: "utf8",
    timeout: 180_000,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${binary} ${args.join(" ")} failed (${result.status})\n${result.stdout}\n${result.stderr}`,
    );
  }
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function ffmpeg(args) {
  return run("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args]);
}

function cli(args) {
  return run("bun", ["packages/cli/src/cli.ts", ...args], {
    env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1" },
  });
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function firstFile(dir, suffix) {
  const name = readdirSync(dir).find((entry) => entry.endsWith(suffix));
  if (!name) throw new Error(`No ${suffix} output under ${dir}`);
  return join(dir, name);
}

function pixelStats(path) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      path,
      "-frames:v",
      "1",
      "-vf",
      "scale=160:90",
      "-pix_fmt",
      "rgba",
      "-f",
      "rawvideo",
      "-",
    ],
    { encoding: null },
  );
  if (result.status !== 0) throw new Error(`Pixel decode failed for ${path}`);
  const pixels = result.stdout;
  let sum = 0;
  let sumSq = 0;
  let alphaMin = 255;
  let alphaMax = 0;
  const count = pixels.length / 4;
  for (let offset = 0; offset + 3 < pixels.length; offset += 4) {
    const luma =
      0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2];
    sum += luma;
    sumSq += luma * luma;
    alphaMin = Math.min(alphaMin, pixels[offset + 3]);
    alphaMax = Math.max(alphaMax, pixels[offset + 3]);
  }
  const mean = sum / count;
  const variance = Math.max(0, sumSq / count - mean * mean);
  const stddev = Math.sqrt(variance);
  return {
    mean: Number(mean.toFixed(3)),
    stddev: Number(stddev.toFixed(3)),
    alphaMin,
    alphaMax,
    solid: stddev < 2,
  };
}

function ffprobe(path) {
  const output = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_name,codec_tag_string,pix_fmt,color_space,color_transfer,color_primaries",
      "-of",
      "json",
      "--",
      path,
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(output).streams?.[0] ?? {};
}

const sourceDir = join(artifactRoot, "source");
mkdirSync(sourceDir, { recursive: true });
const framePath = join(sourceDir, "frame.png");
const videoPath = join(sourceDir, "frame.mp4");
ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=160x90:rate=1", "-frames:v", "1", "-y", framePath]);
ffmpeg([
  "-loop",
  "1",
  "-i",
  framePath,
  "-t",
  "1",
  "-r",
  "30",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-y",
  videoPath,
]);

const gradings = {
  ungraded: null,
  adjustment: { version: 2, colorSpace: "rec709", adjust: { saturation: -0.3 } },
  kuwahara: { version: 2, colorSpace: "rec709", effects: { kuwahara: 0.8 } },
};
const ledger = {
  environment: {
    platform: process.platform,
    arch: process.arch,
    runnerOs: process.env.RUNNER_OS ?? null,
    uname: run("uname", ["-a"]).stdout,
    osVersion: process.platform === "darwin" ? run("sw_vers", []).stdout : null,
    ffmpeg: run("ffmpeg", ["-version"]).stdout.split("\n")[0],
    node: process.version,
    bun: run("bun", ["--version"]).stdout,
    eligibleMacArm64: process.platform === "darwin" && process.arch === "arm64",
  },
  source: { frame: sha256(framePath), video: sha256(videoPath) },
  rows: [],
};

const requestedCases = new Set(
  (process.env.HF_ISSUE3329_CASES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
for (const mediaKind of ["img", "video"]) {
  for (const [gradingName, grading] of Object.entries(gradings)) {
    const caseName = `${mediaKind}-${gradingName}`;
    if (requestedCases.size > 0 && !requestedCases.has(caseName)) continue;
    const projectDir = join(projectsRoot, caseName);
    mkdirSync(projectDir, { recursive: true });
    const sourceName = mediaKind === "img" ? "frame.png" : "frame.mp4";
    copyFileSync(mediaKind === "img" ? framePath : videoPath, join(projectDir, sourceName));
    const gradingAttr = grading ? ` data-color-grading='${JSON.stringify(grading)}'` : "";
    const media =
      mediaKind === "img"
        ? `<img id="media" src="${sourceName}"${gradingAttr} style="position:absolute;inset:0;width:160px;height:90px;object-fit:fill">`
        : `<video id="media" src="${sourceName}" data-start="0" data-duration="1" muted playsinline${gradingAttr} style="position:absolute;inset:0;width:160px;height:90px;object-fit:fill"></video>`;
    writeFileSync(
      join(projectDir, "index.html"),
      `<!doctype html><html><body style="margin:0;background:#123"><div id="root" data-composition-id="${caseName}" data-root="true" data-start="0" data-duration="1" data-width="160" data-height="90" data-fps="1">${media}</div></body></html>`,
    );

    const caseOut = join(outputsRoot, caseName);
    const runtimeDir = join(caseOut, "runtime");
    const rawDir = join(caseOut, "raw");
    mkdirSync(runtimeDir, { recursive: true });
    cli([
      "snapshot",
      projectDir,
      "--at",
      "0.5",
      "--no-end",
      "--output",
      runtimeDir,
      "--describe",
      "false",
    ]);
    cli([
      "render",
      projectDir,
      "--format",
      "png-sequence",
      "--output",
      rawDir,
      "--fps",
      "1",
      "--workers",
      "1",
      "--quiet",
    ]);
    const h264Path = join(caseOut, "h264.mp4");
    const proresPath = join(caseOut, "prores.mov");
    cli([
      "render",
      projectDir,
      "--format",
      "mp4",
      "--output",
      h264Path,
      "--fps",
      "1",
      "--workers",
      "1",
      "--quiet",
    ]);
    cli([
      "render",
      projectDir,
      "--format",
      "mov",
      "--output",
      proresPath,
      "--fps",
      "1",
      "--workers",
      "1",
      "--quiet",
    ]);
    const runtimePath = firstFile(runtimeDir, ".png");
    const rawPath = firstFile(rawDir, ".png");
    const hevcPath = join(caseOut, "hevc.mp4");
    ffmpeg([
      "-loop",
      "1",
      "-i",
      rawPath,
      "-t",
      "1",
      "-r",
      "1",
      "-c:v",
      "libx265",
      "-tag:v",
      "hvc1",
      "-pix_fmt",
      "yuv420p",
      "-y",
      hevcPath,
    ]);

    const boundaries = {};
    for (const [name, path] of Object.entries({
      runtime: runtimePath,
      raw: rawPath,
      h264: h264Path,
      prores: proresPath,
      hevc: hevcPath,
    })) {
      boundaries[name] = {
        path,
        sha256: sha256(path),
        bytes: readFileSync(path).length,
        pixels: pixelStats(path),
        ...(name === "h264" || name === "prores" || name === "hevc"
          ? { stream: ffprobe(path) }
          : {}),
      };
    }
    const firstCorrupt = ["runtime", "raw", "h264", "prores", "hevc"].find(
      (name) => boundaries[name].pixels.solid,
    );
    ledger.rows.push({
      caseName,
      mediaKind,
      gradingName,
      firstCorrupt: firstCorrupt ?? null,
      boundaries,
    });
  }
}

const controls = new Map(
  ledger.rows.filter((row) => row.gradingName === "ungraded").map((row) => [row.mediaKind, row]),
);
const infrastructureFailures = ledger.rows
  .filter((row) => row.gradingName === "ungraded")
  .flatMap((row) =>
    Object.entries(row.boundaries)
      .filter(([, value]) => value.pixels.solid)
      .map(([boundary]) => `${row.caseName}@${boundary}`),
  );
const productRed = ledger.rows
  .filter((row) => row.gradingName !== "ungraded")
  .flatMap((row) => {
    const control = controls.get(row.mediaKind);
    if (!control) return [];
    return Object.entries(row.boundaries)
      .filter(
        ([boundary, value]) =>
          value.pixels.solid && control.boundaries[boundary]?.pixels.solid === false,
      )
      .map(([boundary]) => `${row.caseName}@${boundary}`);
  });
ledger.classification = !ledger.environment.eligibleMacArm64
  ? "ineligible_environment"
  : infrastructureFailures.length > 0
    ? "fixture_or_capture_infrastructure_failure"
    : productRed.length > 0
      ? "product_red"
      : "no_reproduction";
ledger.infrastructureFailures = infrastructureFailures;
ledger.productRed = productRed;
writeFileSync(join(artifactRoot, "ledger.json"), `${JSON.stringify(ledger, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      artifactRoot,
      environment: ledger.environment,
      rows: ledger.rows.map(({ caseName, firstCorrupt, boundaries }) => ({
        caseName,
        firstCorrupt,
        stddev: Object.fromEntries(
          Object.entries(boundaries).map(([name, value]) => [name, value.pixels.stddev]),
        ),
      })),
    },
    null,
    2,
  ),
);
if (!ledger.environment.eligibleMacArm64) {
  throw new Error(
    `INELIGIBLE_ENVIRONMENT: expected darwin/arm64, got ${process.platform}/${process.arch}`,
  );
}
if (infrastructureFailures.length > 0) {
  throw new Error(
    `INFRASTRUCTURE_FAILURE: ungraded controls are solid at ${infrastructureFailures.join(", ")}`,
  );
}
if (productRed.length > 0) {
  throw new Error(
    `PRODUCT_RED: graded output is solid while its matching control is non-solid at ${productRed.join(", ")}`,
  );
}
