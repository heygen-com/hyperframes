import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import { consumeCommandResult } from "../utils/commandResult.js";
import init from "./init.js";

vi.mock("../telemetry/events.js", () => ({ trackInitTemplate: vi.fn() }));

const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
let dir: string;
let project: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hf-init-source-"));
  project = join(dir, "rebuild");
  mkdirSync(project);
  // What `reverse start --dir` leaves, then the video the agent downloaded into it.
  writeFileSync(
    join(project, "hyperframes.json"),
    '{\n  "authoringSkill": "reverse-any-video"\n}\n',
  );
  if (ffmpeg)
    execFileSync("ffmpeg", [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=24:duration=1"],
      ...["-c:v", "libx264", "-pix_fmt", "yuv420p", join(project, "original.mp4")],
    ]);
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

const initWithVideo = () =>
  runCommand(init, {
    rawArgs: [
      ...[project, "--video", join(project, "original.mp4"), "--example", "blank"],
      ...["--keep-original", "--skip-transcribe", "--non-interactive"],
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
