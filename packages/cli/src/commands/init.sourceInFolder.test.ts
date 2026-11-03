import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import { consumeCommandResult } from "../utils/commandResult.js";
import init from "./init.js";

vi.mock("../telemetry/events.js", () => ({ trackInitTemplate: vi.fn() }));

const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const hevc =
  ffmpeg && spawnSync("ffmpeg", ["-hide_banner", "-encoders"]).stdout.includes("libx265");
let dir: string;
let project: string;

const encode = (out: string, codec: string[]) =>
  execFileSync("ffmpeg", [
    ...["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=24:duration=1"],
    ...codec,
    ...["-pix_fmt", "yuv420p", out],
  ]);
const codecOf = (file: string) =>
  execFileSync("ffprobe", [
    ...["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name"],
    ...["-of", "csv=p=0", file],
  ])
    .toString()
    .trim();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hf-init-source-"));
  project = join(dir, "rebuild");
  mkdirSync(project);
  // What `reverse start --dir` leaves, then the video the agent downloaded into it.
  writeFileSync(
    join(project, "hyperframes.json"),
    '{\n  "authoringSkill": "reverse-any-video"\n}\n',
  );
  if (ffmpeg) encode(join(project, "original.mp4"), ["-c:v", "libx264"]);
  vi.stubEnv("HYPERFRAMES_SKIP_SKILLS", "1");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  consumeCommandResult();
});

const initWithVideo = (video = join(project, "original.mp4"), keepOriginal = true) =>
  runCommand(init, {
    rawArgs: [
      ...[project, "--video", video, "--example", "blank"],
      ...(keepOriginal ? ["--keep-original"] : []),
      ...["--skip-transcribe", "--non-interactive"],
    ],
  });

it.skipIf(!ffmpeg)(
  "scaffolds into the folder that already holds the video it was given",
  async () => {
    const video = readFileSync(join(project, "original.mp4"));
    await initWithVideo();
    expect(existsSync(join(project, "index.html"))).toBe(true);
    expect(readFileSync(join(project, "original.mp4")).equals(video)).toBe(true);
    expect(readFileSync(join(project, "hyperframes.json"), "utf-8")).toContain("reverse-any-video");
  },
);

it.skipIf(!ffmpeg)("still refuses a folder holding anything else", async () => {
  writeFileSync(join(project, "notes.txt"), "mine");
  await initWithVideo().catch(() => undefined);
  expect(existsSync(join(project, "index.html"))).toBe(false);
});

it.skipIf(!ffmpeg).each(["index.html", "meta.json", "AGENTS.md"])(
  "refuses a video named %s, a file the scaffold writes, and leaves it as it was",
  async (name) => {
    const source = join(project, name);
    copyFileSync(join(project, "original.mp4"), source);
    rmSync(join(project, "original.mp4"));
    const video = readFileSync(source);
    await initWithVideo(source).catch(() => undefined);
    expect(readFileSync(source).equals(video)).toBe(true);
    expect(existsSync(join(project, name === "index.html" ? "meta.json" : "index.html"))).toBe(
      false,
    );
  },
);

it.skipIf(!hevc)(
  "transcodes an HEVC .mp4 already in the folder beside it, keeping the original",
  async () => {
    const source = join(project, "original.mp4");
    encode(source, ["-c:v", "libx265", "-tag:v", "hvc1"]);
    const video = readFileSync(source);
    await initWithVideo(source, false);
    expect(readFileSync(source).equals(video)).toBe(true);
    expect(codecOf(join(project, "original.h264.mp4"))).toBe("h264");
    expect(readFileSync(join(project, "index.html"), "utf-8")).toContain("original.h264.mp4");
  },
  60_000,
);
