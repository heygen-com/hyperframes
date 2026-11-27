import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";

const ESC = String.fromCharCode(27);
const ODD = `od${ESC}[2Jd\x07`;
const SHOWN = "od\\x1b[2Jd\\x07";

const fake = vi.hoisted(() => ({
  lines: [] as string[],
  attended: false,
  confirmAnswer: false,
  templates: [] as Array<Record<string, string>>,
  fetchRemoteTemplate: vi.fn(),
  updateSkills: vi.fn(),
}));

vi.mock("../utils/attendedTerminal.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/attendedTerminal.js")>()),
  isUnattended: () => !fake.attended,
}));
vi.mock("@clack/prompts", () => {
  const say = (message: string) => void fake.lines.push(message);
  return {
    intro: () => undefined,
    cancel: () => undefined,
    isCancel: () => false,
    note: (body: string, title: string) => void fake.lines.push(title, body),
    confirm: async (opts: { message: string }) => {
      fake.lines.push(opts.message);
      return fake.confirmAnswer;
    },
    select: async (opts: { options: Array<{ label: string; hint?: string }> }) => {
      for (const option of opts.options) fake.lines.push(`${option.label} ${option.hint}`);
      return "blank";
    },
    spinner: () => (fake.lines.push("(spinner)"), { start: say, stop: say, message: say }),
    log: { info: say, warn: say, error: say },
  };
});
vi.mock("../ui/banner.js", () => ({ printBanner: () => undefined }));
vi.mock("../telemetry/events.js", () => ({ trackInitTemplate: () => undefined }));
vi.mock("../templates/remote.js", () => ({ fetchRemoteTemplate: fake.fetchRemoteTemplate }));
vi.mock("../templates/generators.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../templates/generators.js")>();
  return {
    ...actual,
    resolveTemplateList: async () => [...actual.BUNDLED_TEMPLATES, ...fake.templates],
  };
});
vi.mock("./skills.js", () => ({ updateSkills: fake.updateSkills }));
vi.mock("./preview.js", () => ({ default: { meta: { name: "preview" }, run: () => undefined } }));

const { default: initCommand } = await import("./init.js");

let work: string;

const printed = (): string =>
  fake.lines.join("\n").replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");

function expectNoControlCharacters(): void {
  expect(printed()).not.toContain(ESC);
  expect(printed()).not.toContain("\x07");
}

function run(args: Record<string, unknown>): Promise<unknown> {
  return Promise.resolve(
    initCommand.run?.({
      args: { "skip-skills": true, ...args },
      rawArgs: [],
      cmd: initCommand,
    } as never),
  );
}

function oddFile(name: string): string {
  const path = join(work, name);
  writeFileSync(path, "");
  return path;
}

beforeEach(() => {
  fake.lines.length = 0;
  fake.attended = false;
  fake.confirmAnswer = false;
  fake.templates = [];
  fake.fetchRemoteTemplate.mockReset().mockRejectedValue(new Error(`gone ${ODD}\nsecond line`));
  fake.updateSkills.mockReset().mockRejectedValue(new Error(`no skills ${ODD}`));
  work = mkdtempSync(join(tmpdir(), "hf-init-output-"));
  for (const method of ["log", "error", "warn"] as const)
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      fake.lines.push(args.join(" "));
    });
});

afterEach(() => {
  consumeCommandResult();
  vi.restoreAllMocks();
  rmSync(work, { recursive: true, force: true });
});

