import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import { CliRuntimeError, CliUsageError, consumeCommandResult } from "../utils/commandResult.js";
import init from "./init.js";

vi.mock("../telemetry/events.js", () => ({ trackInitTemplate: vi.fn() }));

let dir: string;
let errors: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hf-init-timeline-flags-"));
  mkdirSync(join(dir, "media"));
  writeFileSync(join(dir, "media", "a.mp4"), "not really a video");
  writeFileSync(
    join(dir, "timeline.json"),
    JSON.stringify({
      schema: "hyperframes-timeline/1",
      fps: { num: 30, den: 1 },
      width: 1280,
      height: 720,
      clips: [{ id: "a", kind: "video", start: 0, duration: 2, src: "media/a.mp4" }],
    }),
  );
  errors = [];
  vi.stubEnv("HYPERFRAMES_SKIP_SKILLS", "1");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.join(" "));
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  consumeCommandResult();
});

const project = () => join(dir, "out");
const timeline = () => join(dir, "timeline.json");

/** Runs `init` and reports how it ended: a usage error, a runtime error or success, and whether it
 * left a project behind. */
async function run(...flags: string[]) {
  let kind: "success" | "usage_error" | "runtime_error" = "success";
  await runCommand(init, { rawArgs: [project(), ...flags, "--non-interactive"] }).catch(
    (thrown: unknown) => {
      kind =
        thrown instanceof CliUsageError
          ? "usage_error"
          : thrown instanceof CliRuntimeError
            ? "runtime_error"
            : "runtime_error";
    },
  );
  consumeCommandResult();
  return { kind, created: existsSync(project()) };
}

describe("init --timeline and the other flags", () => {
  it("builds a project from a timeline", async () => {
    const result = await run("--timeline", timeline());
    expect(result).toEqual({ kind: "success", created: true });
    expect(readFileSync(join(project(), "index.html"), "utf-8")).toContain('id="a"');
    expect(existsSync(join(project(), "assets", "a.mp4"))).toBe(true);
  });

  it.each([
    ["--video", join("media", "a.mp4")],
    ["--audio", join("media", "a.mp4")],
    ["--example", "blank"],
    ["--tailwind"],
    ["--resolution", "4k"],
  ])("refuses %s, and leaves nothing behind", async (...flag) => {
    const result = await run(
      "--timeline",
      timeline(),
      ...flag.map((f) => (f.startsWith("media") ? join(dir, f) : f)),
    );
    expect(result).toEqual({ kind: "usage_error", created: false });
    expect(errors.join("\n")).toContain("--timeline cannot be combined with");
  });

  it("names every flag it refuses, and only those", () => {
    const message = readFileSync(join(import.meta.dirname, "init.ts"), "utf-8").match(
      /--timeline cannot be combined with ([^"]+)"/,
    )?.[1];
    expect(message).toBe("--video, --audio, --example, --tailwind or --resolution");
  });

  it.each([["--media-root", "/anywhere"], ["--link-media"]])(
    "refuses %s without --timeline, rather than ignoring it",
    async (...flag) => {
      const result = await run(...flag);
      expect(result).toEqual({ kind: "usage_error", created: false });
      expect(errors.join("\n")).toContain("only apply together with --timeline");
    },
  );

  it("accepts --media-root and --link-media with --timeline", async () => {
    const result = await run(...["--timeline", timeline(), "--media-root", dir, "--link-media"]);
    expect(result.kind).toBe("success");
  });

  // These belong to --video and --audio (transcription and conversion). With a timeline they have
  // nothing to act on, as with a plain `init` that is given no media: accepted, with no effect.
  it.each([
    ["--skip-transcribe"],
    ["--keep-original"],
    ["--model", "tiny.en"],
    ["--language", "en"],
    ["--skip-skills"],
    ["--agent"],
  ])("accepts %s and ignores it", async (...flag) => {
    expect(await run("--timeline", timeline(), ...flag)).toEqual({
      kind: "success",
      created: true,
    });
  });

  it("records --skill in the project, as init always does", async () => {
    await run("--timeline", timeline(), "--skill", "import-timeline");
    expect(readFileSync(join(project(), "hyperframes.json"), "utf-8")).toContain(
      '"authoringSkill": "import-timeline"',
    );
  });

  it("still reports the renamed flags first", async () => {
    const result = await run("--timeline", timeline(), "--template", "blank");
    expect(result).toEqual({ kind: "usage_error", created: false });
    expect(errors.join("\n")).toContain("renamed to --example");
  });

  it("refuses a timeline file that does not exist, and leaves nothing behind", async () => {
    const result = await run("--timeline", join(dir, "missing.json"));
    expect(result.created).toBe(false);
    expect(result.kind).not.toBe("success");
  });
});
