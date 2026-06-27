/**
 * @vitest-environment jsdom
 *
 * T1 — parse→serialize round-trip (DOM/timing model only).
 * Scope: GSAP script fidelity is T6 territory; these tests cover element structure and timing.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHtml } from "./htmlParser.js";
import { maxEndTime, serialize } from "./test-utils.js";
import { generateHyperframesHtml } from "@hyperframes/core/generators";

describe("T1 — parse→serialize round-trip (DOM/timing)", () => {
  it("preserves element count and ids through one round-trip", () => {
    const html = `
      <html><body><div id="stage">
        <div id="el-aaa" data-start="0" data-end="5" data-name="Title"><div>Hello</div></div>
        <div id="el-bbb" data-start="3" data-end="8" data-name="Body"><div>World</div></div>
      </div></body></html>
    `;
    const parsed = parseHtml(html);
    const reparsed = parseHtml(serialize(parsed));

    expect(reparsed.elements).toHaveLength(parsed.elements.length);
    expect(reparsed.elements.map((e) => e.id)).toEqual(parsed.elements.map((e) => e.id));
  });

  it("preserves startTime and duration through one round-trip", () => {
    const html = `
      <html><body><div id="stage">
        <video id="el-vid" data-start="1" data-end="6" src="video.mp4" data-name="Clip"></video>
        <div id="el-txt" data-start="0" data-end="3" data-name="Label"><div>Foo</div></div>
      </div></body></html>
    `;
    const parsed = parseHtml(html);
    const reparsed = parseHtml(serialize(parsed));

    for (const orig of parsed.elements) {
      const round = reparsed.elements.find((e) => e.id === orig.id);
      expect(round).toBeDefined();
      expect(round?.startTime).toBe(orig.startTime);
      expect(round?.duration).toBe(orig.duration);
    }
  });

  it("preserves element types through one round-trip", () => {
    const html = `
      <html><body><div id="stage">
        <div id="el-text" data-start="0" data-end="4" data-name="T"><div>Hi</div></div>
        <video id="el-video" data-start="0" data-end="4" src="v.mp4" data-name="V"></video>
        <img id="el-img" data-start="0" data-end="4" src="i.jpg" data-name="I" />
        <audio id="el-aud" data-start="0" data-end="4" src="a.mp3" data-name="A"></audio>
      </div></body></html>
    `;
    const parsed = parseHtml(html);
    const reparsed = parseHtml(serialize(parsed));

    for (const orig of parsed.elements) {
      const round = reparsed.elements.find((e) => e.id === orig.id);
      expect(round).toBeDefined();
      expect(round?.type).toBe(orig.type);
    }
  });

  it("is stable — serialize(parse(serialize(parse(html)))) equals serialize(parse(html))", () => {
    const html = `
      <html><body><div id="stage">
        <img id="el-img" data-start="2" data-end="9" src="photo.jpg" data-name="Photo" />
        <audio id="el-aud" data-start="0" data-end="12" src="music.mp3" data-name="Music"></audio>
      </div></body></html>
    `;
    const parsed = parseHtml(html);
    const once = serialize(parsed);
    const twice = serialize(parseHtml(once));
    expect(twice).toBe(once);
  });

  it("handles an empty stage without throwing", () => {
    const html = `<html><body><div id="stage"></div></body></html>`;
    const parsed = parseHtml(html);
    expect(() => serialize(parsed)).not.toThrow();
    const reparsed = parseHtml(serialize(parsed));
    expect(reparsed.elements).toHaveLength(0);
  });
});

describe("T1 — registry block round-trips (DOM/timing)", () => {
  const BLOCKS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../../registry/blocks");

  const blockNames = existsSync(BLOCKS_DIR)
    ? readdirSync(BLOCKS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    : [];

  for (const name of blockNames) {
    it(`${name}: round-trip preserves element count`, () => {
      const blockFile = join(BLOCKS_DIR, name, `${name}.html`);
      expect(existsSync(blockFile)).toBe(true);
      const html = readFileSync(blockFile, "utf8");
      const parsed = parseHtml(html);
      const reparsed = parseHtml(serialize(parsed));
      expect(reparsed.elements).toHaveLength(parsed.elements.length);
    });
  }

  // GSAP smoke: verify the includeScripts path survives parse→generate on a block known
  // to contain <script> tags. Verbatim script fidelity is T6 territory; this catches R1
  // accidentally breaking the script-generation path entirely.
  it("generates scripts when includeScripts is true (GSAP smoke)", () => {
    const name = "liquid-glass-notification";
    const blockFile = join(BLOCKS_DIR, name, `${name}.html`);
    if (!existsSync(blockFile)) return;
    const html = readFileSync(blockFile, "utf8");
    expect(html).toMatch(/<script/);
    const parsed = parseHtml(html);
    const out = generateHyperframesHtml(parsed.elements, maxEndTime(parsed.elements), {
      compositionId: "test-comp",
      resolution: parsed.resolution,
      styles: parsed.styles ?? undefined,
      keyframes: parsed.keyframes,
      stageZoomKeyframes: parsed.stageZoomKeyframes,
      includeScripts: true,
    });
    expect(out).toMatch(/<script/);
  });
});
