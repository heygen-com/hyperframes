import { describe, expect, it } from "vitest";
import { patchMediaPlaceholders } from "./initMedia.js";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NEW_TEMPLATE = `<div id="root">
      <video
        id="a-roll"
        class="clip"
        src="__VIDEO_SRC__"
        playsinline
        data-has-audio="true"
        data-duration="__VIDEO_DURATION__"
        data-track-index="0"
      ></video>
      <audio
        id="a-roll-audio"
        src="__AUDIO_SRC__"
        data-start="0"
        data-duration="__VIDEO_DURATION__"
        data-track-index="2"
        data-volume="1"
      ></audio>
</div>`;

const LEGACY_TEMPLATE = `<div id="root">
      <video id="a-roll" class="clip" src="__VIDEO_SRC__" muted playsinline data-duration="__VIDEO_DURATION__"></video>
      <audio id="a-roll-audio" src="__VIDEO_SRC__" data-start="0" data-duration="__VIDEO_DURATION__"></audio>
</div>`;

const videoTag = (html: string) => html.match(/<video\b[^>]*>/)?.[0] ?? "";

describe("patchMediaPlaceholders — new template", () => {
  it("video with audio: one audible <video>, no <audio>", () => {
    const out = patchMediaPlaceholders(NEW_TEMPLATE, {
      video: { filename: "talk.mp4", hasAudio: true },
      durationSeconds: 6,
    });
    expect(videoTag(out)).toContain('data-has-audio="true"');
    expect(videoTag(out)).not.toMatch(/\bmuted\b/);
    expect(videoTag(out)).toContain('src="talk.mp4"');
    expect(out).not.toMatch(/<audio\b/);
    expect(out).toContain('data-duration="6"');
    expect(out).not.toContain("__");
  });

  it("silent video: muted <video>, no data-has-audio, no <audio>", () => {
    const out = patchMediaPlaceholders(NEW_TEMPLATE, {
      video: { filename: "silent.mp4", hasAudio: false },
      durationSeconds: 3,
    });
    expect(videoTag(out)).toMatch(/\bmuted\b/);
    expect(videoTag(out)).not.toContain("data-has-audio");
    expect(out).not.toMatch(/<audio\b/);
  });

  it("keeps every other attribute and the closing > of a multi-line tag", () => {
    const out = patchMediaPlaceholders(NEW_TEMPLATE, {
      video: { filename: "silent.mp4", hasAudio: false },
    });
    const tag = videoTag(out);
    for (const attr of ['id="a-roll"', 'class="clip"', "playsinline", 'data-track-index="0"']) {
      expect(tag).toContain(attr);
    }
    expect(out).toMatch(/<video\b[^>]*>\s*<\/video>/);
  });

  it("audio only: one <audio> on the file, no <video>", () => {
    const out = patchMediaPlaceholders(NEW_TEMPLATE, { audio: { filename: "track.wav" } });
    expect(out).toMatch(/<audio\b[^>]*src="track\.wav"/);
    expect(out).not.toMatch(/<video\b/);
    expect(out).not.toContain("__");
  });

  it("no media: strips both placeholders and defaults duration to 10", () => {
    const out = patchMediaPlaceholders(
      NEW_TEMPLATE.replace('<div id="root">', '<div id="root" data-duration="__VIDEO_DURATION__">'),
      {},
    );
    expect(out).not.toMatch(/<video\b|<audio\b/);
    expect(out).not.toContain("__");
    expect(out).toContain('<div id="root" data-duration="10">');
  });

  it('normalises muted="" and a stray data-has-audio on the placeholder', () => {
    const html = `<video src="__VIDEO_SRC__" muted="" data-has-audio="false" data-x="1"></video>`;
    const out = patchMediaPlaceholders(html, { video: { filename: "a.mp4", hasAudio: true } });
    expect(out).toBe(`<video src="a.mp4" data-x="1" data-has-audio="true"></video>`);
  });
});

describe("patchMediaPlaceholders — muted token matching", () => {
  it("does not strip the word muted from another attribute's value", () => {
    const html = `<video src="__VIDEO_SRC__" class="a muted b" muted></video>`;
    const out = patchMediaPlaceholders(html, { video: { filename: "a.mp4", hasAudio: true } });
    expect(out).toBe(`<video src="a.mp4" class="a muted b" data-has-audio="true"></video>`);
  });
});

describe("patchMediaPlaceholders — legacy remote templates", () => {
  it("video with audio: keeps the legacy split untouched", () => {
    const out = patchMediaPlaceholders(LEGACY_TEMPLATE, {
      video: { filename: "talk.mp4", hasAudio: true },
    });
    expect(videoTag(out)).toMatch(/\bmuted\b/);
    expect(out).toMatch(/<audio\b[^>]*src="talk\.mp4"/);
  });

  it("silent video: strips the legacy <audio> (a silent file would fail the render)", () => {
    const out = patchMediaPlaceholders(LEGACY_TEMPLATE, {
      video: { filename: "silent.mp4", hasAudio: false },
    });
    expect(out).not.toMatch(/<audio\b/);
    expect(videoTag(out)).toMatch(/\bmuted\b/);
  });

  it("audio only: fills the legacy audio slot and drops the video", () => {
    const out = patchMediaPlaceholders(LEGACY_TEMPLATE, { audio: { filename: "track.wav" } });
    expect(out).toMatch(/<audio\b[^>]*src="track\.wav"/);
    expect(out).not.toMatch(/<video\b/);
  });
});

describe("registry examples use the audio-on-video form", () => {
  const examplesDir = resolve(fileURLToPath(import.meta.url), "../../../../../registry/examples");
  const withVideoSlot = readdirSync(examplesDir)
    .map((name) => join(examplesDir, name, "index.html"))
    .filter((file) => existsSync(file) && readFileSync(file, "utf-8").includes("__VIDEO_SRC__"));

  it("finds the examples that carry a video slot", () => {
    expect(withVideoSlot.length).toBeGreaterThan(0);
  });

  it.each(withVideoSlot)("%s has no muted placeholder video and no __VIDEO_SRC__ audio", (file) => {
    const html = readFileSync(file, "utf-8");
    const video = html.match(/<video\b[^>]*src="__VIDEO_SRC__"[^>]*>/)?.[0] ?? "";
    expect(video).toContain('data-has-audio="true"');
    expect(video).not.toMatch(/\bmuted\b/);
    expect(html).not.toMatch(/<audio\b[^>]*src="__VIDEO_SRC__"/);
  });
});
