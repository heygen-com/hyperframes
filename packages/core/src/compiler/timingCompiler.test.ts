import { describe, it, expect } from "vitest";
import {
  compileTimingAttrs,
  injectDurations,
  extractResolvedMedia,
  clampDurations,
} from "./timingCompiler.js";

describe("compileTimingAttrs", () => {
  it("adds data-end when data-start and data-duration are present on a video", () => {
    const html = '<video id="v1" src="a.mp4" data-start="2" data-duration="5">';
    const { html: compiled, unresolved } = compileTimingAttrs(html);

    expect(compiled).toContain('data-end="7"');
    expect(compiled).toContain('data-has-audio="true"');
    expect(unresolved).toHaveLength(0);
  });

  it("leaves data-end unchanged when already present", () => {
    const html = '<video id="v1" src="a.mp4" data-start="0" data-end="3">';
    const { html: compiled, unresolved } = compileTimingAttrs(html);

    expect(compiled).toContain('data-end="3"');
    expect(compiled).not.toContain("data-duration");
    expect(unresolved).toHaveLength(0);
  });

  it("marks video as unresolved when data-duration and data-end are missing", () => {
    const html = '<video id="v1" src="a.mp4" data-start="1">';
    const { unresolved } = compileTimingAttrs(html);

    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].id).toBe("v1");
    expect(unresolved[0].tagName).toBe("video");
    expect(unresolved[0].start).toBe(1);
  });

  it("auto-assigns ids to id-less videos so unresolved duration resolution can target them", () => {
    const html = '<video src="a.mp4" data-start="1">';
    const { html: compiled, unresolved } = compileTimingAttrs(html);

    expect(compiled).toContain('id="hf-video-0"');
    expect(compiled).toContain('data-has-audio="true"');
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].id).toBe("hf-video-0");
    expect(unresolved[0].tagName).toBe("video");
    expect(unresolved[0].start).toBe(1);
  });

  it("compiles audio tags the same as video (minus data-has-audio)", () => {
    const html = '<audio id="a1" src="music.mp3" data-start="0" data-duration="10">';
    const { html: compiled } = compileTimingAttrs(html);

    expect(compiled).toContain('data-end="10"');
    expect(compiled).not.toContain("data-has-audio");
  });

  it("detects unresolved div/section elements with data-start but no data-end", () => {
    const html = '<div id="comp1" data-start="0" data-composition-src="comp.html">';
    const { unresolved } = compileTimingAttrs(html);

    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].id).toBe("comp1");
    expect(unresolved[0].tagName).toBe("div");
    expect(unresolved[0].compositionSrc).toBe("comp.html");
  });

  it("does not report div as unresolved when data-end is present", () => {
    const html = '<div id="comp1" data-start="0" data-end="5">';
    const { unresolved } = compileTimingAttrs(html);

    expect(unresolved).toHaveLength(0);
  });
});

describe("injectDurations", () => {
  it("adds data-duration and data-end for resolved elements", () => {
    const html = '<video id="v1" src="a.mp4" data-start="2">';
    const result = injectDurations(html, [{ id: "v1", duration: 4 }]);

    expect(result).toContain('data-duration="4"');
    expect(result).toContain('data-end="6"');
  });

  it("injects durations for auto-assigned media ids", () => {
    const { html, unresolved } = compileTimingAttrs('<video src="a.mp4" data-start="1">');
    const result = injectDurations(html, [{ id: unresolved[0]!.id, duration: 4 }]);

    expect(result).toContain('id="hf-video-0"');
    expect(result).toContain('data-duration="4"');
    expect(result).toContain('data-end="5"');
  });

  it("does not overwrite existing data-duration", () => {
    const html = '<video id="v1" src="a.mp4" data-start="0" data-duration="3">';
    const result = injectDurations(html, [{ id: "v1", duration: 10 }]);

    // data-duration already present, should not be duplicated
    expect(result).toContain('data-duration="3"');
  });
});

describe("extractResolvedMedia", () => {
  it("extracts video and audio elements with data-duration set", () => {
    const html = [
      '<video id="v1" src="vid.mp4" data-start="1" data-duration="5" data-media-start="0">',
      '<audio id="a1" src="song.mp3" data-start="0" data-duration="10">',
      '<video id="v2" src="other.mp4" data-start="0">', // no duration
    ].join("\n");

    const resolved = extractResolvedMedia(html);

    expect(resolved).toHaveLength(2);
    expect(resolved[0].id).toBe("v1");
    expect(resolved[0].tagName).toBe("video");
    expect(resolved[0].duration).toBe(5);
    expect(resolved[0].start).toBe(1);
    expect(resolved[1].id).toBe("a1");
    expect(resolved[1].tagName).toBe("audio");
    expect(resolved[1].duration).toBe(10);
  });

  it("skips elements with invalid durations", () => {
    const html = '<video id="v1" src="a.mp4" data-start="0" data-duration="NaN">';
    const resolved = extractResolvedMedia(html);
    expect(resolved).toHaveLength(0);
  });
});

describe("clampDurations", () => {
  it("replaces data-duration and recomputes data-end", () => {
    const html = '<video id="v1" src="a.mp4" data-start="2" data-duration="10" data-end="12">';
    const result = clampDurations(html, [{ id: "v1", duration: 5 }]);

    expect(result).toContain('data-duration="5"');
    expect(result).toContain('data-end="7"');
  });
});
