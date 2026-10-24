import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "citty";
import beatsCommand from "./beats.js";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { encodeWav } from "../audio/analysis/providers/shared.js";

const RATE = 22_050;
const root = mkdtempSync(join(tmpdir(), "hf-beats-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A project whose music track is `seconds` of noise clicks at `bpm`, or silence when `bpm` is null. */
function project(name: string, bpm: number | null, seconds = 12): string {
  const dir = join(root, name);
  const samples = new Float32Array(seconds * RATE);
  let seed = 7;
  const noise = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2 ** 30 - 1;
  for (let t = 0.2; bpm && t < seconds - 0.1; t += 60 / bpm) {
    const start = Math.round(t * RATE);
    for (let i = 0; i < 0.05 * RATE; i++)
      samples[start + i]! += 0.6 * noise() * Math.exp(-i / RATE / 0.015);
  }
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(
    join(dir, "assets", "song.wav"),
    encodeWav({ sampleRate: RATE, channels: [samples] }),
  );
  writeFileSync(
    join(dir, "index.html"),
    `<div data-composition-id="main"><audio id="music" src="assets/song.wav"></audio></div>`,
  );
  return dir;
}

async function runBeats(dir: string): Promise<{ exitCode: number; out: string }> {
  const command = (await import("./beats.js")).default as unknown as {
    run: (context: { args: Record<string, unknown> }) => Promise<void>;
  };
  const lines: string[] = [];
  const capture = (...parts: unknown[]) => void lines.push(parts.map(String).join(" "));
  const log = vi.spyOn(console, "log").mockImplementation(capture);
  const error = vi.spyOn(console, "error").mockImplementation(capture);
  let exitCode = 0;
  try {
    await command.run({ args: { dir, json: true } });
  } catch (thrown) {
    exitCode = (thrown as { result?: { exitCode?: number } }).result?.exitCode ?? -1;
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
  return { exitCode, out: lines.join("\n") };
}

const dirLink = process.platform === "win32" ? "junction" : "dir";
const ffmpeg = findFfBinary("ffmpeg");
const canDecode = ffmpeg && findFfBinary("ffprobe");

describe.skipIf(!canDecode)("hyperframes beats", () => {
  it("writes beats/<audio>.json in the beat-file format the Studio reads", async () => {
    const dir = project("steady", 120);
    const { exitCode, out } = await runBeats(dir);
    expect(exitCode).toBe(0);
    const file = JSON.parse(readFileSync(join(dir, "beats", "assets", "song.wav.json"), "utf8"));
    expect(Object.keys(file)).toEqual(["version", "audio", "beats"]);
    expect(file).toMatchObject({ version: 1, audio: "assets/song.wav" });
    for (const beat of file.beats) {
      expect(Object.keys(beat)).toEqual(["time", "strength"]);
      expect(beat.strength).toBeGreaterThanOrEqual(0);
      expect(beat.strength).toBeLessThanOrEqual(1);
    }
    const times: number[] = file.beats.map((b: { time: number }) => b.time);
    expect(times.length).toBeGreaterThan(18);
    expect(times.every((t) => Math.abs(((t - 0.2 + 0.25) % 0.5) - 0.25) <= 0.07)).toBe(true);
    const report = JSON.parse(out) as { ok: boolean; count: number; bpm: number };
    expect(report).toMatchObject({ ok: true, file: "beats/assets/song.wav.json" });
    expect(report.count).toBe(times.length);
    expect(Math.abs(report.bpm - 120)).toBeLessThanOrEqual(1);
  });

  it("writes nothing for a track with no steady beat", async () => {
    const dir = project("silent", null);
    const { exitCode, out } = await runBeats(dir);
    expect(exitCode).toBe(1);
    expect(out).toMatch(/No beats detected in assets\/song\.wav/);
    expect(existsSync(join(dir, "beats"))).toBe(false);
  });

  it("refuses a music src that resolves outside the project", async () => {
    // An encoded `../` survives URL normalization and decodes to a parent path, so
    // without a containment check the command reads ../../secret.wav and writes
    // beats/../../secret.wav.json, both outside the project.
    const dir = project(join("escape", "nested", "proj"), 120);
    const base = join(root, "escape");
    writeFileSync(join(base, "secret.wav"), readFileSync(join(dir, "assets", "song.wav")));
    writeFileSync(
      join(dir, "index.html"),
      `<div data-composition-id="main"><audio id="music" src="..%2F..%2Fsecret.wav"></audio></div>`,
    );
    const { exitCode, out } = await runBeats(dir);
    expect(exitCode).toBe(1);
    expect(out).toMatch(/outside the project/);
    expect(existsSync(join(base, "nested", "secret.wav.json"))).toBe(false);
    expect(existsSync(join(dir, "beats"))).toBe(false);
  });

  it("refuses music read through a symlinked folder that points outside the project", async () => {
    const dir = project(join("link-read", "proj"), 120);
    const outside = join(root, "link-read", "outside");
    renameSync(join(dir, "assets"), outside);
    symlinkSync(outside, join(dir, "assets"), dirLink);
    const { exitCode, out } = await runBeats(dir);
    expect(exitCode).toBe(1);
    expect(out).toMatch(/outside the project/);
    expect(existsSync(join(dir, "beats"))).toBe(false);
  });

  it("refuses to write a beat file through a symlinked folder that points outside the project", async () => {
    const dir = project(join("link-write", "proj"), 120);
    const outside = join(root, "link-write", "outside");
    mkdirSync(outside, { recursive: true });
    mkdirSync(join(dir, "beats"));
    symlinkSync(outside, join(dir, "beats", "assets"), dirLink);
    const { exitCode, out } = await runBeats(dir);
    expect(exitCode).toBe(1);
    expect(out).toMatch(/outside the project/);
    expect(existsSync(join(outside, "song.wav.json"))).toBe(false);
  });

  it("accepts an in-project file whose name starts with two dots", async () => {
    const dir = project("dotted", 120);
    renameSync(join(dir, "assets", "song.wav"), join(dir, "..music.wav"));
    writeFileSync(
      join(dir, "index.html"),
      `<div data-composition-id="main"><audio id="music" src="..music.wav"></audio></div>`,
    );
    const { exitCode } = await runBeats(dir);
    expect(exitCode).toBe(0);
    expect(existsSync(join(dir, "beats", "..music.wav.json"))).toBe(true);
  });
});

describe.skipIf(!canDecode)("beats source discovery", () => {
  let dir: string;
  let fixtureNumber = 0;

  beforeEach(() => {
    dir = project(`source-${++fixtureNumber}`, 120);
    const audio = readFileSync(join(dir, "assets", "song.wav"));
    writeFileSync(join(dir, "bed.wav"), audio);
    if (!ffmpeg) throw new Error("FFmpeg is required for the video fixture");
    execFileSync(ffmpeg, [
      "-y",
      "-v",
      "error",
      "-i",
      join(dir, "assets", "song.wav"),
      "-c:a",
      "aac",
      join(dir, "clip.mp4"),
    ]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function expectMusicFile(src: string) {
    const file = JSON.parse(readFileSync(join(dir, "beats", `${src}.json`), "utf8"));
    expect(file).toMatchObject({ version: 1, audio: src });
    expect(file.beats.length).toBeGreaterThan(18);
  }

  async function analyze(html: string) {
    writeFileSync(join(dir, "index.html"), `<html><body>${html}</body></html>`);
    await runCommand(beatsCommand, { rawArgs: [dir, "--json"] });
  }

  it.each([
    ['<audio id="music"><source src="bed.wav" type="audio/wav"></audio>', "bed.wav"],
    ['<video id="soundtrack" data-has-audio="true"><source src="clip.mp4"></video>', "clip.mp4"],
  ])("analyzes and persists the music supplied by %s", async (html, src) => {
    await analyze(html);

    expectMusicFile(src);
    expect(readFileSync(join(dir, "index.html"), "utf-8")).toContain(html);
  });

  it("keeps a child-source music track ahead of a later parent-source track", async () => {
    await analyze(
      '<audio id="music"><source src="bed.wav"></audio><audio id="bgm" src="clip.mp4"></audio>',
    );
    expectMusicFile("bed.wav");
  });

  it("prefers the parent src over child alternatives", async () => {
    await analyze('<audio id="music" src="bed.wav"><source src="clip.mp4"></audio>');
    expectMusicFile("bed.wav");
  });

  it("prefers a local child source over a remote alternative, like the renderer", async () => {
    await analyze(
      '<audio id="music"><source src="https://cdn.example.com/clip.mp4"><source src="bed.wav"></audio>',
    );
    expectMusicFile("bed.wav");
  });

  it("does not take sources from muted videos or explicit non-music tracks", async () => {
    await analyze(
      '<video id="music" data-has-audio="true" muted><source src="clip.mp4"></video>' +
        '<audio id="bgm" data-timeline-role="voiceover"><source src="clip.mp4"></audio>' +
        '<audio id="soundtrack"><source src="bed.wav"></audio>',
    );
    expectMusicFile("bed.wav");
  });

  it("does not borrow a source outside a source-less music element", async () => {
    await analyze('<audio id="music"></audio><audio id="bgm" src="bed.wav"></audio>');
    expectMusicFile("bed.wav");
  });

  it("reads uppercase source attributes", async () => {
    await analyze("<AUDIO ID=music><SOURCE SRC=bed.wav TYPE=audio/wav></AUDIO>");
    expectMusicFile("bed.wav");
  });

  it("keeps an uppercase parent src ahead of child alternatives", async () => {
    await analyze('<AUDIO ID=music SRC=bed.wav><source src="clip.mp4"></AUDIO>');
    expectMusicFile("bed.wav");
  });

  it("finds music inside an authored composition template", async () => {
    await analyze(
      '<template data-composition-id="main"><audio id="music"><source src="bed.wav"></audio></template>',
    );
    expectMusicFile("bed.wav");
  });

  it("decodes child source attributes and escaped URL paths", async () => {
    writeFileSync(join(dir, "bed & pulse.wav"), readFileSync(join(dir, "bed.wav")));
    await analyze(
      '<audio id="music"><source src="bed%20&amp;%20pulse.wav?version=1#track"></audio>',
    );
    expectMusicFile("bed & pulse.wav");
    expect(JSON.parse(readFileSync(join(dir, "beats", "bed & pulse.wav.json"), "utf-8"))).toEqual(
      expect.objectContaining({ audio: "bed & pulse.wav" }),
    );
  });

  it("keeps markup in comments and scripts out of source discovery", async () => {
    await analyze(
      '<!-- <audio id="music"><source src="clip.mp4"></audio> -->' +
        '<script>const sample = \'<audio id="bgm"><source src="clip.mp4"></audio>\';</script>' +
        '<audio id="music"><source src="bed.wav"></audio>',
    );
    expectMusicFile("bed.wav");
  });

  it("keeps the first duplicate id and src attributes", async () => {
    await analyze(
      '<audio id="speech" id="music"><source src="clip.mp4"></audio>' +
        '<audio id="bgm"><source src="bed.wav" src="clip.mp4"></audio>',
    );
    expectMusicFile("bed.wav");
  });

  it("does not read media-like text inside quoted attributes", async () => {
    await analyze(
      '<audio title="<source src=\'clip.mp4\'>" data-id="music" src="clip.mp4"></audio>' +
        '<audio data-timeline-role="mus&#105;c"><source src="bed.wav"></audio>',
    );
    expectMusicFile("bed.wav");
  });
});
