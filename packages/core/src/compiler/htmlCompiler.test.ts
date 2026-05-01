import { describe, expect, it } from "vitest";
import { compileHtml } from "./htmlCompiler.js";

describe("compileHtml", () => {
  it("preserves explicit looped media durations that exceed source duration", async () => {
    const html =
      '<video id="hero" src="hero.webm" data-start="0" data-duration="4" data-end="4" loop>';

    const compiled = await compileHtml(html, "/project", async () => 3.125);

    expect(compiled).toContain('data-duration="4"');
    expect(compiled).toContain('data-end="4"');
  });

  it("still clamps non-looping media durations to source duration", async () => {
    const html = '<video id="hero" src="hero.webm" data-start="0" data-duration="4" data-end="4">';

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
