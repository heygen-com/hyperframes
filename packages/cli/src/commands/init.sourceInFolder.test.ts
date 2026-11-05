import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
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
const caseBlind = (() => {
  const probe = mkdtempSync(join(tmpdir(), "hf-case-"));
  writeFileSync(join(probe, "a"), "");
  const blind = existsSync(join(probe, "A"));
  rmSync(probe, { recursive: true, force: true });
  return blind;
})();
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
    ...["-of", "csv=p=0", "--", file],
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

it.skipIf(!ffmpeg || !caseBlind)(
  "scaffolds when the video in the folder is named in another case on a case-blind disk",
  async () => {
    renameSync(join(project, "original.mp4"), join(project, "Original.MP4"));
    const video = readFileSync(join(project, "Original.MP4"));
    await initWithVideo(join(project, "original.mp4"));
    expect(existsSync(join(project, "index.html"))).toBe(true);
    expect(readFileSync(join(project, "Original.MP4")).equals(video)).toBe(true);
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

it.skipIf(!hevc).each(["original.mp4", "original.MP4"])(
  "transcodes an HEVC %s already in the folder beside it, keeping the original",
  async (name) => {
    rmSync(join(project, "original.mp4"));
    const source = join(project, name);
    encode(source, ["-c:v", "libx265", "-tag:v", "hvc1"]);
    const video = readFileSync(source);
    await initWithVideo(source, false);
    // On a case-sensitive disk original.mp4 is a free name beside original.MP4.
    const out = name === "original.mp4" || caseBlind ? "original.h264.mp4" : "original.mp4";
    expect(readFileSync(source).equals(video)).toBe(true);
    expect(codecOf(join(project, out))).toBe("h264");
    expect(readFileSync(join(project, "index.html"), "utf-8")).toContain(out);
  },
  60_000,
);

const linkKinds = [
  ["hard link", linkSync],
  ["symlink", symlinkSync],
] as const;

it.skipIf(!hevc).each(linkKinds)(
  "never transcodes onto the HEVC source through a %s where its .mp4 would go",
  async (_, link) => {
    rmSync(join(project, "original.mp4"));
    const source = join(project, "original.mov");
    encode(source, ["-c:v", "libx265", "-tag:v", "hvc1"]);
    link(source, join(project, "original.mp4"));
    const video = readFileSync(source);
    await initWithVideo(source, false);
    expect(readFileSync(source).equals(video)).toBe(true);
    expect(codecOf(source)).toBe("hevc");
    expect(codecOf(join(project, "original.h264.mp4"))).toBe("h264");
  },
  60_000,
);

it.skipIf(!hevc).each(linkKinds)(
  "never transcodes onto the HEVC source through a %s where its .h264.mp4 would go",
  async (_, link) => {
    rmSync(join(project, "original.mp4"));
    const source = join(project, "original.mp4");
    encode(source, ["-c:v", "libx265", "-tag:v", "hvc1"]);
    link(source, join(project, "original.h264.mp4"));
    const video = readFileSync(source);
    await initWithVideo(source, false);
    expect(readFileSync(source).equals(video)).toBe(true);
    expect(codecOf(source)).toBe("hevc");
    expect(codecOf(join(project, "original.h264-2.mp4"))).toBe("h264");
  },
  60_000,
);

it.skipIf(!hevc)(
  "never transcodes onto the HEVC source when it is named through a linked folder",
  async () => {
    rmSync(join(project, "original.mp4"));
    encode(join(project, "original.mp4"), ["-c:v", "libx265", "-tag:v", "hvc1"]);
    const alias = join(dir, "alias");
    symlinkSync(project, alias);
    const source = join(alias, "original.mp4");
    const video = readFileSync(source);
    await initWithVideo(source, false);
    expect(readFileSync(source).equals(video)).toBe(true);
    expect(codecOf(source)).toBe("hevc");
    expect(codecOf(join(project, "original.h264.mp4"))).toBe("h264");
  },
  60_000,
);
