import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";
import { describe, it, expect } from "vitest";
import {
  compileTimingAttrs,
  injectDurations,
  extractResolvedMedia,
  clampDurations,
  shouldClampResolvedMediaDuration,
} from "./timingCompiler.js";

// Raw 0x00 bytes in the HFMASK delimiters shipped once and broke every render
// under Bun's transpiler while behaving fine under Node (issue #2139) — only a
// byte-level check catches that, so keep the delimiters as \x00 escapes.
it("source contains no raw NUL bytes", () => {
  const testPath = expect.getState().testPath ?? "";
  const src = readFileSync(join(dirname(testPath), "timingCompiler.ts"), "latin1");
  expect(src.includes("\x00")).toBe(false);
});

describe("inert region scanning", () => {
  const media = '<video id="v" data-start="1" data-duration="2">';

  it.each([
    `<!-- ${media} <!-- nested -->`,
    `<ScRiPt type="text/javascript">${media}</sCrIpT \n>`,
    `<STYLE>${media}</STYLE\u00a0>`,
    `<script-data>${media}</script>`,
    `<style:${media}</style>`,
    `<!-- <script>${media} -->`,
    `<script><!-- ${media}</script>`,
    `<style><script>${media}</style>`,
  ])("preserves the existing complete-region boundaries in %j", (region) => {
    const result = compileTimingAttrs(region + media);
    expect(result).toEqual({ html: region + compileTimingAttrs(media).html, unresolved: [] });
    expect(extractResolvedMedia(region + media)).toEqual(extractResolvedMedia(media));
  });

  it.each(["<!--", "<script>", "<style>", "<scripture>", "<stylesheet>"])(
    "keeps media outside a complete inert region after %j visible",
    (prefix) => {
      expect(compileTimingAttrs(prefix + media).html).toBe(prefix + compileTimingAttrs(media).html);
      expect(extractResolvedMedia(prefix + media)).toEqual(extractResolvedMedia(media));
    },
  );

  it.each(["-->", "--!>"])("recognizes %j as the first comment end like the browser", (end) => {
    const hidden = '<video id="hidden" data-duration="1">';
    const visible = '<video id="visible" data-start="1" data-duration="2">';
    const comment = `<!-- ${hidden} ${end}`;
    // The trailing delimiter must not extend the comment over visible media.
    const html = comment + visible + " -->";
    const dom = new JSDOM(html);
    expect([...dom.window.document.querySelectorAll("video")].map((el) => el.id)).toEqual([
      "visible",
    ]);
    dom.window.close();
    expect(compileTimingAttrs(html)).toEqual({
      html: comment + compileTimingAttrs(visible).html + " -->",
      unresolved: [],
    });
    expect(extractResolvedMedia(html).map((el) => el.id)).toEqual(["visible"]);
  });

  it("closes an end-bang comment without a later standard delimiter", () => {
    const comment = '<!-- <video id="hidden" data-duration="1"> --!>';
    expect(compileTimingAttrs(comment + media)).toEqual({
      html: comment + compileTimingAttrs(media).html,
      unresolved: [],
    });
    expect(extractResolvedMedia(comment + media)).toEqual(extractResolvedMedia(media));
  });

  it.each(["<!--", "<script", "<style"])(
    "handles many unclosed %j prefixes while masking other region kinds",
    (prefix) => {
      const unclosed = prefix.repeat(100_000);
      const hidden = prefix === "<!--" ? `<style>${media}</style>` : `<!--${media}-->`;
      expect(compileTimingAttrs(unclosed + hidden + media)).toEqual({
        html: unclosed + hidden + compileTimingAttrs(media).html,
        unresolved: [],
      });
      expect(extractResolvedMedia(unclosed + hidden + media)).toEqual(extractResolvedMedia(media));
    },
  );

  it("uses the first closing delimiter and resumes scanning after it", () => {
    const hidden = `<script>${media}</script>`;
    const html = hidden + media + `</script><!--${media}--><style>${media}</style>`;
    expect(compileTimingAttrs(html).html).toBe(
      hidden + compileTimingAttrs(media).html + `</script><!--${media}--><style>${media}</style>`,
    );
    expect(extractResolvedMedia(html)).toEqual(extractResolvedMedia(media));
  });
});

