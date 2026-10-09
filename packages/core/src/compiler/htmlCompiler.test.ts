import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileHtml } from "./htmlCompiler.js";

describe("compileHtml", () => {
  it("decodes HTML source attributes before interpreting their URL suffixes", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-entity-media-"));
    writeFileSync(join(project, "it's&a.wav"), "duration witness");
    try {
      const compiled = await compileHtml(
        `<audio id="clip" title="src='wrong.wav' >" src="it&#39;s&amp;a.wav">`,
        project,
        async (path) => {
          expect(path).toBe(join(project, "it's&a.wav"));
          expect(readFileSync(path, "utf8")).toBe("duration witness");
          return 2;
        },
      );
      expect(compiled).toContain('data-duration="2"');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("passes a decoded local media URL to the duration prober", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-encoded-media-"));
    writeFileSync(join(project, "clip%20#.mp4"), "duration witness");
    try {
      const compiled = await compileHtml(
        '<video id="clip" src="clip%2520%23.mp4?cache=1" data-start="0">',
        project,
        async (path) => {
          expect(path).toBe(join(project, "clip%20#.mp4"));
          expect(readFileSync(path, "utf8")).toBe("duration witness");
          return 2;
        },
      );
      expect(compiled).toContain('data-duration="2"');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("preserves explicit looped media durations that exceed source duration", async () => {
    const html =
      '<video id="hero" src="hero.webm" data-start="0" data-duration="4" data-end="4" loop>';

    const compiled = await compileHtml(html, "/project", async () => 3.125);

    expect(compiled).toContain('data-duration="4"');
    expect(compiled).toContain('data-end="4"');
  });

  it("preserves an explicit non-looping video slot past source end", async () => {
    const html = '<video id="hero" src="hero.webm" data-start="0" data-duration="4" data-end="4">';

    const compiled = await compileHtml(html, "/project", async () => 3.125);

    expect(compiled).toContain('data-duration="4"');
    expect(compiled).toContain('data-end="4"');
  });

  it("uses natural duration for a video without an explicit slot inside a composition", async () => {
    const html =
      '<div data-composition-id="root" data-start="0" data-duration="5">' +
      '<video id="hero" src="hero.webm" data-start="0">' +
      "</div>";

    const compiled = await compileHtml(html, "/project", async () => 1);

    expect(compiled).toContain('data-duration="1"');
    expect(compiled).toContain('data-end="1"');
  });

  it("uses natural duration for a standalone video without a composition window", async () => {
    const html = '<video id="hero" src="hero.webm" data-start="0">';
    const compiled = await compileHtml(html, "/project", async () => 1);
    expect(compiled).toContain('data-duration="1"');
    expect(compiled).toContain('data-end="1"');
  });

  it("still clamps non-looping audio durations to source duration", async () => {
    const html = '<audio id="voice" src="voice.wav" data-start="0" data-duration="4" data-end="4">';

    const compiled = await compileHtml(html, "/project", async () => 3.125);

    expect(compiled).toContain('data-duration="3.125"');
    expect(compiled).toContain('data-end="3.125"');
  });

  it("preserves explicit media durations when probe precision differs slightly", async () => {
    const html =
      '<audio id="click" src="click.mp3" data-start="0" data-duration="1.044898" data-end="1.044898">';

    const compiled = await compileHtml(html, "/project", async () => 1);

    expect(compiled).toContain('data-duration="1.044898"');
    expect(compiled).toContain('data-end="1.044898"');
  });
});