describe("init output without prompts", () => {
  // fails without the fix: the example command repeats the old flag's value and the name as they were typed.
  it.each([
    [{ template: `tpl-${ODD}` }, "npx hyperframes init <name> --example <example>"],
    [{ "video-legacy": `clip-${ODD}` }, "npx hyperframes init <name> --video <file>"],
  ])("leaves values that cannot be typed back out of the example for %o", async (args, line) => {
    await expect(run({ name: join(work, `n-${ODD}`), ...args })).rejects.toThrow();
    expect(printed()).toContain(line);
    expectNoControlCharacters();
  });

  // fails without the fix: the refused value and the name are repeated as they were typed.
  it.each([
    [{ resolution: `res-${ODD}` }, `Invalid --resolution: "res-${SHOWN}".`],
    [{ video: `clip-${ODD}.mp4` }, `Video file not found: clip-${SHOWN}.mp4`],
    [{ audio: `song-${ODD}.mp3` }, `Audio file not found: song-${SHOWN}.mp3`],
  ])("shows control characters in a refused %o as text", async (args, line) => {
    await expect(run({ name: join(work, `n-${ODD}`), ...args })).rejects.toThrow();
    expect(printed()).toContain(line.replace("init n-", `init ${join(work, "n-")}`));
    expectNoControlCharacters();
  });

  // fails without the fix: the example name and the reason are printed as they arrived.
  it("shows control characters in a failed example download as text", async () => {
    await expect(run({ name: join(work, "film"), example: `ex-${ODD}` })).rejects.toThrow();
    expect(printed()).toContain(
      `Failed to scaffold example "ex-${SHOWN}": gone ${SHOWN}\nsecond line`,
    );
    expectNoControlCharacters();
  });

  // fails without the fix: a spinner drew the video's status in a run that asks nothing.
  it("prints a video's status as lines, without a spinner", async () => {
    const video = join(work, "clip.mov");
    copyFileSync(new URL("./__fixtures__/mpeg4.mp4", import.meta.url), video);
    await run({ name: join(work, "f"), video, "skip-transcribe": true });
    expect(printed()).toContain("Transcoded to clip.mp4\n");
    expect(printed()).not.toContain("(spinner)");
  });

  // Windows refuses control characters in file and folder names.
  describe.skipIf(process.platform === "win32")("with odd names on disk", () => {
    // fails without the fix: the folder name is repeated as it was typed.
    it("shows control characters in a folder that is not empty as text", async () => {
      const name = join(work, `full-${ODD}`);
      mkdirSync(name);
      writeFileSync(join(name, "notes.txt"), "");
      await expect(run({ name })).rejects.toThrow();
      expect(printed()).toContain(
        `Directory already exists and is not empty: ${work}/full-${SHOWN}`,
      );
      expectNoControlCharacters();
    });

    // fails without the fix: the audio name, the new folder, its files and the next step are printed as they are on disk.
    it("shows control characters in the lines of a finished project as text", async () => {
      const name = join(work, `film-${ODD}`);
      await run({
        name,
        audio: oddFile(`song-${ODD}.mp3`),
        "skip-transcribe": true,
        "skip-skills": false,
      });
      expect(printed()).toContain(`Audio: song-${SHOWN}.mp3`);
      expect(printed()).toContain(`Created ${work}/film-${SHOWN}/`);
      expect(printed()).toContain(`\n  song-${SHOWN}.mp3`);
      expect(printed()).toContain(`AI coding skills install skipped: no skills ${SHOWN}`);
      expect(printed()).toContain(`film-${SHOWN}`);
      expect(printed()).toContain("npm run dev");
      expectNoControlCharacters();
    });
  });
});

describe("init output with prompts", () => {
  beforeEach(() => {
    fake.attended = true;
  });

  // fails without the fix: the path is repeated as it was typed.
  it.each([
    [{ video: `clip-${ODD}.mp4` }, `File not found: clip-${SHOWN}.mp4`],
    [{ audio: `song-${ODD}.mp3` }, `File not found: song-${SHOWN}.mp3`],
  ])("shows control characters in a missing %o as text", async (args, line) => {
    await expect(run({ name: join(work, "film"), ...args })).rejects.toThrow();
    expect(printed()).toContain(line);
    expectNoControlCharacters();
  });

  // fails without the fix: the example name and the reason are printed as they arrived.
  it("shows control characters in a failed example download as text", async () => {
    await expect(run({ name: join(work, "film"), example: `ex-${ODD}` })).rejects.toThrow();
    expect(printed()).toContain(`Downloading example ex-${SHOWN}...`);
    expect(printed()).toContain(`gone ${SHOWN}\nsecond line`);
    expectNoControlCharacters();
  });

  // fails without the fix: each example's title and description are shown as they arrived.
  it("shows control characters in the example list as text", async () => {
    fake.templates = [{ id: "far", label: `Far ${ODD}`, hint: `about ${ODD}`, source: "remote" }];
    await run({ name: join(work, "film") });
    expect(printed()).toContain(`Far ${SHOWN} about ${SHOWN} (download)`);
    expectNoControlCharacters();
  });

  describe.skipIf(process.platform === "win32")("with odd names on disk", () => {
    // fails without the fix: the folder name is put into the question as it was typed.
    it("shows control characters in the overwrite question as text", async () => {
      const name = join(work, `full-${ODD}`);
      mkdirSync(name);
      writeFileSync(join(name, "notes.txt"), "");
      await expect(run({ name })).rejects.toThrow();
      expect(printed()).toContain(`Directory ${work}/full-${SHOWN} already exists`);
      expectNoControlCharacters();
    });

    // fails without the fix: the audio name, the new folder and its files are shown as they are on disk.
    it("shows control characters in the lines of a finished project as text", async () => {
      await run({ name: join(work, `film-${ODD}`), audio: oddFile(`song-${ODD}.mp3`) });
      expect(printed()).toContain(`Audio copied to song-${SHOWN}.mp3`);
      expect(printed()).toContain(`Created ${work}/film-${SHOWN}/`);
      expect(printed()).toContain(`song-${SHOWN}.mp3\n`);
      expectNoControlCharacters();
    });
  });
});
