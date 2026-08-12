import { describe, it, expect } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";

describe("media rules", () => {
  it("reports error for duplicate media ids", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <video id="v1" src="a.mp4" data-start="0" data-duration="5"></video>
    <video id="v1" src="b.mp4" data-start="0" data-duration="3"></video>
  </div>
  <script>window.__timelines = {};</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "duplicate_media_id");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.elementId).toBe("v1");
  });

  it("reports error for audio with data-start but no id", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <audio data-start="0" data-duration="10" src="narration.wav"></audio>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["c1"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "media_missing_id");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("SILENT");
  });

  it("reports error for video with data-start but no id", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <video data-start="0" data-duration="10" src="clip.mp4" muted playsinline></video>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["c1"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "media_missing_id");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("FROZEN");
  });

  it("flags media that has data-hf-id but no real id", async () => {
    // Regression: readAttr(tag, "id") used a \b boundary that matched the
    // trailing `id="…"` inside `data-hf-id="…"`, so media carrying only a
    // Studio-stamped data-hf-id passed the check and then rendered as a blank
    // wash (video) / silent (audio). data-hf-id is NOT a render id.
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <video data-hf-id="hf-v1a2b3" data-start="0" data-duration="10" src="clip.mp4" muted playsinline></video>
    <audio data-hf-id="hf-a4c5d6" data-start="0" data-duration="10" src="narration.wav"></audio>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["c1"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const findings = result.findings.filter((f) => f.code === "media_missing_id");
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.severity === "error")).toBe(true);
  });

  it("does not flag media elements that have id", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <audio id="a1" data-start="0" data-duration="10" src="narration.wav"></audio>
    <video id="v1" data-start="0" data-duration="10" src="clip.mp4" muted playsinline></video>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["c1"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "media_missing_id");
    expect(finding).toBeUndefined();
  });

  it("reports grading controls placed outside their schema sections", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <video id="v1" data-start="0" data-duration="5" src="clip.mp4" muted data-color-grading='{"preset":"skin-soft","intensity":0.58,"highlights":-0.06,"temperature":0.02}'></video>
  </div>
  <script>window.__timelines = {};</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "color_grading_invalid_structure");
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("highlights");
    expect(finding?.fixHint).toContain('"adjust"');
  });

  it("accepts grading controls inside their schema sections", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <video id="v1" data-start="0" data-duration="5" src="clip.mp4" muted data-color-grading='{"preset":"skin-soft","intensity":0.58,"adjust":{"highlights":-0.06,"temperature":0.02},"details":{"vignette":0.03},"effects":{"blur":0.1,"chromaBleed":0.2,"tapeDamage":0.3,"tapeTracking":0.4,"tapeNoise":0.5,"tapeSpeed":0.6,"filmArtifacts":0.4,"halftone":0.5,"halftoneSize":0.6,"twoInkPrint":0.7,"twoInkPrintSize":0.8,"ascii":0.9,"asciiSize":0.4,"asciiInvert":1,"dither":0.8,"ditherSize":0.3,"bloom":0.5,"bloomRadius":8,"asciiStyle":4,"asciiColor":1,"asciiRotation":1,"monoScreen":0.5,"monoScreenSize":0.4,"monoScreenAngle":0.3,"monoScreenSpread":0.2,"monoScreenShape":3,"monoScreenInvert":1,"scanlines":0.3,"scanlineCount":0.4,"scanlineSoftness":0.5,"chromaticAberration":0.2,"chromaticAngle":0.6,"crtCurvature":0.25,"digitalGlitch":0.4,"digitalGlitchColorSplit":0.45,"digitalGlitchLineTear":0.5,"digitalGlitchPixelate":0.55,"digitalGlitchBlockAmount":0.6,"digitalGlitchBlockDisplacement":0.7,"digitalGlitchBlockOpacity":0.2,"digitalGlitchSpeed":0.7,"engraving":1,"engravingSpacing":0.4117647,"engravingMinThickness":0.2,"engravingMaxThickness":0.4571429,"engravingAngle":0.25,"engravingContrast":0.4666667,"engravingSharpness":0.59,"engravingWave":0.2,"engravingWaveFrequency":0.2222222},"palette":["#ff6b66","#080717","#d9339f","#3c185f"],"lut":null}'></video>
  </div>
  <script>window.__timelines = {};</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    expect(result.findings.find((f) => f.code.startsWith("color_grading_"))).toBeUndefined();
  });

  it("accepts crosshatch controls in the effects section", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <video data-start="0" data-duration="5" src="clip.mp4" muted data-color-grading='{"effects":{"crosshatch":1,"crosshatchSpacing":0.28,"crosshatchThickness":0.25,"crosshatchAngle":0.25,"crosshatchContrast":0.3333333,"crosshatchEdges":0.5,"crosshatchLineWeight":0,"crosshatchWave":0.33,"crosshatchWaveFrequency":0.2222222}}'></video>
  </div>
  <script>window.__timelines = {};</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    expect(result.findings.find((f) => f.code.startsWith("color_grading_"))).toBeUndefined();
  });

  it("accepts Kuwahara controls in the effects section", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <video data-start="0" data-duration="5" src="clip.mp4" muted data-color-grading='{"effects":{"kuwahara":1,"kuwaharaRadius":0.142857,"kuwaharaSharpness":0.3125,"kuwaharaSaturation":0.5}}'></video>
  </div>
  <script>window.__timelines = {};</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    expect(result.findings.find((f) => f.code.startsWith("color_grading_"))).toBeUndefined();
  });

  it("reports malformed or out-of-range color grading palettes", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <video id="v1" data-start="0" data-duration="5" src="clip.mp4" muted data-color-grading='{"effects":{"dither":1},"palette":["#000000","red"]}'></video>
  </div>
  <script>window.__timelines = {};</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "color_grading_invalid_structure");
    expect(finding?.severity).toBe("error");
    expect(finding?.fixHint).toContain("2 to 6");
    expect(finding?.fixHint).toContain("#RRGGBB");
  });

  it("reports malformed grading JSON", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <video id="v1" data-start="0" data-duration="5" src="clip.mp4" muted data-color-grading='{"preset":"skin-soft"'></video>
  </div>
  <script>window.__timelines = {};</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    expect(result.findings.find((f) => f.code === "color_grading_invalid_json")?.severity).toBe(
      "error",
    );
  });

  it("reports invalid string values for structured grading sections", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <video id="v1" data-start="0" data-duration="5" src="clip.mp4" muted data-color-grading='{"adjust":"cinematic"}'></video>
  </div>
  <script>window.__timelines = {};</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    expect(
      result.findings.find((f) => f.code === "color_grading_invalid_structure")?.severity,
    ).toBe("error");
  });

  it("reports color grading on non-media elements", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="background" data-color-grading='{"preset":"skin-soft"}'></div>
  </div>
  <script>window.__timelines = {};</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    expect(result.findings.find((f) => f.code === "color_grading_non_media")?.severity).toBe(
      "error",
    );
  });

  it("reports warning for media with preload=none", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <video id="v1" data-start="0" data-duration="10" src="clip.mp4" muted playsinline preload="none"></video>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["c1"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "media_preload_none");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
  });

  it("reports error for media with id but no src", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <audio id="a1" data-start="0" data-duration="10"></audio>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["c1"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "media_missing_src");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("accepts <source src> children in place of parent src", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <video id="rec" data-start="0" data-duration="4" muted playsinline>
      <source src="clip.mp4" type="video/mp4">
      <source src="clip.webm" type="video/webm">
    </video>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["c1"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    expect(result.findings.some((f) => f.code === "media_missing_src")).toBe(false);
  });

  it("reports error for <source>-only media with no data-start", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <video id="rec" muted playsinline>
      <source src="clip.mp4" type="video/mp4">
    </video>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["c1"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "media_missing_data_start");
    expect(finding).toBeDefined();
    expect(finding?.elementId).toBe("rec");
  });

  it("reports error for media with src but no data-start", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <video id="demo-video" src="clip.mp4" muted playsinline></video>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["c1"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "media_missing_data_start");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.elementId).toBe("demo-video");
  });

  it("allows audible video clips to omit muted when data-has-audio is true", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <video id="demo-video" data-start="0" data-duration="5" data-has-audio="true" src="clip.mp4" playsinline></video>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["c1"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    expect(result.findings.find((f) => f.code === "video_missing_muted")).toBeUndefined();
    expect(
      result.findings.find((f) => f.code === "video_muted_with_declared_audio"),
    ).toBeUndefined();
  });

  it("reports error for videos that declare audio while muted", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <video id="demo-video" data-start="0" data-duration="5" data-has-audio="true" src="clip.mp4" muted playsinline></video>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["c1"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "video_muted_with_declared_audio");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.elementId).toBe("demo-video");
  });

  it("does NOT flag <video> as nested in a void element with data-start (regression)", async () => {
    // Regression: void elements like <img> have no closing tag, so the previous
    // implementation kept them on the parent stack indefinitely and flagged any
    // later <video> with data-start as "nested" inside them.
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <img id="hdr-img" src="hdr.png" data-start="0" data-duration="5" data-track-index="0" />
    <video id="hdr-vid" src="clip.mp4" data-start="5" data-duration="5" data-track-index="1" muted playsinline></video>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["c1"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "video_nested_in_timed_element");
    expect(finding).toBeUndefined();
  });

  it("reports imperative play() control on managed media ids", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <video id="demo-video" data-start="0" data-duration="5" src="clip.mp4" muted playsinline></video>
  </div>
  <script>
    const video = document.getElementById("demo-video");
    video.play();
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "imperative_media_control");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.elementId).toBe("demo-video");
  });

  it("reports imperative currentTime writes on query-selected managed media", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <video id="demo-video" data-start="0" data-duration="5" src="clip.mp4" muted playsinline></video>
  </div>
  <script>
    const demo = document.querySelector("#demo-video");
    demo.currentTime = 1.5;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "imperative_media_control");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("reports imperative muted/play control on class-selected media without ids", async () => {
    const html = `
<template id="scene-template">
  <div data-composition-id="scene" data-width="1920" data-height="1080">
    <video class="demo-video" src="clip.mp4" muted playsinline></video>
    <script>
      const vid = document.querySelector('[data-composition-id="scene"] .demo-video');
      if (vid) { vid.muted = true; vid.play(); }
    </script>
  </div>
</template>`;
    const result = await lintHyperframeHtml(html, { filePath: "compositions/scene.html" });
    const imperativeFindings = result.findings.filter((f) => f.code === "imperative_media_control");
    expect(imperativeFindings.length).toBe(2);
    expect(imperativeFindings.some((f) => f.snippet === "vid.muted =")).toBe(true);
    expect(imperativeFindings.some((f) => f.snippet === "vid.play(")).toBe(true);
  });

  it("does not flag play() on non-media elements", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="panel"></div>
  </div>
  <script>
    const panel = document.getElementById("panel");
    panel.play?.();
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "imperative_media_control");
    expect(finding).toBeUndefined();
  });

  it("does not flag <video> inside a sub-composition (runtime drives nested media)", async () => {
    // The runtime's global media sweep (querySelectorAll("video, audio")) drives
    // media at any nesting depth, and startResolver re-bases each nested clip's
    // local data-start by its host composition's absolute start. Sub-composition
    // media is therefore seeked + decoded correctly in preview and render — see
    // packages/core/src/runtime/{media,startResolver,init}.ts. A prior
    // `media_in_subcomposition` rule wrongly hard-errored this and was removed.
    const html = `<template id="scene-template">
  <div id="root" data-composition-id="scene" data-width="1920" data-height="1080">
    <video id="v1" src="clip.mp4" data-start="0" data-duration="5" muted playsinline></video>
    <script>window.__timelines = window.__timelines || {}; window.__timelines["scene"] = gsap.timeline({ paused: true });</script>
  </div>
</template>`;
    const result = await lintHyperframeHtml(html, { isSubComposition: true });
    const finding = result.findings.find((f) => f.code === "media_in_subcomposition");
    expect(finding).toBeUndefined();
  });

  it("does not flag media in a host-root (non-sub) composition", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <video id="v1" src="clip.mp4" data-start="0" data-duration="5" muted playsinline></video>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["c1"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "media_in_subcomposition");
    expect(finding).toBeUndefined();
  });

  it("reports error for media with crossorigin (breaks preview when host omits CORS)", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <video id="v1" crossorigin="anonymous" src="https://cdn.example.com/clip.mp4" data-start="0" data-duration="5" muted playsinline></video>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["c1"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "media_crossorigin_breaks_preview");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.elementId).toBe("v1");
  });

  it("does not flag media without crossorigin", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <video id="v1" src="https://cdn.example.com/clip.mp4" data-start="0" data-duration="5" muted playsinline></video>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["c1"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "media_crossorigin_breaks_preview");
    expect(finding).toBeUndefined();
  });
});

