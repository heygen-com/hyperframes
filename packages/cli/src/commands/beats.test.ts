import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "citty";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const analyzer = vi.hoisted(() => vi.fn());
vi.mock("../beats/headlessAnalyzer.js", () => ({ analyzeBeatsHeadless: analyzer }));

import beatsCommand from "./beats.js";

describe("beats source discovery", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-beats-source-"));
    analyzer.mockReset().mockResolvedValue({
      beatTimes: [0.5, 1],
      beatStrengths: [0.8, 0.6],
      bpm: 120,
      bpmConfidence: "high",
    });
    writeFileSync(join(dir, "bed.wav"), "BEAT_AUDIO");
    writeFileSync(join(dir, "clip.mp4"), "VIDEO_AUDIO");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function analyze(html: string) {
    writeFileSync(join(dir, "index.html"), `<html><body>${html}</body></html>`);
    await runCommand(beatsCommand, { rawArgs: [dir, "--json"] });
  }

  it.each([
    ['<audio id="music"><source src="bed.wav" type="audio/wav"></audio>', "bed.wav", "BEAT_AUDIO"],
    [
      '<video id="soundtrack" data-has-audio="true"><source src="clip.mp4"></video>',
      "clip.mp4",
      "VIDEO_AUDIO",
    ],
  ])("analyzes and persists the music supplied by %s", async (html, src, audio) => {
    await analyze(html);

    expect(analyzer).toHaveBeenCalledWith(Buffer.from(audio));
    expect(JSON.parse(readFileSync(join(dir, "beats", `${src}.json`), "utf-8"))).toEqual({
      version: 1,
      audio: src,
      beats: [
        { time: 0.5, strength: 0.8 },
        { time: 1, strength: 0.6 },
      ],
    });
    expect(readFileSync(join(dir, "index.html"), "utf-8")).toContain(html);
  });

  it("keeps a child-source music track ahead of a later parent-source track", async () => {
    await analyze(
      '<audio id="music"><source src="bed.wav"></audio><audio id="bgm" src="clip.mp4"></audio>',
    );
    expect(analyzer).toHaveBeenCalledWith(Buffer.from("BEAT_AUDIO"));
  });

  it("prefers the parent src over child alternatives", async () => {
    await analyze('<audio id="music" src="bed.wav"><source src="clip.mp4"></audio>');
    expect(analyzer).toHaveBeenCalledWith(Buffer.from("BEAT_AUDIO"));
  });

  it("prefers a local child source over a remote alternative, like the renderer", async () => {
    await analyze(
      '<audio id="music"><source src="https://cdn.example.com/clip.mp4"><source src="bed.wav"></audio>',
    );
    expect(analyzer).toHaveBeenCalledWith(Buffer.from("BEAT_AUDIO"));
  });

  it("does not take sources from muted videos or explicit non-music tracks", async () => {
    await analyze(
      '<video id="music" data-has-audio="true" muted><source src="clip.mp4"></video>' +
        '<audio id="bgm" data-timeline-role="voiceover"><source src="clip.mp4"></audio>' +
        '<audio id="soundtrack"><source src="bed.wav"></audio>',
    );
    expect(analyzer).toHaveBeenCalledWith(Buffer.from("BEAT_AUDIO"));
  });

  it("does not borrow a source outside a source-less music element", async () => {
    await analyze('<audio id="music"></audio><audio id="bgm" src="bed.wav"></audio>');
    expect(analyzer).toHaveBeenCalledWith(Buffer.from("BEAT_AUDIO"));
  });

  it("reads uppercase source attributes", async () => {
    await analyze("<AUDIO ID=music><SOURCE SRC=bed.wav TYPE=audio/wav></AUDIO>");
    expect(analyzer).toHaveBeenCalledWith(Buffer.from("BEAT_AUDIO"));
  });

  it("keeps an uppercase parent src ahead of child alternatives", async () => {
    await analyze('<AUDIO ID=music SRC=bed.wav><source src="clip.mp4"></AUDIO>');
    expect(analyzer).toHaveBeenCalledWith(Buffer.from("BEAT_AUDIO"));
  });

  it("finds music inside an authored composition template", async () => {
    await analyze(
      '<template data-composition-id="main"><audio id="music"><source src="bed.wav"></audio></template>',
    );
    expect(analyzer).toHaveBeenCalledWith(Buffer.from("BEAT_AUDIO"));
  });

  it("decodes child source attributes and escaped URL paths", async () => {
    writeFileSync(join(dir, "bed & pulse.wav"), "ESCAPED_AUDIO");
    await analyze(
      '<audio id="music"><source src="bed%20&amp;%20pulse.wav?version=1#track"></audio>',
    );
    expect(analyzer).toHaveBeenCalledWith(Buffer.from("ESCAPED_AUDIO"));
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
    expect(analyzer).toHaveBeenCalledWith(Buffer.from("BEAT_AUDIO"));
  });

  it("keeps the first duplicate id and src attributes", async () => {
    await analyze(
      '<audio id="speech" id="music"><source src="clip.mp4"></audio>' +
        '<audio id="bgm"><source src="bed.wav" src="clip.mp4"></audio>',
    );
    expect(analyzer).toHaveBeenCalledWith(Buffer.from("BEAT_AUDIO"));
  });

  it("does not read media-like text inside quoted attributes", async () => {
    await analyze(
      '<audio title="<source src=\'clip.mp4\'>" data-id="music" src="clip.mp4"></audio>' +
        '<audio data-timeline-role="mus&#105;c"><source src="bed.wav"></audio>',
    );
    expect(analyzer).toHaveBeenCalledWith(Buffer.from("BEAT_AUDIO"));
  });
});