describe("opening tag scanning", () => {
  it.each([injectDurations, clampDurations])(
    "keeps long unclosed ID-targeted tags unchanged in %p",
    (write) => {
      const html = '<video id="target" '.repeat(100_000);
      expect(write(html, [{ id: "target", duration: 3 }])).toBe(html);
    },
  );

  it.each(["target", "a>b", "a<b", "a.b[0]"])(
    "preserves substring-ID matches and delimiter characters for %j",
    (id) => {
      const html = `<video data-id="${id}" data-start="1" data-duration="bad" data-end="4">`;
      expect(injectDurations(html, [{ id, duration: 3 }])).toBe(
        `<video data-id="${id}" data-start="1" data-duration="3" data-end="4">`,
      );
      expect(clampDurations(html, [{ id, duration: 3 }])).toBe(
        `<video data-id="${id}" data-start="1" data-duration="3" data-end="4">`,
      );
    },
  );

  it("leaves similar IDs alone and applies repeated resolutions in order", () => {
    const html = '<video id="a.b" data-start="1" data-duration="bad"><video id="axb">';
    const resolutions = [
      { id: "a.b", duration: 3 },
      { id: "a.b", duration: 5 },
    ];
    expect(injectDurations(html, resolutions)).toBe(
      '<video id="a.b" data-start="1" data-duration="3" data-end="4"><video id="axb">',
    );
    expect(clampDurations(html, resolutions)).toBe(
      '<video id="a.b" data-start="1" data-duration="5"><video id="axb">',
    );
  });

  it.each(["<video", "<audio", "<div", "<section", "<video<audio<div<section"])(
    "preserves an unclosed %j suffix after compiling complete media",
    (prefix) => {
      const media = '<video id="v" data-start="1" data-duration="2">';
      const suffix = prefix.repeat(100_000);
      expect(compileTimingAttrs(media + suffix)).toEqual({
        html: compileTimingAttrs(media).html + suffix,
        unresolved: [],
      });
      expect(extractResolvedMedia(media + suffix).map((el) => el.id)).toEqual(["v"]);
    },
  );

  it("keeps separate media ID counters and video/audio/composition resolution order", () => {
    const html = '<audio><VIDEO><section id="scene" data-start="0"><audio>';
    const result = compileTimingAttrs(html);
    expect(result.unresolved.map((el) => el.id)).toEqual([
      "hf-video-0",
      "hf-audio-0",
      "hf-audio-1",
      "scene",
    ]);
    expect(result.html.indexOf('id="hf-audio-0"')).toBeLessThan(
      result.html.indexOf('id="hf-video-0"'),
    );
  });

  it("extracts mixed-case media in source order", () => {
    const html = '<AUDIO id="a" data-duration="2"><video id="v" data-duration="3">';
    expect(extractResolvedMedia(html).map((el) => [el.id, el.tagName, el.duration])).toEqual([
      ["a", "audio", 2],
      ["v", "video", 3],
    ]);
  });

  it("retains the existing first-greater-than boundary even inside a quoted value", () => {
    const html = '<video title="a>b" data-duration="2">';
    const result = compileTimingAttrs(html);
    expect(result.html).toBe(
      '<video title="a id="hf-video-0" data-start="0" data-hf-auto-start="" data-has-audio="true">b" data-duration="2">',
    );
    expect(result.unresolved.map((el) => el.id)).toEqual(["hf-video-0"]);
    expect(extractResolvedMedia(html)).toEqual([]);
  });
});