describe("media_variable_src_no_fallback", () => {
  it("downgrades missing src to a warning when data-var-src is present", async () => {
    const html = `<html><body>
<video id="clip" data-start="0" data-duration="2" data-var-src="media"></video>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    expect(result.findings.some((f) => f.code === "media_missing_src")).toBe(false);
    const finding = result.findings.find((f) => f.code === "media_variable_src_no_fallback");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
  });

  it("keeps the hard error when neither src nor data-var-src exists", async () => {
    const html = `<html><body>
<video id="clip" data-start="0" data-duration="2"></video>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    expect(result.findings.some((f) => f.code === "media_missing_src")).toBe(true);
  });
});

describe("audio_volume_tween_overrides_gain", () => {
  const withScript = (audioAttrs: string, script: string) => `<!DOCTYPE html><html><body>
    <div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="10">
      <audio id="bgm" src="a.wav" data-start="0" data-duration="10" ${audioAttrs}></audio>
    </div>
    <script>${script}</script>
  </body></html>`;

  it("warns that the tween's values win over an authored gain", async () => {
    const res = await lintHyperframeHtml(
      withScript(`data-volume="1.949845"`, `tl.fromTo("#bgm", { volume: 0 }, { volume: 1 });`),
    );
    const finding = res.findings.find((f) => f.code === "audio_volume_tween_overrides_gain");
    expect(finding?.severity).toBe("warning");
    expect(finding?.elementId).toBe("bgm");
    expect(finding?.message).toMatch(/5\.8 dB/);
  });

  it("warns about an attenuation the tween overrides, not just a boost", async () => {
    const res = await lintHyperframeHtml(
      withScript(`data-volume="0.3"`, `tl.to("#bgm", { volume: 1 });`),
    );
    expect(res.findings.some((f) => f.code === "audio_volume_tween_overrides_gain")).toBe(true);
  });

  it("stays quiet on the fade the docs recommend, which carries no data-volume", async () => {
    // `Number(null)` is 0 — finite and not 1 — so a clip with NO `data-volume`
    // was reported as authored at silence. Both halves were false, and this is
    // the shape the docs recommend for a tweened clip: the baseline attribute is
    // for elements no tween touches. The rule fired on exactly the common fade.
    const res = await lintHyperframeHtml(
      withScript("", `tl.fromTo("#bgm", { volume: 0 }, { volume: 1 });`),
    );
    expect(res.findings.some((f) => f.code === "audio_volume_tween_overrides_gain")).toBe(false);
  });

  it("stays quiet at unity, without a tween, or when a lane already owns the level", async () => {
    const unity = await lintHyperframeHtml(
      withScript(`data-volume="1"`, `tl.to("#bgm", { volume: 0 });`),
    );
    const noTween = await lintHyperframeHtml(
      withScript(`data-volume="2"`, `tl.to("#bgm", { x: 1 });`),
    );
    const lane = await lintHyperframeHtml(
      withScript(
        `data-volume="2" data-automation='{"version":1,"lanes":[{"target":"volume","points":[{"t":0,"v":1}]}]}'`,
        `tl.to("#bgm", { volume: 0 });`,
      ),
    );
    for (const res of [unity, noTween, lane]) {
      expect(res.findings.some((f) => f.code === "audio_volume_tween_overrides_gain")).toBe(false);
    }
  });
});

