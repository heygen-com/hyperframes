import { describe, expect, it } from "bun:test";
import {
  EDGE_CASES,
  FAKE_GSAP_FILE,
  FIXTURE_FPS,
  INELIGIBLE_CASES,
  type IneligibleCase,
  STREAM_OFFSET_SECONDS,
  buildAnimatedImageArgs,
  buildCaptionCues,
  buildCompositionHtml,
  buildSourceClipArgs,
  buildStreamOffsetArgs,
  edgeSourceName,
  isFixtureTransfer,
} from "./fixture.js";

function argAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

describe("buildSourceClipArgs", () => {
  const args = buildSourceClipArgs({
    outputPath: "/tmp/out.mp4",
    durationSec: 20,
    width: 1920,
    height: 1080,
    fps: 30,
    crf: 12,
  });

  it("encodes 10-bit HEVC Main10 tagged as BT.2020 HLG at container and VUI level", () => {
    expect(argAfter(args, "-c:v")).toBe("libx265");
    expect(argAfter(args, "-pix_fmt")).toBe("yuv420p10le");
    expect(argAfter(args, "-profile:v")).toBe("main10");
    expect(argAfter(args, "-color_primaries")).toBe("bt2020");
    expect(argAfter(args, "-color_trc")).toBe("arib-std-b67");
    expect(argAfter(args, "-colorspace")).toBe("bt2020nc");
    expect(argAfter(args, "-x265-params")).toContain("transfer=arib-std-b67");
    expect(argAfter(args, "-x265-params")).toContain("colorprim=bt2020");
    expect(argAfter(args, "-tag:v")).toBe("hvc1");
  });

  it("adds no HDR10 static metadata to the HLG clip", () => {
    expect(argAfter(args, "-x265-params")).not.toContain("master-display");
    expect(argAfter(args, "-x265-params")).not.toContain("max-cll");
  });

  it("generates motion + gradients at the requested size and rate, with audio", () => {
    const graph = argAfter(args, "-filter_complex") ?? "";
    expect(graph).toContain("gradients=size=1920x1080:rate=30");
    expect(graph).toContain("testsrc2=size=960x540:rate=30");
    expect(graph).toContain("sine=");
    expect(argAfter(args, "-c:a")).toBe("aac");
    expect(argAfter(args, "-t")).toBe("20");
    expect(args.at(-1)).toBe("/tmp/out.mp4");
  });
});

describe("buildSourceClipArgs with transfer pq", () => {
  const args = buildSourceClipArgs({
    outputPath: "/tmp/pq.mp4",
    durationSec: 20,
    width: 1920,
    height: 1080,
    fps: 30,
    crf: 12,
    transfer: "pq",
  });

  it("tags SMPTE ST 2084 at container and VUI level and writes HDR10 static metadata", () => {
    expect(argAfter(args, "-color_trc")).toBe("smpte2084");
    expect(argAfter(args, "-color_primaries")).toBe("bt2020");
    expect(argAfter(args, "-colorspace")).toBe("bt2020nc");
    const x265 = argAfter(args, "-x265-params") ?? "";
    expect(x265).toContain("transfer=smpte2084");
    expect(x265).not.toContain("arib-std-b67");
    expect(x265).toContain("master-display=G(8500,39850)");
    expect(x265).toContain("max-cll=1000,400");
    expect(x265.endsWith("log-level=error")).toBe(true);
  });

  it("accepts only hlg and pq", () => {
    expect(isFixtureTransfer("hlg")).toBe(true);
    expect(isFixtureTransfer("pq")).toBe(true);
    expect(isFixtureTransfer("sdr")).toBe(false);
  });
});

