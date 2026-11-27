import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runCommand } from "citty";
import { consumeCommandResult } from "./commandResult.js";

vi.mock("../telemetry/events.js", () => ({ trackInitTemplate: vi.fn() }));

const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
let dir: string;
let list: string;
let printed: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hf-playlist-refusal-"));
  mkdirSync(join(dir, "project"));
  // An HLS list under a media name whose one entry is outside the project.
  list = join(dir, "project", "clip.mp4");
  writeFileSync(list, "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n../../elsewhere.ts\n");
  vi.stubEnv("HYPERFRAMES_SKIP_SKILLS", "1");
  vi.spyOn(console, "log").mockImplementation(() => {});
  printed = [];
  vi.spyOn(console, "error").mockImplementation(
    (...line: unknown[]) => void printed.push(line.join(" ")),
  );
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  consumeCommandResult();
});

const OUTSIDE = /playlist naming files outside its/;

it.each([
  {
    command: "init --video",
    run: async () => {
      const init = (await import("../commands/init.js")).default;
      return runCommand(init, {
        rawArgs: [join(dir, "made"), "--video", list, "--example", "blank"].concat([
          "--skip-transcribe",
          "--non-interactive",
        ]),
      });
    },
  },
  {
    command: "media-use generate",
    run: async () => {
      const { generate } = await import("../heygen/generate.js");
      return generate({
        type: "lipsync",
        video: list,
        audio: list,
        out: join(dir, "made", "a.mp4"),
      });
    },
  },
  {
    command: "transcribe",
    run: async () => {
      const { runTranscribe } = await import("../api/transcribe.js");
      return runTranscribe({ input: list, dir: join(dir, "made"), engine: "none" });
    },
  },
  {
    command: "audio --read",
    run: async () => {
      const { readAudio } = await import("../audio/read/read.js");
      return readAudio(list, "clip.mp4", { cacheDir: join(dir, "made") });
    },
  },
  {
    command: "the engine probe of a file: URL",
    run: async () => {
      const { extractMediaMetadata } = await import("@hyperframes/engine");
      return extractMediaMetadata(pathToFileURL(list).href);
    },
  },
  ...(ffmpeg
    ? [
        {
          command: "remove-background (the engine probe)",
          run: async () => {
            const { render } = await import("../background-removal/pipeline.js");
            return render({ inputPath: list, outputPath: join(dir, "made", "a.webm") });
          },
        },
      ]
    : []),
])("$command refuses a list leaving its folder before it writes anything", async ({ run }) => {
  const outcome = await run().then(
    () => "",
    (error: unknown) => String(error),
  );
  expect([outcome, ...printed].join("\n")).toMatch(OUTSIDE);
  expect(existsSync(join(dir, "made"))).toBe(false);
});