describe("compileTimingAttrs", () => {
  it.each(["", "   ", "0s", "0abc", "0px", "-1s", "Infinity", "NaN"])(
    "does not partially parse invalid literal data-duration=%j",
    (duration) => {
      const html = `<video id="v1" src="a.mp4" data-start="2" data-duration="${duration}">`;
      const { html: compiled } = compileTimingAttrs(html);

      expect(compiled).not.toContain("data-end=");
    },
  );

  it("uses Number semantics for hexadecimal literal timing", () => {
    const { html: compiled } = compileTimingAttrs(
      '<video id="v1" src="a.mp4" data-start="2" data-duration="0x10">',
    );
    expect(compiled).toContain('data-end="18"');
  });

  it("adds data-end when data-start and data-duration are present on a video", () => {
    const html = '<video id="v1" src="a.mp4" data-start="2" data-duration="5">';
    const { html: compiled, unresolved } = compileTimingAttrs(html);

    expect(compiled).toContain('data-end="7"');
    expect(compiled).toContain('data-has-audio="true"');
    expect(unresolved).toHaveLength(0);
  });

  it("injects a real id when the element has only data-hf-id (not a phantom match)", () => {
    // Regression: getAttr(tag, "id") matched the trailing id="…" inside
    // data-hf-id="…" and returned a phantom, so compileTag skipped its
    // hf-video-N injection — leaving no real el.id and a blank-wash render.
    const html = '<video data-hf-id="hf-bgvideo01" src="a.mp4" data-start="0" data-duration="2">';
    const { html: compiled } = compileTimingAttrs(html);

    expect(compiled).toContain('id="hf-video-0"');
    expect(compiled).toContain('data-hf-id="hf-bgvideo01"');
    expect(compiled).toContain('data-end="2"');
  });

  it("injects a real id on an audio element that has only data-hf-id", () => {
    // Audio side of the same bug: the mixer selects `audio[id][src]`, so a
    // phantom-id match meant the element was dropped (silent). compileTag must
    // inject a real hf-audio-N so the mixer can find it.
    const html = '<audio data-hf-id="hf-bgaudio01" src="a.mp3" data-start="0" data-duration="2">';
    const { html: compiled } = compileTimingAttrs(html);

    expect(compiled).toContain('id="hf-audio-0"');
    expect(compiled).toContain('data-hf-id="hf-bgaudio01"');
  });

  it("leaves data-end unchanged when already present", () => {
    const html = '<video id="v1" src="a.mp4" data-start="0" data-end="3">';
    const { html: compiled, unresolved } = compileTimingAttrs(html);

    expect(compiled).toContain('data-end="3"');
    expect(compiled).not.toContain("data-duration");
    expect(unresolved).toHaveLength(0);
  });

  it("marks muted videos as visual-only audio sources", () => {
    const html = '<video id="v1" src="a.mp4" data-start="0" data-duration="3" muted playsinline>';
    const { html: compiled } = compileTimingAttrs(html);

    expect(compiled).toContain('data-has-audio="false"');
    expect(compiled).not.toContain('data-has-audio="true"');
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

  it("auto-injects data-start='0' when missing so video is discoverable", () => {
    const html = '<video src="clip.mp4" muted>';
    const { html: compiled, unresolved } = compileTimingAttrs(html);

    expect(compiled).toContain('data-start="0"');
    expect(compiled).toContain('id="hf-video-0"');
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].start).toBe(0);
  });

  it("marks auto-injected data-start with data-hf-auto-start sentinel", () => {
    const html = '<video src="clip.mp4" muted>';
    const { html: compiled } = compileTimingAttrs(html);

    expect(compiled).toContain('data-start="0"');
    expect(compiled).toContain("data-hf-auto-start");
  });

  it("does not add data-hf-auto-start when author provides data-start", () => {
    const html = '<video id="v1" src="clip.mp4" data-start="5" muted>';
    const { html: compiled } = compileTimingAttrs(html);

    expect(compiled).toContain('data-start="5"');
    expect(compiled).not.toContain("data-hf-auto-start");
  });

  it("leaves data-end off a relative data-start id-ref", () => {
    const html =
      '<video id="intro" src="a.mp4" data-start="0" data-duration="10">' +
      '<video id="main" src="b.mp4" data-start="intro" data-duration="20">';
    const { html: compiled } = compileTimingAttrs(html);

    expect(compiled).toContain('data-start="intro"');
    expect(compiled).not.toMatch(/id="main"[^>]*data-end=/);
    expect(compiled).toMatch(/id="intro"[^>]*data-end="10"/);
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

  it("ignores media tags mentioned inside comments (issue #1938)", () => {
    const html =
      "<!-- this comment mentions a <video> and an <audio> tag -->\n<p>no media here</p>";
    const { html: compiled, unresolved } = compileTimingAttrs(html);

    // Comment text is preserved verbatim — no id/data-start/data-hf-auto-start injected.
    expect(compiled).toBe(html);
    expect(compiled).not.toContain("data-hf-auto-start");
    expect(unresolved).toHaveLength(0);
  });

  it("ignores media tags inside <script> string literals", () => {
    const html = '<script>const x = "<video src=\\"a.mp4\\">";</script>';
    const { html: compiled, unresolved } = compileTimingAttrs(html);

    expect(compiled).toBe(html);
    expect(unresolved).toHaveLength(0);
  });

  it("still compiles real media tags alongside a comment that mentions them", () => {
    const html =
      '<!-- a <video> in prose -->\n<video src="a.mp4" data-start="0" data-duration="2">';
    const { html: compiled } = compileTimingAttrs(html);

    expect(compiled).toContain("<!-- a <video> in prose -->");
    expect(compiled).toContain('id="hf-video-0"');
    expect(compiled).toContain('data-end="2"');
  });

  it("preserves inert regions when compiled output is compiled again", () => {
    const html = [
      '<style>.hero::after { content: "$& $$ $` $\' <video>"; }</style>',
      '<script>const markup = "$& $$ $` $\' <audio>";</script>',
      '<video class="hero" src="a.mp4" data-start="0" data-duration="2">',
    ].join("\n");

    const first = compileTimingAttrs(html).html;
    const second = compileTimingAttrs(first).html;

    expect(second).toContain('<style>.hero::after { content: "$& $$ $` $\' <video>"; }</style>');
    expect(second).toContain('<script>const markup = "$& $$ $` $\' <audio>";</script>');
    expect(second).toContain('data-end="2"');
    expect(second).not.toContain("HFMASK");
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

  it("injects data-duration but not data-end when data-start is a relative id-ref", () => {
    const html = '<video id="main" src="b.mp4" data-start="intro">';
    const result = injectDurations(html, [{ id: "main", duration: 5 }]);

    expect(result).toContain('data-duration="5"');
    expect(result).toContain('data-start="intro"');
    expect(result).not.toMatch(/data-end=/);
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
    expect(resolved[0].loop).toBe(false);
    expect(resolved[1].id).toBe("a1");
    expect(resolved[1].tagName).toBe("audio");
    expect(resolved[1].duration).toBe(10);
  });

  it("marks looped media so render compilation can preserve display duration", () => {
    const html = '<video id="v1" src="vid.webm" data-start="0" data-duration="4" loop>';

    const resolved = extractResolvedMedia(html);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      id: "v1",
      tagName: "video",
      duration: 4,
      loop: true,
    });
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

describe("shouldClampResolvedMediaDuration", () => {
  it("preserves an explicit video slot but keeps audio source-bounded", () => {
    expect(shouldClampResolvedMediaDuration("video", 5, 1)).toBe(false);
    expect(shouldClampResolvedMediaDuration("audio", 5, 1)).toBe(true);
  });
});