describe("audio_volume_double_automation", () => {
  const withScript = (audioAttrs: string, script: string) => `<!DOCTYPE html><html><body>
    <div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="10">
      <audio id="bgm" src="a.wav" data-start="0" data-duration="10" ${audioAttrs}></audio>
    </div>
    <script>${script}</script>
  </body></html>`;

  const LANE = `data-automation='{"version":1,"lanes":[{"target":"volume","points":[{"t":0,"v":1}]}]}'`;

  it("warns when a lane and a GSAP volume tween both shape the same track", async () => {
    const res = await lintHyperframeHtml(
      withScript(LANE, `tl.to("#bgm", { volume: 0, duration: 1 });`),
    );
    const finding = res.findings.find((f) => f.code === "audio_volume_double_automation");
    expect(finding?.severity).toBe("warning");
    expect(finding?.elementId).toBe("bgm");
  });

  it("stays quiet for a lane alone, a tween alone, or a tween on another track", async () => {
    const laneOnly = await lintHyperframeHtml(withScript(LANE, `tl.to("#bgm", { x: 10 });`));
    const tweenOnly = await lintHyperframeHtml(withScript("", `tl.to("#bgm", { volume: 0 });`));
    const otherTrack = await lintHyperframeHtml(withScript(LANE, `tl.to("#vo", { volume: 0 });`));
    for (const res of [laneOnly, tweenOnly, otherTrack]) {
      expect(res.findings.some((f) => f.code === "audio_volume_double_automation")).toBe(false);
    }
  });

  it("still warns when another value in the same call is a function result", async () => {
    // Bounding the scan at the first `)` to fix the chained-timeline case
    // silenced the rule for the ordinary shape of a tween whose object holds a
    // call — the paren closing `fadeTime(2)` ended the match before `volume`.
    // The lane and the tween still both drive volume, and the author still gets
    // no warning about it.
    const res = await lintHyperframeHtml(
      withScript(LANE, `tl.to("#bgm", { duration: fadeTime(2), volume: 0.2 });`),
    );
    expect(res.findings.some((f) => f.code === "audio_volume_double_automation")).toBe(true);
  });

  it("does not blame the wrong element in a chained timeline", async () => {
    // A chain has no semicolon until its very end, so a run that could cross `)`
    // reached the `volume` in a LATER call and reported the element from an
    // earlier one. Acting on the fixHint would have deleted #bgm's only real
    // automation to fix a tween that is on #vo.
    const res = await lintHyperframeHtml(
      withScript(
        LANE,
        `gsap.timeline().to("#bgm", { duration: 0.6, x: 10 }).to("#vo", { volume: 1 });`,
      ),
    );
    expect(res.findings.some((f) => f.code === "audio_volume_double_automation")).toBe(false);
  });

  it("still catches a real tween further down the same call", async () => {
    const res = await lintHyperframeHtml(
      withScript(LANE, `gsap.timeline().to("#bgm", { duration: 0.6, ease: "none", volume: 0 });`),
    );
    expect(res.findings.some((f) => f.code === "audio_volume_double_automation")).toBe(true);
  });

  it("ignores a lane that automates something other than volume", async () => {
    const res = await lintHyperframeHtml(
      withScript(
        `data-automation='{"version":1,"lanes":[{"target":"fx.n1.frequency","points":[{"t":0,"v":200}]}]}'`,
        `tl.to("#bgm", { volume: 0 });`,
      ),
    );
    expect(res.findings.some((f) => f.code === "audio_volume_double_automation")).toBe(false);
  });
});