describe("buildCaptionCues", () => {
  it("makes 10 frame-aligned, non-overlapping cues with gaps for the 20 s fixture", () => {
    const cues = buildCaptionCues(20, 10, FIXTURE_FPS);
    expect(cues).toHaveLength(10);
    let previousEnd = 0;
    for (const cue of cues) {
      const startFrames = cue.startSec * FIXTURE_FPS;
      const endFrames = (cue.startSec + cue.durationSec) * FIXTURE_FPS;
      expect(Math.abs(startFrames - Math.round(startFrames))).toBeLessThan(1e-6);
      expect(Math.abs(endFrames - Math.round(endFrames))).toBeLessThan(1e-4);
      expect(cue.startSec).toBeGreaterThan(previousEnd);
      expect(cue.durationSec).toBeGreaterThan(0);
      previousEnd = cue.startSec + cue.durationSec;
    }
    expect(previousEnd).toBeLessThan(20);
    expect(new Set(cues.map((cue) => cue.id)).size).toBe(10);
  });

  it("rejects bad input", () => {
    expect(() => buildCaptionCues(1, 3, 30)).toThrow();
    expect(() => buildCaptionCues(20, 0, 30)).toThrow();
  });
});

describe("buildCompositionHtml", () => {
  const cues = buildCaptionCues(20, 10, FIXTURE_FPS);
  const base = {
    compositionId: "hdr-passthrough-captions",
    videoSrc: "assets/hlg-source.mp4",
    durationSec: 20,
    width: 1920,
    height: 1080,
    cues,
  };

  it("puts the video full-bleed on track 0 and every cue on track 1", () => {
    const html = buildCompositionHtml(base);
    expect(html).toContain('data-composition-id="hdr-passthrough-captions"');
    expect(html).toMatch(/<video[^>]*id="hdr-source"[^>]*data-track-index="0"/s);
    expect(html).toContain('data-duration="20"');
    expect(html.match(/class="clip caption"/g)).toHaveLength(10);
    expect(html.match(/data-track-index="1"/g)).toHaveLength(10);
    expect(html).toContain("rgba(12, 14, 20, 0.58)");
    expect(html).not.toContain("transform:");
    expect(html).not.toContain("<script");
  });

  it("adds the transform only on the negative fixture", () => {
    const html = buildCompositionHtml({
      ...base,
      videoStyle: "transform: scale(0.9) rotate(1.5deg)",
    });
    expect(html).toContain('style="transform: scale(0.9) rotate(1.5deg)"');
  });

  it("has no wrapper, extra overlay or timeline unless asked", () => {
    const html = buildCompositionHtml(base);
    expect(html).toContain("data-no-timeline");
    expect(html).not.toContain('id="hdr-frame"');
    expect(html).not.toContain('id="extra-overlay"');
    expect(html).not.toContain("gsap");
  });

  it("wraps the video, adds a track-2 overlay and registers a GSAP timeline on request", () => {
    const html = buildCompositionHtml({
      ...base,
      videoWrapperStyle: "position:absolute;inset:0;overflow:hidden;border-radius:48px",
      headHtml: "<style>.x{}</style>",
      overlayHtml: '<div id="spinner"></div>',
      timelineScript: 'tl.to("#spinner", { rotation: 360, duration: 2 }, 0);',
    });
    expect(html).toMatch(/<div id="hdr-frame" style="[^"]*border-radius:48px">\s*<video/s);
    expect(html).toContain('<script src="assets/gsap.min.js"></script>');
    expect(html).toContain("<style>.x{}</style>");
    expect(html).toMatch(
      /id="extra-overlay" class="clip"[^>]*data-track-index="2"><div id="spinner">/,
    );
    expect(html).not.toContain("data-no-timeline");
    expect(html).toContain('window.__timelines["hdr-passthrough-captions"] = tl;');
    expect(html.indexOf("gsap.min.js")).toBeLessThan(html.indexOf("gsap.timeline"));
  });

  it("escapes cue text", () => {
    const html = buildCompositionHtml({
      ...base,
      cues: [{ id: "cue-001", text: "<b>&</b>", startSec: 1, durationSec: 1 }],
    });
    expect(html).toContain("&lt;b&gt;&amp;&lt;/b&gt;");
  });
});

