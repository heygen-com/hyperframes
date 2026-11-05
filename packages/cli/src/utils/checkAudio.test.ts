import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { AudioElement } from "@hyperframes/engine";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { inspectAudio, type AudioCheckDependencies } from "./checkAudio.js";
import type { ProjectMedia } from "./projectMedia.js";

const RATE = 48_000;
const dir = mkdtempSync(join(tmpdir(), "hf-check-audio-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A mono 16-bit WAV of `seconds`, each sample from `fill`. */
function wav(name: string, seconds: number, fill: (t: number) => number): string {
  const frames = Math.round(seconds * RATE);
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) data.writeInt16LE(Math.round(fill(i / RATE) * 32767), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(join(dir, name), Buffer.concat([header, data]));
  return name;
}

const tone = (t: number) => 0.5 * Math.sin(2 * Math.PI * 440 * t);
const silent = () => 0;
/** Sound only after `at` seconds. */
const lateTone = (at: number) => (t: number) => (t < at ? 0 : tone(t));

function clip(src: string, overrides: Partial<AudioElement> = {}): AudioElement {
  return {
    id: src.replace(/\W/g, "-"),
    src,
    start: 0,
    end: 2,
    mediaStart: 0,
    layer: 0,
    volume: 1,
    type: "audio",
    ...overrides,
  };
}

function media(
  audios: AudioElement[],
  videos: ProjectMedia["videos"] = [],
  html = "<html></html>",
): ProjectMedia {
  return { audios, videos, images: [], html };
}

const codes = async (project: ProjectMedia) =>
  (await inspectAudio(dir, "index.html", project)).map((f) => `${f.code}:${f.selector}`);

const ffmpeg = findFfBinary("ffmpeg") && findFfBinary("ffprobe");

describe.skipIf(!ffmpeg)("inspectAudio", () => {
  wav("tone.wav", 3, tone);
  wav("silent.wav", 3, silent);
  wav("late.wav", 4, lateTone(2.5));
  // Long enough to be sampled at spots first; sound only between the spots.
  wav("long-silent.wav", 20, silent);
  wav("long-gap.wav", 20, (t) => (t > 5 && t < 6 ? tone(t) : 0));
  // Not audio at all: the render's audio probe rejects it and the whole mix fails.
  writeFileSync(join(dir, "notes.wav"), "RIFF but not really a wave file");
  // A 1x1 PNG: it probes, but as a still image, so render refuses it as an <audio> source.
  writeFileSync(
    join(dir, "cover.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    ),
  );

  it("passes a clip that plays sound", async () => {
    expect(await codes(media([clip("tone.wav")]))).toEqual([]);
  });

  it("reports a film with no audio clips as having no sound", async () => {
    const findings = await inspectAudio(dir, "index.html", media([]));
    expect(findings).toMatchObject([{ code: "audio_none", severity: "info" }]);
  });

  it("counts an unmuted video with an audio track as sound, like render does", async () => {
    const probed: string[] = [];
    const findings = await inspectAudio(
      dir,
      "index.html",
      media(
        [],
        [
          { src: "muted.mp4", hasAudio: false },
          { src: "talk.mp4", hasAudio: true },
        ],
      ),
      {
        renderAccepts: () => Promise.reject(new Error("no audio clips to probe")),
        probeAudio: () => Promise.reject(new Error("no audio clips to probe")),
        isSilent: () => Promise.reject(new Error("no audio clips to decode")),
        videoHasAudio: async (path) => {
          probed.push(path);
          return true;
        },
      },
    );
    expect(findings).toEqual([]);
    expect(probed).toEqual([join(dir, "talk.mp4")]);
  });

  it("errors on a source the render cannot read as audio", async () => {
    const [finding] = await inspectAudio(dir, "index.html", media([clip("notes.wav")]));
    expect(finding).toMatchObject({
      code: "audio_source_unreadable",
      severity: "error",
      selector: "#notes-wav",
      time: 0,
      timeRange: [0, 2],
    });
  });

  it("errors when render's media-type check refuses the source, naming the video for its track", async () => {
    expect(
      await codes(
        media([clip("cover.png"), clip("cover.png", { id: "camera-audio", type: "video" })]),
      ),
    ).toEqual(["audio_source_rejected:#cover-png", "audio_source_rejected:#camera"]);
  });

  it("warns when a clip starts past the end of its file", async () => {
    expect(await codes(media([clip("tone.wav", { mediaStart: 3.5 })]))).toEqual([
      "audio_starts_past_source_end:#tone-wav",
    ]);
  });

  it("warns on a clip whose played part is silent, and only that clip", async () => {
    expect(
      await codes(media([clip("tone.wav"), clip("silent.wav", { id: "narration-2" })])),
    ).toEqual(["audio_clip_silent:#narration-2"]);
  });

  it("names the composition file a mounted clip was written in", async () => {
    const bundled = `<div data-composition-id="main">
      <div data-composition-file="compositions/scene-2.html"><audio id="vo-2"></audio></div>
    </div>`;
    const [finding] = await inspectAudio(
      dir,
      "index.html",
      media([clip("silent.wav", { id: "vo-2" })], [], bundled),
    );
    expect(finding).toMatchObject({ selector: "#vo-2", sourceFile: "compositions/scene-2.html" });
  });

  it("only calls a long clip silent after reading all of it", async () => {
    expect(await codes(media([clip("long-silent.wav", { end: 20 })]))).toEqual([
      "audio_clip_silent:#long-silent-wav",
    ]);
    expect(await codes(media([clip("long-gap.wav", { end: 20 })]))).toEqual([]);
  });

  it("judges only the part of the file the clip plays", async () => {
    expect(await codes(media([clip("late.wav", { end: 2 })]))).toEqual([
      "audio_clip_silent:#late-wav",
    ]);
    expect(await codes(media([clip("late.wav", { mediaStart: 2, end: 2 })]))).toEqual([]);
    // Played at double speed, 2 s of film reach 4 s into the file, past the silent start.
    expect(await codes(media([clip("late.wav", { end: 2, playbackRate: 2 })]))).toEqual([]);
  });
});

describe("inspectAudio on a project of many clips trimmed from few files", () => {
  it("probes each file once, however many clips are cut from it", async () => {
    const probes = { accepts: 0, audio: 0, silence: 0 };
    const dependencies: AudioCheckDependencies = {
      renderAccepts: async () => (probes.accepts++, true),
      probeAudio: async () => (
        probes.audio++,
        { durationSeconds: 60, audioStream: 0, sampleRate: RATE, channels: 1 } as never
      ),
      videoHasAudio: async () => true,
      isSilent: async () => (probes.silence++, false),
    };
    writeFileSync(join(dir, "one.wav"), "x");
    writeFileSync(join(dir, "two.wav"), "x");
    const clips = Array.from({ length: 300 }, (_, i) =>
      clip(i % 2 ? "one.wav" : "two.wav", { id: `c${i}`, mediaStart: i % 50, end: 1.5 }),
    );
    await inspectAudio(dir, "index.html", media(clips), dependencies);
    expect(probes).toEqual({ accepts: 2, audio: 2, silence: 300 });
  });
});