describe("audio_group_no_members", () => {
  const doc = (body: string) => `<!DOCTYPE html><html><body>
    <div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="10">
      ${body}
    </div>
  </body></html>`;

  const BUS = `<hf-audio-group id="voiceover" data-label="Voiceover" data-volume="0.4"
    data-fx-chain='{"version":1,"nodes":[{"type":"peaking","id":"n1","params":{"frequency":250,"gain":-3,"q":1.2}}]}'></hf-audio-group>`;

  it("errors on a bus no clip in the file belongs to", async () => {
    const res = await lintHyperframeHtml(
      doc(
        `${BUS}<audio id="s-1" src="s.wav" data-start="0" data-duration="2" data-audio-group="sfx"></audio>`,
      ),
    );
    const finding = res.findings.find((f) => f.code === "audio_group_no_members");
    expect(finding?.severity).toBe("error");
    expect(finding?.elementId).toBe("voiceover");
  });

  // The whole point: one typo drops the authored bus (fader AND chain) and
  // invents a phantom group at unity, with nothing said about either.
  it("catches the misspelled member — the case that motivated the rule", async () => {
    const res = await lintHyperframeHtml(
      doc(
        `${BUS}<audio id="vo-1" src="vo.wav" data-start="0" data-duration="5" data-audio-group="voiceovr"></audio>`,
      ),
    );
    const finding = res.findings.find((f) => f.code === "audio_group_no_members");
    expect(finding?.elementId).toBe("voiceover");
    expect(finding?.message).toContain("voiceovr");
  });

  it("suggests only unmatched member ids, not a healthy sibling group", async () => {
    const res = await lintHyperframeHtml(
      doc(`${BUS}<hf-audio-group id="music"></hf-audio-group>
        <audio id="bgm" src="music.wav" data-start="0" data-duration="5" data-audio-group="music"></audio>
        <audio id="vo-1" src="vo.wav" data-start="0" data-duration="5" data-audio-group="voiceovr"></audio>`),
    );
    const finding = res.findings.find((item) => item.code === "audio_group_no_members");
    expect(finding?.message).toContain('"voiceovr"');
    expect(finding?.message).not.toContain('"music"');
  });

  it("does not count video as group membership", async () => {
    const res = await lintHyperframeHtml(
      doc(`${BUS}<video id="v" src="v.mp4" data-start="0" data-duration="5" data-audio-group="voiceover"></video>
        <audio id="s-1" src="s.wav" data-start="0" data-duration="2" data-audio-group="sfx"></audio>`),
    );
    expect(
      res.findings.some(
        (finding) => finding.code === "audio_group_no_members" && finding.elementId === "voiceover",
      ),
    ).toBe(true);
  });

  it("stays quiet when a clip belongs to it", async () => {
    const res = await lintHyperframeHtml(
      doc(
        `${BUS}<audio id="vo-1" src="vo.wav" data-start="0" data-duration="5" data-audio-group="voiceover"></audio>`,
      ),
    );
    expect(res.findings.some((f) => f.code === "audio_group_no_members")).toBe(false);
  });

  // A bus with no id cannot be joined at all, and `resolveAudioGroups` skips it
  // when building its element map — a different mistake, not this rule's.
  // The rule can only speak about a file it can see all of. `lintHyperframeHtml`
  // takes ONE file, and the studio's own group creation writes the bus into the
  // active composition while patching `data-audio-group` into each member's own
  // file (timelineAudioGroupCreate) — so a file holding a bus and no members at
  // all is the normal cross-file shape, not a mistake.
  it("stays quiet in a file that declares no members at all", async () => {
    const res = await lintHyperframeHtml(doc(BUS));
    expect(res.findings.some((f) => f.code === "audio_group_no_members")).toBe(false);
  });

  it("stays quiet for an unmatched bus when another group has local members", async () => {
    const res = await lintHyperframeHtml(
      doc(`<hf-audio-group id="local"></hf-audio-group>
        <audio id="local-1" src="local.wav" data-start="0" data-duration="5" data-audio-group="local"></audio>
        ${BUS}
        <div id="host" data-composition-src="compositions/voices.html" data-start="0" data-duration="10"></div>`),
    );
    expect(res.findings.some((f) => f.code === "audio_group_no_members")).toBe(false);
  });

  it("stays quiet for a bus with no id", async () => {
    const res = await lintHyperframeHtml(
      doc(`<hf-audio-group data-label="Nameless"></hf-audio-group>
        <audio id="s-1" src="s.wav" data-start="0" data-duration="2" data-audio-group="sfx"></audio>`),
    );
    expect(res.findings.some((f) => f.code === "audio_group_no_members")).toBe(false);
  });
});