describe("INELIGIBLE_CASES", () => {
  it("has unique names and covers every fallback class the passthrough declines", () => {
    const names = INELIGIBLE_CASES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    const reasons = new Set(INELIGIBLE_CASES.map((c) => c.reason));
    for (const reason of [
      "not_full_canvas",
      "transform_or_filter",
      "clip_or_mask",
      "overlay_non_gsap_animation",
      "overlay_continuous_animation",
      "canvas",
      "video_count",
      "overlay_unverified",
      "seek_callback",
      "overlay_unreadable",
      "video_animated",
    ]) {
      expect(reasons.has(reason)).toBe(true);
    }
    for (const name of [
      "lottie-player",
      "three",
      "webgpu",
      "svg-smil",
      "animated-gif",
      "animated-webp",
      "animated-apng",
      "animated-avif",
      "hf-seek-listener",
      "seek-time-setter",
      "flash-raf",
      "flash-setter",
      "raf-counter",
      "raf-warmup",
      "timer-append",
      "gsap-from-lazy",
      "closed-shadow-root",
      "embedded-document",
      "gsap-delayed-call",
      "video-dim-clip",
      "video-dim-gsap",
      "setter-highlight",
      "gsap-proxy-highlight",
      "shadow-css-animation",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("tweens content the fingerprint cannot read, and uses GSAP's global timeline", () => {
    const find = (name: string) => INELIGIBLE_CASES.find((c) => c.name === name)!;
    expect(find("closed-shadow-root").composition.timelineScript).toContain('mode: "closed"');
    expect(find("closed-shadow-root").composition.timelineScript).toContain("tl.to(inner");
    expect(find("embedded-document").composition.overlayHtml).toContain("<object");
    expect(find("embedded-document").composition.timelineScript).toContain("contentDocument");
    const delayed = find("gsap-delayed-call");
    expect(delayed.composition.timelineScript).toContain("gsap.delayedCall(1.5");
    expect(delayed.composition.timelineScript).not.toContain("tl.");
  });

  it("drives the history-dependent cases from seeks, not from the frame time alone", () => {
    const find = (name: string) => INELIGIBLE_CASES.find((c) => c.name === name)!;
    for (const name of ["raf-counter", "raf-warmup"]) {
      expect(find(name).composition.headHtml).toMatch(/n\+\+.*requestAnimationFrame\(loop\)/);
    }
    expect(find("timer-append").composition.headHtml).toContain("setInterval");
    const lazy = find("gsap-from-lazy");
    expect(lazy.composition.timelineScript).toContain("immediateRender: false");
    expect(lazy.composition.headHtml).toContain("__hfTypegpuTime");
    expect(lazy.assets).toContain("gsap");
  });

  it("keeps the seek-history cases free of page code that runs after load", () => {
    // Their paint follows browser state a seek leaves behind, not a page function: only the
    // order capture reaches the frames in decides whether it matches the layered render.
    const find = (name: string) => INELIGIBLE_CASES.find((c) => c.name === name)!;
    for (const name of ["scroll-clamp", "lazy-decode-popover"]) {
      const script = find(name).composition.timelineScript ?? "";
      expect(script).not.toMatch(/=>|function\s*\(/);
      expect(script).toMatch(/tl\.set\(/);
    }
    expect(find("scroll-clamp").composition.timelineScript).toContain("scrollTop = 1500");
    expect(find("lazy-decode-popover").composition.overlayHtml).toContain('loading="lazy"');
    expect(find("lazy-decode-popover").composition.timelineScript).toContain(
      ".decode().then(HTMLElement.prototype.showPopover.bind(",
    );
  });

  it("spells the SVG animations only as XML parsing reads them", () => {
    const find = (name: string) => INELIGIBLE_CASES.find((c) => c.name === name)!;
    const svg = (name: string) => {
      const html = find(name).composition.overlayHtml ?? "";
      return decodeURIComponent(/data:image\/svg\+xml,([^"]+)"/.exec(html)?.[1] ?? "");
    };
    expect(svg("svg-prefixed-smil")).toContain("<s:animate ");
    expect(svg("svg-prefixed-smil")).not.toMatch(/<animate/);
    expect(svg("svg-reference-css")).toContain("anim&#97;tion");
    expect(svg("svg-reference-css")).not.toMatch(/animation|@keyframes/);
    // Split names the browser joins back after parsing, and an XHTML stylesheet it applies.
    expect(svg("svg-comment-css")).toContain("anim<!---->ation");
    expect(svg("svg-comment-css")).not.toContain("animation");
    expect(svg("svg-comment-keyframes")).toContain("@key<!---->frames");
    expect(svg("svg-comment-keyframes")).not.toContain("@keyframes");
    expect(svg("svg-cdata-css")).toContain("anim<![CDATA[ation]]>");
    expect(svg("svg-xhtml-style")).toContain("<metadata><h:style>");
  });

  it("drives the seek-hook cases from the runtime's seek, not from GSAP", () => {
    const listener = INELIGIBLE_CASES.find((c) => c.name === "hf-seek-listener")!;
    expect(listener.composition.headHtml).toContain('addEventListener("hf-seek"');
    const setter = INELIGIBLE_CASES.find((c) => c.name === "seek-time-setter")!;
    expect(setter.composition.headHtml).toContain("__hfTypegpuTime");
    expect(setter.composition.headHtml).not.toContain("addEventListener");
    for (const c of [listener, setter]) expect(c.composition.timelineScript).toBeUndefined();
  });

  it("puts each flash case in one cue-free state, away from a sampling grid", () => {
    for (const [name, reason] of [
      // The raf loop is declined where it registers; the setter is page code that runs on
      // eligibility's seeks, which the analysis page's page code watch declines.
      ["flash-raf", "seek_callback"],
      ["flash-setter", "seek_callback"],
    ] as const) {
      const c = INELIGIBLE_CASES.find((x) => x.name === name)!;
      expect(c.reason).toBe(reason);
      expect(c.composition.cues).toEqual([]);
      expect(c.composition.timelineScript).toBeUndefined();
      const html = buildCompositionHtml({
        videoSrc: "assets/v.mp4",
        durationSec: 3,
        width: 1920,
        height: 1080,
        cues: [],
        ...c.composition,
        compositionId: name,
      });
      expect(html).toContain("FLASH");
      expect(html).not.toContain(`class="clip caption"`);
    }
    const raf = INELIGIBLE_CASES.find((c) => c.name === "flash-raf")!;
    expect(raf.composition.headHtml).toContain("requestAnimationFrame(function loop");
    const setter = INELIGIBLE_CASES.find((c) => c.name === "flash-setter")!;
    expect(setter.composition.headHtml).toContain("__hfTypegpuTime");
  });

  it("dims the video through a selector alone, between the layout samples", () => {
    const find = (name: string) => INELIGIBLE_CASES.find((c) => c.name === name)!;
    for (const name of ["video-dim-clip", "video-dim-gsap"]) {
      const c = find(name);
      expect(c.reason).toBe("video_animated");
      expect(c.composition.headHtml).toMatch(/#root:has\(.*\) #hdr-source \{ opacity: 0\.3; \}/);
      expect(c.composition.videoStyle).toBeUndefined();
      expect(c.composition.timelineScript ?? "").not.toContain("hdr-source");
    }
    expect(find("video-dim-clip").composition.cues).toEqual([
      { id: "dimcue", text: "DIM", startSec: 1.4, durationSec: 0.2 },
    ]);
    expect(find("video-dim-clip").composition.timelineScript).toBeUndefined();
    expect(find("video-dim-gsap").composition.timelineScript).toContain('"data-on": "1" } }, 1.4)');
  });

  it("changes unreadable state only from page code that runs on seeks", () => {
    const find = (name: string) => INELIGIBLE_CASES.find((c) => c.name === name)!;
    for (const name of ["setter-highlight", "gsap-proxy-highlight"]) {
      const c = find(name);
      expect(c.reason.split("|")).toContain("seek_callback");
      expect(c.composition.headHtml).toContain("CSS.highlights.set");
      expect(c.composition.cues).toEqual([]);
      expect(c.composition.headHtml).not.toContain("requestAnimationFrame");
    }
    expect(find("setter-highlight").composition.headHtml).toContain("__hfTypegpuTime");
    expect(find("setter-highlight").composition.timelineScript).toBeUndefined();
    expect(find("gsap-proxy-highlight").composition.timelineScript).toContain(
      "tl.set(window.highlightProxy",
    );
  });

  it("defines the seek-time setter every way the page can compile it", () => {
    const find = (name: string) => INELIGIBLE_CASES.find((c) => c.name === name)!;
    const ways: Record<string, string> = {
      "dynamic-inline-setter": 'document.createElement("script")',
      "eval-setter": "eval(",
      "new-function-setter": "new Function(",
      "renderer-named-setter": "//# sourceURL=hyperframes://injected/0",
      "devtools-named-setter": "sourceURL=pptr:evaluate",
      "string-timer-setter": "setTimeout(",
      "fake-gsap-filename": `src="assets/${FAKE_GSAP_FILE}"`,
      "dynamic-inline-gsap-proxy": 'document.createElement("script")',
    };
    for (const [name, way] of Object.entries(ways)) {
      const c = find(name);
      // The page code watch declines each; a sticky setter's verification probes may first.
      expect(c.reason.split("|")).toContain("seek_callback");
      expect(c.composition.headHtml).toContain(way);
      // Script text is raw: an HTML entity in it would be a syntax error, not a quote.
      expect(c.composition.headHtml).not.toContain("&quot;");
    }
    expect(find("fake-gsap-filename").assets).toEqual(["fake-gsap"]);
    expect(find("dynamic-inline-gsap-proxy").assets).toEqual(["gsap"]);
    // The inline setter is the plain case: the others only change how it is compiled.
    expect(find("setter-highlight").composition.headHtml).toContain("CSS.highlights.set");
  });

  it("shows the builtins that ran inside the shim's wrappers, from an animation-frame loop", () => {
    const c = INELIGIBLE_CASES.find((x) => x.name === "builtins-counter")!;
    expect(c.reason).toBe("seek_callback");
    for (const builtin of ['"split"', '"indexOf"', '"test"', '"exec"', "Error.prepareStackTrace"]) {
      expect(c.composition.headHtml).toContain(builtin);
    }
    for (const call of [
      "register(requestAnimationFrame",
      "register(setTimeout",
      "register(setInterval",
    ]) {
      expect(c.composition.headHtml).toContain(call);
    }
  });

  it("hands the browser and GSAP builtins, not page functions, in the native-callback cases", () => {
    const find = (name: string) => INELIGIBLE_CASES.find((c) => c.name === name)!;
    for (const name of [
      "observer-popover",
      "listener-popover",
      "handler-selection",
      "custom-element-popover",
      "tween-native-setter",
      "tween-proxy-trap",
      "tween-function-value",
    ]) {
      const c = find(name);
      expect(c.reason).toBe("seek_callback");
      // Only builtins run on seeks: the page's only functions are a class body and no callbacks.
      expect(c.composition.timelineScript).not.toMatch(/=>|function\s*\(/);
      expect(c.composition.timelineScript).toMatch(/\.bind\(|prototype\.showPopover;/);
    }
  });

  it("marks only the cases that paint on the wall clock as not repeatable", () => {
    const wallClock = INELIGIBLE_CASES.filter((c) => c.wallClock).map((c) => c.name);
    expect(wallClock).toEqual([
      "svg-smil",
      "shadow-css-animation",
      "marquee",
      "indeterminate-progress",
      "pseudo-element-gif",
      "shadow-root-gif",
      "shadow-root-video",
      "paint-worklet",
      "svg-prefixed-smil",
      "svg-reference-css",
      "svg-comment-css",
      "svg-comment-keyframes",
      "svg-cdata-css",
      "svg-xhtml-style",
      "picker-icon-gif",
      "scroll-button-gif",
      "shadow-worker-canvas",
      "animated-webp",
      "animated-apng",
      "animated-avif",
    ]);
  });

  it("expects the passthrough only where the page reads back a record, keeps seek history or times a pause", () => {
    const takes = INELIGIBLE_CASES.filter((c) => c.takesPassthrough);
    expect(takes.map((c) => c.name)).toEqual([
      "tostring-painter",
      "scroll-clamp",
      "lazy-decode-popover",
      "pause-timer",
      "pause-mark",
    ]);
    for (const c of takes) expect(c.wallClock).toBeUndefined();
  });

  it("names javascript: URL cases like DevTools evaluations, encoded so the setter survives", () => {
    for (const name of ["jsurl-location-setter", "jsurl-anchor-setter"]) {
      const c = INELIGIBLE_CASES.find((entry) => entry.name === name);
      const text = [c?.composition.headHtml, c?.composition.timelineScript].join(" ");
      const url = /"(javascript:[^"]+)"/.exec(text)?.[1] ?? "";
      expect(decodeURIComponent(url.slice("javascript:".length))).toMatch(
        /__hfTypegpuTime[\s\S]*\/\/# sourceURL=pptr:evaluate$/,
      );
    }
  });

  it("ships the assets each case references", () => {
    const gsap = INELIGIBLE_CASES.filter((c) => c.composition.timelineScript !== undefined);
    expect(gsap.length).toBeGreaterThan(0);
    for (const c of gsap) expect(c.assets).toContain("gsap");
    for (const c of INELIGIBLE_CASES.filter((c) => c.name.startsWith("animated-"))) {
      expect(c.assets).toHaveLength(1);
    }
    const uses = (c: IneligibleCase, text: string) =>
      [c.composition.headHtml, c.composition.overlayHtml, c.composition.timelineScript].some(
        (part) => part?.includes(text),
      );
    for (const [text, asset] of [
      ["assets/tone.m4a", "tone"],
      ["assets/sdr.mp4", "sdr-video"],
      ["assets/animated.gif", "gif"],
      ["assets/paint-counter.js", "paint-worklet"],
    ] as const) {
      for (const c of INELIGIBLE_CASES.filter((x) => uses(x, text)))
        expect(c.assets).toContain(asset);
    }
  });
});

describe("buildStreamOffsetArgs", () => {
  it("remuxes every stream without re-encoding, shifted by the offset", () => {
    const args = buildStreamOffsetArgs("/in.mp4", "/out.mp4", STREAM_OFFSET_SECONDS);
    expect(argAfter(args, "-i")).toBe("/in.mp4");
    expect(argAfter(args, "-map")).toBe("0");
    expect(argAfter(args, "-c")).toBe("copy");
    expect(argAfter(args, "-output_ts_offset")).toBe("0.2");
    expect(args.at(-1)).toBe("/out.mp4");
  });

  it("stays under the lead at which the layered path hides the video", () => {
    expect(STREAM_OFFSET_SECONDS).toBeGreaterThan(0);
    expect(STREAM_OFFSET_SECONDS).toBeLessThan(1);
  });
});

describe("buildAnimatedImageArgs", () => {
  it("writes a looping 2 s animation in each format", () => {
    for (const [format, codec] of [
      ["gif", "gif"],
      ["webp", "libwebp_anim"],
      ["apng", "apng"],
      ["avif", "libaom-av1"],
    ] as const) {
      const args = buildAnimatedImageArgs(format, `/tmp/a.${format}`);
      expect(argAfter(args, "-c:v")).toBe(codec);
      expect(argAfter(args, "-i")).toContain("duration=2");
      expect(args.at(-1)).toBe(`/tmp/a.${format}`);
    }
    expect(buildAnimatedImageArgs("avif", "/tmp/a.avif").slice(-3)).toEqual([
      "-f",
      "avif",
      "/tmp/a.avif",
    ]);
    expect(argAfter(buildAnimatedImageArgs("apng", "/tmp/a.png"), "-plays")).toBe("0");
  });
});

describe("buildSourceClipArgs with a rational rate and a fixed GOP", () => {
  const args = buildSourceClipArgs({
    outputPath: "/tmp/ntsc.mp4",
    durationSec: 20,
    width: 1920,
    height: 1080,
    fps: "30000/1001",
    crf: 12,
    gop: 300,
  });

  it("generates at the rational rate", () => {
    const graph = argAfter(args, "-filter_complex") ?? "";
    expect(graph).toContain("gradients=size=1920x1080:rate=30000/1001");
    expect(graph).toContain("testsrc2=size=960x540:rate=30000/1001");
  });

  it("pins the keyframe interval without scene-cut keyframes", () => {
    const x265 = argAfter(args, "-x265-params") ?? "";
    expect(x265).toContain("keyint=300:min-keyint=300:scenecut=0");
    expect(x265.endsWith("log-level=error")).toBe(true);
  });

  it("leaves x265's keyframe placement alone by default", () => {
    const plain = buildSourceClipArgs({
      outputPath: "/tmp/out.mp4",
      durationSec: 3,
      width: 1920,
      height: 1080,
      fps: 30,
      crf: 12,
    });
    expect(argAfter(plain, "-x265-params")).not.toContain("keyint");
  });
});

describe("buildCompositionHtml mediaStart", () => {
  const base = {
    compositionId: "c",
    videoSrc: "assets/s.mp4",
    durationSec: 5,
    width: 1920,
    height: 1080,
    cues: [],
  };

  it("starts the video at 0 unless told otherwise", () => {
    expect(buildCompositionHtml(base)).toContain('data-media-start="0"');
    expect(buildCompositionHtml({ ...base, mediaStart: 13.37 })).toContain(
      'data-media-start="13.37"',
    );
  });
});

describe("EDGE_CASES", () => {
  it("has unique names and sources long enough for mediaStart + duration", () => {
    const names = EDGE_CASES.map((edge) => edge.name);
    expect(new Set(names).size).toBe(names.length);
    for (const edge of EDGE_CASES) {
      expect(edge.source.durationSec).toBeGreaterThanOrEqual(
        (edge.mediaStart ?? 0) + edge.durationSec,
      );
      expect(edge.source.width % 2).toBe(0);
      expect(edge.source.height % 2).toBe(0);
      expect(edge.fps).toMatch(/^\d+(\/\d+)?$/);
      if (edge.expect === "fallback") expect(edge.expectReason).toBeTruthy();
    }
  });

  it("covers rational rates, an odd canvas, a crop, a partial last frame and a deep seek", () => {
    expect(EDGE_CASES.some((e) => e.source.fps === "30000/1001" && e.fps === "30")).toBe(true);
    expect(EDGE_CASES.some((e) => e.source.fps === "30000/1001" && e.fps === "30000/1001")).toBe(
      true,
    );
    expect(EDGE_CASES.some((e) => e.source.fps === "24000/1001" && e.fps === "30")).toBe(true);
    expect(EDGE_CASES.some((e) => e.canvas.width % 2 === 1 && e.canvas.height % 2 === 1)).toBe(
      true,
    );
    expect(EDGE_CASES.find((e) => e.name === "cover-4x3")?.expectReason).toBe("object_fit");
    expect(EDGE_CASES.some((e) => !Number.isInteger(e.durationSec * 30))).toBe(true);
    const deep = EDGE_CASES.find((e) => e.source.gop !== undefined);
    expect(deep?.mediaStart).toBeGreaterThan((deep?.source.gop ?? 0) / 30);
  });

  it("names one asset per distinct source", () => {
    const sources = new Set(EDGE_CASES.map((edge) => edgeSourceName("hlg", edge.source)));
    const distinct = new Set(EDGE_CASES.map((edge) => JSON.stringify(edge.source)));
    expect(sources.size).toBe(distinct.size);
    expect(
      edgeSourceName("pq", {
        width: 1920,
        height: 1080,
        fps: "24000/1001",
        durationSec: 6,
      }),
    ).toBe("pq-1920x1080-24000-1001fps-6s.mp4");
  });
});