describe("audio_group_timing_attrs", () => {
  const doc = (busAttrs: string) => `<!DOCTYPE html><html><body>
    <div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="10">
      <hf-audio-group id="voiceover" data-label="Voiceover" ${busAttrs}></hf-audio-group>
      <audio id="vo-1" src="vo.wav" data-start="0" data-duration="5" data-audio-group="voiceover"></audio>
    </div>
  </body></html>`;

  it("warns on data-start", async () => {
    const res = await lintHyperframeHtml(doc(`data-start="0" data-duration="40"`));
    const finding = res.findings.find((f) => f.code === "audio_group_timing_attrs");
    expect(finding?.severity).toBe("warning");
    expect(finding?.elementId).toBe("voiceover");
    expect(finding?.message).toContain("data-start");
    expect(finding?.message).toContain("data-duration");
  });

  it("warns on data-track-index", async () => {
    const res = await lintHyperframeHtml(doc(`data-track-index="7"`));
    expect(res.findings.some((f) => f.code === "audio_group_timing_attrs")).toBe(true);
  });

  it("stays quiet on a bus carrying only its own attributes", async () => {
    const res = await lintHyperframeHtml(doc(`data-volume="0.4" data-hidden`));
    expect(res.findings.some((f) => f.code === "audio_group_timing_attrs")).toBe(false);
  });
});

describe("audio_group_carve_attr", () => {
  const doc = (busAttrs: string) => `<!DOCTYPE html><html><body>
    <div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="10">
      <hf-audio-group id="music" data-label="Music bed" ${busAttrs}></hf-audio-group>
      <audio id="bgm" src="bgm.mp3" data-start="0" data-duration="10" data-audio-group="music"></audio>
    </div>
  </body></html>`;

  // The observed bug: the bus and its one member each carried a carve against
  // the same voiceover, so the bed ran through both sets of filters.
  it("warns on a carve written onto a bus", async () => {
    const res = await lintHyperframeHtml(
      doc(`data-fx-carve='{"enabled":true,"sources":["voiceover"],"strength":0.25}'`),
    );
    const finding = res.findings.find((f) => f.code === "audio_group_carve_attr");
    expect(finding?.severity).toBe("warning");
    expect(finding?.elementId).toBe("music");
    expect(finding?.message).toContain("data-fx-carve");
  });

  it("stays quiet on a bus carrying only its own attributes", async () => {
    const res = await lintHyperframeHtml(doc(`data-volume="0.4"`));
    expect(res.findings.some((f) => f.code === "audio_group_carve_attr")).toBe(false);
  });

  it("leaves a carve on the clip alone", async () => {
    const res = await lintHyperframeHtml(`<!DOCTYPE html><html><body>
      <div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="10">
        <hf-audio-group id="music" data-label="Music bed"></hf-audio-group>
        <audio id="bgm" src="bgm.mp3" data-start="0" data-duration="10" data-audio-group="music"
          data-fx-carve='{"enabled":true,"sources":["voiceover"],"strength":0.25}'></audio>
      </div>
    </body></html>`);
    expect(res.findings.some((f) => f.code === "audio_group_carve_attr")).toBe(false);
  });
});

describe("audio_carve_ungrouped_sources", () => {
  const withCarve = (carveJson: string, extra = "") => `<!DOCTYPE html><html><body>
    <div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="10">
      <audio id="bed" src="bed.wav" data-start="0" data-duration="10" data-fx-carve='${carveJson}'></audio>
      ${extra}
    </div>
  </body></html>`;

  it("warns when sources names two or more plain clip ids", async () => {
    const res = await lintHyperframeHtml(
      withCarve(`{"enabled":true,"sources":["vo-1","vo-2"],"strength":0.35}`),
    );
    const finding = res.findings.find((f) => f.code === "audio_carve_ungrouped_sources");
    expect(finding?.severity).toBe("warning");
    expect(finding?.elementId).toBe("bed");
  });

  it("stays quiet when sources names a group", async () => {
    const res = await lintHyperframeHtml(
      withCarve(
        `{"enabled":true,"sources":["voiceover"],"strength":0.35}`,
        `<hf-audio-group id="voiceover" data-label="Voiceover"></hf-audio-group>`,
      ),
    );
    expect(res.findings.some((f) => f.code === "audio_carve_ungrouped_sources")).toBe(false);
  });

  it("stays quiet for a single-clip sources list", async () => {
    const res = await lintHyperframeHtml(
      withCarve(`{"enabled":true,"sources":["narration"],"strength":0.35}`),
    );
    expect(res.findings.some((f) => f.code === "audio_carve_ungrouped_sources")).toBe(false);
  });

  it("still warns when one entry is a group and the rest are plain clip ids", async () => {
    // Mixing a group with two more bare clip ids is still an ungrouped-source
    // rot risk for those two clips — only fully-grouped sources are silent.
    const res = await lintHyperframeHtml(
      withCarve(
        `{"enabled":true,"sources":["voiceover","vo-3","vo-4"],"strength":0.35}`,
        `<hf-audio-group id="voiceover" data-label="Voiceover"></hf-audio-group>`,
      ),
    );
    const finding = res.findings.find((f) => f.code === "audio_carve_ungrouped_sources");
    expect(finding?.severity).toBe("warning");
  });
});
