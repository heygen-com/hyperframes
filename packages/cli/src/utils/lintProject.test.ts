import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { HyperframeLintFinding } from "@hyperframes/core/lint";
import { lintProject, shouldBlockRender } from "./lintProject.js";

function tmpProject(name: string): string {
  return mkdtempSync(join(tmpdir(), `hf-test-${name}-`));
}

function validHtml(compId = "main"): string {
  return `<html><body>
  <div data-composition-id="${compId}" data-width="1920" data-height="1080" data-start="0" data-duration="10"></div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["${compId}"] = gsap.timeline({ paused: true });</script>
</body></html>`;
}

function htmlWithMissingMediaId(): string {
  return `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <audio data-start="0" data-duration="10" src="narration.wav"></audio>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
}

function htmlWithPreloadNone(): string {
  return `<html><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <video id="v1" data-start="0" data-duration="10" src="clip.mp4" muted playsinline preload="none"></video>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["captions"] = gsap.timeline({ paused: true });</script>
</body></html>`;
}

let dirs: string[] = [];

function makeProject(indexHtml: string, subComps?: Record<string, string>): string {
  const dir = tmpProject("lint");
  dirs.push(dir);
  writeFileSync(join(dir, "index.html"), indexHtml);
  if (subComps) {
    const compsDir = join(dir, "compositions");
    mkdirSync(compsDir, { recursive: true });
    for (const [name, html] of Object.entries(subComps)) {
      writeFileSync(join(compsDir, name), html);
    }
  }
  return dir;
}

afterEach(() => {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
  }
  dirs = [];
});

describe("lintProject", () => {
  it("returns zero errors/warnings for a clean project", async () => {
    const project = makeProject(validHtml());
    const { totalErrors, totalWarnings, results } = await lintProject(project);

    expect(totalErrors).toBe(0);
    expect(totalWarnings).toBe(0);
    expect(results).toHaveLength(1);
    const first = results[0];
    expect(first).toBeDefined();
    expect(first?.file).toBe("index.html");
  });

  it("detects errors in index.html", async () => {
    const project = makeProject(htmlWithMissingMediaId());
    const { totalErrors, results } = await lintProject(project);

    expect(totalErrors).toBeGreaterThan(0);
    const first = results[0];
    expect(first).toBeDefined();
    const mediaFinding = first?.result.findings.find((f) => f.code === "media_missing_id");
    expect(mediaFinding).toBeDefined();
  });

  it("recurses into compositions/frames/ and flags a CSS↔GSAP transform conflict there", async () => {
    // End-to-end guard: a per-frame composition under compositions/frames/ that
    // seats centering via a standalone gsap.set on a grouped #root-scoped selector
    // against a CSS class transform — the exact shape that shipped off-centre.
    // Both the recursive discovery and the strengthened rule must fire.
    const dir = tmpProject("lint-frames");
    dirs.push(dir);
    writeFileSync(join(dir, "index.html"), validHtml());
    const framesDir = join(dir, "compositions", "frames");
    mkdirSync(framesDir, { recursive: true });
    const frameHtml = `<template data-composition-id="04-mechanism">
  <div id="m04-root" data-width="1920" data-height="1080">
    <div class="m04-label">edit op</div>
  </div>
  <style> .m04-label { position: absolute; left: 960px; transform: translateX(-50%); } </style>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    gsap.set("#m04-root .m04-label", { xPercent: -50 });
    tl.to(".m04-label", { y: 0, opacity: 1, duration: 0.4 }, 0.5);
    window.__timelines["04-mechanism"] = tl;
  </script>
</template>`;
    writeFileSync(join(framesDir, "04-mechanism.html"), frameHtml);

    const { results } = await lintProject(dir);

    const frameResult = results.find((r) => r.file === "compositions/frames/04-mechanism.html");
    expect(frameResult).toBeDefined();
    const conflict = frameResult?.result.findings.find(
      (f) => f.code === "gsap_css_transform_conflict",
    );
    expect(conflict).toBeDefined();
  });

  it("lints sub-compositions in compositions/ directory", async () => {
    const project = makeProject(validHtml(), {
      "captions.html": htmlWithMissingMediaId(),
    });
    const { totalErrors, results } = await lintProject(project);

    expect(results).toHaveLength(2);
    const second = results[1];
    expect(second).toBeDefined();
    expect(second?.file).toBe("compositions/captions.html");
    expect(totalErrors).toBeGreaterThan(0);
    const subFindings = second?.result.findings ?? [];
    expect(subFindings.some((f) => f.code === "media_missing_id")).toBe(true);
  });

  it("lints linked CSS next to sub-compositions", async () => {
    const project = makeProject(validHtml(), {
      "scene.html": `<html><head><link rel="stylesheet" href="scene.css"></head><body>
  <div id="scene" data-composition-id="scene" data-width="1920" data-height="1080" data-start="0" data-duration="2"></div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["scene"] = gsap.timeline({ paused: true });</script>
</body></html>`,
    });
    writeFileSync(
      join(project, "compositions", "scene.css"),
      '[data-composition-id="scene"] .title { opacity: 0; }',
    );

    const { results } = await lintProject(project);
    const subResult = results.find((result) => result.file === "compositions/scene.html");
    const finding = subResult?.result.findings.find(
      (item) => item.code === "composition_self_attribute_selector",
    );

    expect(finding).toBeDefined();
    expect(finding?.selector).toBe('[data-composition-id="scene"] .title');
  });

  it("lints percent-encoded linked CSS filenames that exist decoded on disk", async () => {
    const encodedFilename = "%E6%97%A5%E6%9C%AC%E8%AA%9E.css";
    const project = makeProject(validHtml(), {
      "scene.html": `<html><head><link rel="stylesheet" href="${encodedFilename}"></head><body>
  <div id="scene" data-composition-id="scene" data-width="1920" data-height="1080" data-start="0" data-duration="2"></div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["scene"] = gsap.timeline({ paused: true });</script>
</body></html>`,
    });
    writeFileSync(
      join(project, "compositions", decodeURIComponent(encodedFilename)),
      '[data-composition-id="scene"] .title { opacity: 0; }',
    );

    const { results } = await lintProject(project);
    const subResult = results.find((result) => result.file === "compositions/scene.html");
    const finding = subResult?.result.findings.find(
      (item) => item.code === "composition_self_attribute_selector",
    );

    expect(finding).toBeDefined();
    expect(finding?.selector).toBe('[data-composition-id="scene"] .title');
  });

  it("aggregates errors across index.html and sub-compositions", async () => {
    const project = makeProject(htmlWithMissingMediaId(), {
      "overlay.html": htmlWithMissingMediaId(),
    });
    const { totalErrors, results } = await lintProject(project);

    expect(results).toHaveLength(2);
    const first = results[0];
    const second = results[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // Both files have media_missing_id errors
    const rootErrors = first?.result.errorCount ?? 0;
    const subErrors = second?.result.errorCount ?? 0;
    expect(totalErrors).toBe(rootErrors + subErrors);
  });

  it("aggregates warnings from sub-compositions", async () => {
    const project = makeProject(validHtml(), {
      "captions.html": htmlWithPreloadNone(),
    });
    const { totalWarnings, results } = await lintProject(project);

    expect(results).toHaveLength(2);
    expect(totalWarnings).toBeGreaterThan(0);
    const second = results[1];
    expect(second).toBeDefined();
    const preloadWarning = second?.result.findings.find((f) => f.code === "media_preload_none");
    expect(preloadWarning).toBeDefined();
  });

  it("handles project with no compositions/ directory", async () => {
    const project = makeProject(validHtml());
    // No compositions/ dir created
    const { results } = await lintProject(project);

    expect(results).toHaveLength(1);
  });

  it("ignores non-HTML files in compositions/", async () => {
    const project = makeProject(validHtml(), {
      "captions.html": validHtml("captions"),
    });
    // Add a non-HTML file
    writeFileSync(join(project, "compositions", "readme.txt"), "not html");

    const { results } = await lintProject(project);

    expect(results).toHaveLength(2); // index.html + captions.html, not readme.txt
  });
});

function validHtmlWithAudio(compId = "main"): string {
  return `<html><body>
  <div data-composition-id="${compId}" data-width="1920" data-height="1080">
    <audio id="music" src="song.mp3" data-start="0" data-track-index="0" data-volume="1"></audio>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["${compId}"] = gsap.timeline({ paused: true });</script>
</body></html>`;
}

function validHtmlWithAudioSrc(src: string): string {
  return `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <audio id="music" src="${src}" data-start="0" data-track-index="0" data-volume="1"></audio>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
}

function validHtmlWithMaskImageUrl(url: string): string {
  return `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <div class="hf-texture-text hf-texture-lava">TEXT</div>
  </div>
  <style>
    .hf-texture-lava {
      mask-image: url("${url}");
    }
  </style>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
}

describe("audio_file_without_element", () => {
  it("warns when audio file exists but no <audio> element", async () => {
    const project = makeProject(validHtml());
    writeFileSync(join(project, "music.mp3"), "fake");

    const { totalWarnings, results } = await lintProject(project);

    expect(totalWarnings).toBeGreaterThan(0);
    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_file_without_element");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("music.mp3");
  });

  it("does not warn when audio file exists and <audio> element is present", async () => {
    const project = makeProject(validHtmlWithAudio());
    writeFileSync(join(project, "song.mp3"), "fake");

    const { results } = await lintProject(project);

    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_file_without_element");
    expect(finding).toBeUndefined();
  });

  it("does not warn when no audio files exist", async () => {
    const project = makeProject(validHtml());

    const { results } = await lintProject(project);

    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_file_without_element");
    expect(finding).toBeUndefined();
  });

  it("detects multiple audio file extensions", async () => {
    const project = makeProject(validHtml());
    writeFileSync(join(project, "narration.wav"), "fake");
    writeFileSync(join(project, "bgm.ogg"), "fake");

    const { results } = await lintProject(project);

    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_file_without_element");
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("narration.wav");
    expect(finding?.message).toContain("bgm.ogg");
  });

  it("does not warn when <audio> element is in a sub-composition", async () => {
    const project = makeProject(validHtml(), {
      "captions.html": validHtmlWithAudio("captions"),
    });
    writeFileSync(join(project, "song.mp3"), "fake");

    const { results } = await lintProject(project);

    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_file_without_element");
    expect(finding).toBeUndefined();
  });
});

describe("audio_src_not_found", () => {
  it("errors when <audio> src references a file that does not exist", async () => {
    const project = makeProject(validHtmlWithAudio());
    // song.mp3 is referenced in validHtmlWithAudio but not on disk

    const { totalErrors, results } = await lintProject(project);

    expect(totalErrors).toBeGreaterThan(0);
    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_src_not_found");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("song.mp3");
  });

  it("does not error when <audio> src file exists", async () => {
    const project = makeProject(validHtmlWithAudio());
    writeFileSync(join(project, "song.mp3"), "fake");

    const { results } = await lintProject(project);

    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_src_not_found");
    expect(finding).toBeUndefined();
  });

  it("does not error when <audio> src is an HTTP URL", async () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <audio id="music" src="https://cdn.example.com/song.mp3" data-start="0" data-track-index="0" data-volume="1"></audio>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);

    const { results } = await lintProject(project);

    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_src_not_found");
    expect(finding).toBeUndefined();
  });

  it("detects missing src in sub-compositions", async () => {
    const project = makeProject(validHtml(), {
      "captions.html": validHtmlWithAudio("captions"),
    });
    // song.mp3 referenced in sub-comp but not on disk

    const { totalErrors, results } = await lintProject(project);

    expect(totalErrors).toBeGreaterThan(0);
    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_src_not_found");
    expect(finding).toBeDefined();
  });

  it("resolves relative paths from project root", async () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <audio id="music" src="assets/bgm.mp3" data-start="0" data-track-index="0" data-volume="1"></audio>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);
    mkdirSync(join(project, "assets"), { recursive: true });
    writeFileSync(join(project, "assets", "bgm.mp3"), "fake");

    const { results } = await lintProject(project);

    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_src_not_found");
    expect(finding).toBeUndefined();
  });

  it("does not error for percent-encoded non-Latin filenames that exist on disk", async () => {
    const encodedFilename =
      "%D9%87%D9%86%D8%A7%20%D9%85%D8%B1%D9%88%D8%A7%20-%20%D9%85%D8%A8%D8%A7%D8%B1%D9%83.mp4";
    const project = makeProject(validHtmlWithAudioSrc(`assets/${encodedFilename}`));
    mkdirSync(join(project, "assets"), { recursive: true });
    writeFileSync(join(project, "assets", decodeURIComponent(encodedFilename)), "fake");

    const { results } = await lintProject(project);

    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_src_not_found");
    expect(finding).toBeUndefined();
  });

  it("does not error for malformed percent sequences that are literal filenames", async () => {
    const filename = "100%-discount.mp4";
    const project = makeProject(validHtmlWithAudioSrc(`assets/${filename}`));
    mkdirSync(join(project, "assets"), { recursive: true });
    writeFileSync(join(project, "assets", filename), "fake");

    const { results } = await lintProject(project);

    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_src_not_found");
    expect(finding).toBeUndefined();
  });

  it("does not treat decoded traversal as an existing file outside the project", async () => {
    const project = makeProject(
      validHtmlWithAudioSrc("assets/foo/%2E%2E/%2E%2E/%2E%2E/etc/passwd"),
    );

    const { results } = await lintProject(project);

    const finding = results[0]?.result.findings.find((f) => f.code === "audio_src_not_found");
    expect(finding).toBeDefined();
  });

  it("deduplicates missing files across compositions", async () => {
    const project = makeProject(validHtmlWithAudio(), {
      "captions.html": validHtmlWithAudio("captions"),
    });
    // Both reference song.mp3 which doesn't exist

    const { results } = await lintProject(project);

    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_src_not_found");
    expect(finding).toBeDefined();
    // Should mention song.mp3 only once despite two references
    const occurrences = (finding?.message.match(/song\.mp3/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it("resolves sub-composition src relative to the sub-composition file (../assets/...)", async () => {
    // A sub-composition at compositions/captions.html referencing
    // ../assets/bgm.mp3 means {projectRoot}/assets/bgm.mp3 — the bundler
    // rewrites that path before serving, so the lint check has to mirror it.
    const subComp = `<html><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <audio id="music" src="../assets/bgm.mp3" data-start="0" data-track-index="0" data-volume="1"></audio>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["captions"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(validHtml(), { "captions.html": subComp });
    mkdirSync(join(project, "assets"), { recursive: true });
    writeFileSync(join(project, "assets", "bgm.mp3"), "fake");

    const { results } = await lintProject(project);

    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_src_not_found");
    expect(finding).toBeUndefined();
  });

  it("flags sub-composition src that resolves to a missing file via ../", async () => {
    const subComp = `<html><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <audio id="music" src="../assets/missing.mp3" data-start="0" data-track-index="0" data-volume="1"></audio>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["captions"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(validHtml(), { "captions.html": subComp });
    // No assets/ directory at all.

    const { results } = await lintProject(project);

    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_src_not_found");
    expect(finding).toBeDefined();
    // The original (un-rewritten) src is what surfaces in the message so the
    // author can grep for it in their HTML.
    expect(finding?.message).toContain("../assets/missing.mp3");
  });
});

describe("missing_local_asset", () => {
  it("errors when <img> src references a file that does not exist", async () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <img src="capture/assets/hero.png" />
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);

    const { totalErrors, results } = await lintProject(project);

    expect(totalErrors).toBeGreaterThan(0);
    const finding = results[0]?.result.findings.find((f) => f.code === "missing_local_asset");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("hero.png");
    expect(finding?.message).toContain("<img>");
  });

  it("errors when <video> src references a missing file", async () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <video id="hero" src="capture/assets/videos/clip.mp4" muted playsinline></video>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);

    const { totalErrors, results } = await lintProject(project);

    expect(totalErrors).toBeGreaterThan(0);
    const finding = results[0]?.result.findings.find((f) => f.code === "missing_local_asset");
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("clip.mp4");
    expect(finding?.message).toContain("<video>");
  });

  it("errors when <source> src inside <video> references a missing file", async () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <video muted playsinline><source src="capture/assets/videos/clip.webm" /></video>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);

    const { totalErrors, results } = await lintProject(project);

    expect(totalErrors).toBeGreaterThan(0);
    const finding = results[0]?.result.findings.find((f) => f.code === "missing_local_asset");
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("clip.webm");
    expect(finding?.message).toContain("<source>");
  });

  it("does NOT report <audio> srcs (handled by audio_src_not_found)", async () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <audio id="vo" src="missing.mp3" data-start="0" data-duration="3" data-track-index="0" data-volume="1"></audio>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);

    const { results } = await lintProject(project);

    const localAsset = results[0]?.result.findings.find((f) => f.code === "missing_local_asset");
    const audio = results[0]?.result.findings.find((f) => f.code === "audio_src_not_found");
    expect(localAsset).toBeUndefined();
    expect(audio).toBeDefined();
  });

  it("does NOT report remote URLs (https:, data:, blob:)", async () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <img src="https://example.com/x.png" />
    <img src="data:image/png;base64,iVBOR" />
    <img src="blob:foo" />
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);

    const { results } = await lintProject(project);

    const finding = results[0]?.result.findings.find((f) => f.code === "missing_local_asset");
    expect(finding).toBeUndefined();
  });

  it("does NOT report template placeholders (__VIDEO_SRC__)", async () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <video src="__VIDEO_SRC__"></video>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);

    const { results } = await lintProject(project);

    const finding = results[0]?.result.findings.find((f) => f.code === "missing_local_asset");
    expect(finding).toBeUndefined();
  });

  it("does not error when referenced files exist on disk", async () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <img src="hero.png" />
    <video src="clip.mp4"></video>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);
    writeFileSync(join(project, "hero.png"), "fake");
    writeFileSync(join(project, "clip.mp4"), "fake");

    const { results } = await lintProject(project);

    const finding = results[0]?.result.findings.find((f) => f.code === "missing_local_asset");
    expect(finding).toBeUndefined();
  });

  it("resolves sub-composition relative paths (../assets/foo.png)", async () => {
    const subComp = `<html><body>
  <div data-composition-id="scene" data-width="1920" data-height="1080">
    <img src="../assets/foo.png" />
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["scene"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(validHtml(), { "scene.html": subComp });
    mkdirSync(join(project, "assets"), { recursive: true });
    writeFileSync(join(project, "assets", "foo.png"), "fake");

    const { results } = await lintProject(project);

    const finding = results[0]?.result.findings.find((f) => f.code === "missing_local_asset");
    expect(finding).toBeUndefined();
  });

  it("deduplicates the same missing src across multiple compositions", async () => {
    const project = makeProject(
      `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <img src="capture/assets/x.png" />
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`,
      {
        "scene-a.html": `<html><body>
  <div data-composition-id="a" data-width="1920" data-height="1080">
    <img src="../capture/assets/x.png" />
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["a"] = gsap.timeline({ paused: true });</script>
</body></html>`,
        "scene-b.html": `<html><body>
  <div data-composition-id="b" data-width="1920" data-height="1080">
    <img src="../capture/assets/x.png" />
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["b"] = gsap.timeline({ paused: true });</script>
</body></html>`,
      },
    );

    const { results } = await lintProject(project);

    const finding = results[0]?.result.findings.find((f) => f.code === "missing_local_asset");
    expect(finding).toBeDefined();
    // x.png mentioned only once despite three references
    const occurrences = (finding?.message.match(/x\.png/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it("emits separate findings per tag type (img + video) for clear messaging", async () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <img src="missing.png" />
    <video src="missing.mp4"></video>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);

    const { results } = await lintProject(project);

    const findings = results[0]?.result.findings.filter((f) => f.code === "missing_local_asset");
    expect(findings).toHaveLength(2);
    expect(findings?.some((f) => f.message.includes("<img>"))).toBe(true);
    expect(findings?.some((f) => f.message.includes("<video>"))).toBe(true);
  });

  it("does not flag <img>/<video> tokens inside <!-- -->, <style>, or <script>", async () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <!-- example: <img src="commented.png"> -->
    <style>/* card uses <video src="styled.mp4"> as the surface */ .card { background: black; }</style>
    <script>const example = '<source src="scripted.webm">';</script>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);

    const { results } = await lintProject(project);

    const findings = results[0]?.result.findings.filter((f) => f.code === "missing_local_asset");
    expect(findings).toEqual([]);
  });
});

describe("texture_mask_asset_not_found", () => {
  it("errors when CSS mask-image references a missing local texture", async () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <div class="hf-texture-text hf-texture-lava">TEXT</div>
  </div>
  <style>
    .hf-texture-lava {
      -webkit-mask-image: url("masks/lava.png");
      mask-image: url("masks/lava.png");
    }
  </style>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);

    const { totalErrors, results } = await lintProject(project);
    const finding = results[0]?.result.findings.find(
      (item) => item.code === "texture_mask_asset_not_found",
    );

    expect(totalErrors).toBeGreaterThan(0);
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("masks/lava.png");
  });

  it("does not error when the referenced texture mask exists", async () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <div class="hf-texture-text hf-texture-lava">TEXT</div>
  </div>
  <style>
    .hf-texture-lava {
      -webkit-mask-image: url("masks/lava.png");
      mask-image: url("masks/lava.png");
    }
  </style>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);
    mkdirSync(join(project, "masks"), { recursive: true });
    writeFileSync(join(project, "masks", "lava.png"), "fake");

    const { results } = await lintProject(project);
    const finding = results[0]?.result.findings.find(
      (item) => item.code === "texture_mask_asset_not_found",
    );

    expect(finding).toBeUndefined();
  });

  it("resolves mask-image URLs inside linked sub-composition stylesheets", async () => {
    const project = makeProject(validHtml(), {
      "scene.html": `<html><head><link rel="stylesheet" href="scene.css"></head><body>
  <div data-composition-id="scene" data-width="1920" data-height="1080">
    <div class="hf-texture-text hf-texture-lava">TEXT</div>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["scene"] = gsap.timeline({ paused: true });</script>
</body></html>`,
    });
    writeFileSync(
      join(project, "compositions", "scene.css"),
      '.hf-texture-lava { mask-image: url("masks/lava.png"); }',
    );
    mkdirSync(join(project, "compositions", "masks"), { recursive: true });
    writeFileSync(join(project, "compositions", "masks", "lava.png"), "fake");

    const { results } = await lintProject(project);
    const finding = results[0]?.result.findings.find(
      (item) => item.code === "texture_mask_asset_not_found",
    );

    expect(finding).toBeUndefined();
  });

  it("checks mask-image URLs inside percent-encoded linked CSS filenames", async () => {
    const encodedFilename = "%E6%97%A5%E6%9C%AC%E8%AA%9E.css";
    const project = makeProject(validHtml(), {
      "scene.html": `<html><head><link rel="stylesheet" href="${encodedFilename}"></head><body>
  <div data-composition-id="scene" data-width="1920" data-height="1080">
    <div class="hf-texture-text hf-texture-lava">TEXT</div>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["scene"] = gsap.timeline({ paused: true });</script>
</body></html>`,
    });
    writeFileSync(
      join(project, "compositions", decodeURIComponent(encodedFilename)),
      '.hf-texture-lava { mask-image: url("masks/missing.png"); }',
    );

    const { results } = await lintProject(project);
    const finding = results[0]?.result.findings.find(
      (item) => item.code === "texture_mask_asset_not_found",
    );

    expect(finding).toBeDefined();
    expect(finding?.message).toContain("masks/missing.png");
  });

  it("resolves root-absolute mask-image URLs from the project root", async () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <div class="hf-texture-text hf-texture-lava">TEXT</div>
  </div>
  <style>
    .hf-texture-lava {
      -webkit-mask-image: url("/assets/texture-mask-text/masks/lava.png");
      mask-image: url("/assets/texture-mask-text/masks/lava.png");
    }
  </style>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);
    mkdirSync(join(project, "assets", "texture-mask-text", "masks"), {
      recursive: true,
    });
    writeFileSync(join(project, "assets", "texture-mask-text", "masks", "lava.png"), "fake");

    const { results } = await lintProject(project);
    const finding = results[0]?.result.findings.find(
      (item) => item.code === "texture_mask_asset_not_found",
    );

    expect(finding).toBeUndefined();
  });

  it("does not error for percent-encoded non-Latin mask filenames that exist on disk", async () => {
    const encodedFilename = "%E6%97%A5%E6%9C%AC%E8%AA%9E.png";
    const project = makeProject(validHtmlWithMaskImageUrl(`assets/${encodedFilename}`));
    mkdirSync(join(project, "assets"), { recursive: true });
    writeFileSync(join(project, "assets", decodeURIComponent(encodedFilename)), "fake");

    const { results } = await lintProject(project);
    const finding = results[0]?.result.findings.find(
      (item) => item.code === "texture_mask_asset_not_found",
    );

    expect(finding).toBeUndefined();
  });

  it("does not treat decoded mask traversal as an existing file outside the project", async () => {
    const project = makeProject(
      validHtmlWithMaskImageUrl("assets/foo/%2E%2E/%2E%2E/%2E%2E/etc/passwd"),
    );

    const { results } = await lintProject(project);
    const finding = results[0]?.result.findings.find(
      (item) => item.code === "texture_mask_asset_not_found",
    );

    expect(finding).toBeDefined();
  });
});

describe("multiple_root_compositions", () => {
  it("fires when two HTML files have data-composition-id", async () => {
    const project = makeProject(validHtml());
    writeFileSync(
      join(project, "scaffold.html"),
      '<div data-composition-id="scaffold" data-width="1920" data-height="1080" data-duration="10"></div>',
    );
    const { totalErrors, results } = await lintProject(project);
    const finding = results[0]?.result.findings.find(
      (f) => f.code === "multiple_root_compositions",
    );
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("scaffold.html");
    expect(totalErrors).toBeGreaterThan(0);
  });

  it("does NOT fire with a single root composition", async () => {
    const project = makeProject(validHtml());
    const { results } = await lintProject(project);
    const finding = results[0]?.result.findings.find(
      (f) => f.code === "multiple_root_compositions",
    );
    expect(finding).toBeUndefined();
  });

  it("ignores root-level caption-skin.html source files", async () => {
    const project = makeProject(validHtml());
    writeFileSync(
      join(project, "caption-skin.html"),
      '<div data-composition-id="captions" data-width="0" data-height="0"></div>',
    );
    const { results } = await lintProject(project);
    const finding = results[0]?.result.findings.find(
      (f) => f.code === "multiple_root_compositions",
    );
    expect(finding).toBeUndefined();
  });

  it("ignores macOS AppleDouble HTML metadata files", async () => {
    const project = makeProject(validHtml());
    writeFileSync(join(project, "._index.html"), validHtml());
    mkdirSync(join(project, "compositions"), { recursive: true });
    writeFileSync(join(project, "compositions", "._scene.html"), validHtml("scene"));
    const { results } = await lintProject(project);
    const finding = results[0]?.result.findings.find(
      (f) => f.code === "multiple_root_compositions",
    );
    expect(finding).toBeUndefined();
    expect(results.some((result) => result.file.includes("._"))).toBe(false);
  });

  it("ignores HTML files without data-composition-id", async () => {
    const project = makeProject(validHtml());
    writeFileSync(join(project, "readme.html"), "<html><body>Not a composition</body></html>");
    const { results } = await lintProject(project);
    const finding = results[0]?.result.findings.find(
      (f) => f.code === "multiple_root_compositions",
    );
    expect(finding).toBeUndefined();
  });
});

describe("duplicate_audio_track", () => {
  it("detects overlapping audio with attributes in any order", async () => {
    // The original scaffold bug: data-start BEFORE data-track-index
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-duration="30">
    <audio id="narration" data-start="0" data-duration="28" data-track-index="0" src="narration.wav">
    <audio id="bg" src="bg.wav" data-track-index="0" data-start="5" data-duration="20">
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);
    const { results } = await lintProject(project);
    const finding = results[0]?.result.findings.find((f) => f.code === "duplicate_audio_track");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
  });

  it("does NOT fire for non-overlapping audio on the same track", async () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-duration="20">
    <audio id="a" src="a.wav" data-track-index="0" data-start="0" data-duration="10">
    <audio id="b" src="b.wav" data-track-index="0" data-start="10" data-duration="10">
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);
    const { results } = await lintProject(project);
    const finding = results[0]?.result.findings.find((f) => f.code === "duplicate_audio_track");
    expect(finding).toBeUndefined();
  });

  it("does NOT fire for audio on different tracks", async () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-duration="20">
    <audio id="a" src="a.wav" data-track-index="0" data-start="0" data-duration="20">
    <audio id="b" src="b.wav" data-track-index="1" data-start="5" data-duration="10">
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);
    const { results } = await lintProject(project);
    const finding = results[0]?.result.findings.find((f) => f.code === "duplicate_audio_track");
    expect(finding).toBeUndefined();
  });

  it("deduplicates same audio found in root + sub-composition", async () => {
    const project = makeProject(validHtmlWithAudio(), {
      "scene.html": validHtmlWithAudio("scene"),
    });
    writeFileSync(join(project, "song.mp3"), "fake");
    const { results } = await lintProject(project);
    const finding = results[0]?.result.findings.find((f) => f.code === "duplicate_audio_track");
    expect(finding).toBeUndefined();
  });

  it("detects overlap when data-duration is missing (Infinity fallback)", async () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-duration="30">
    <audio id="a" src="a.wav" data-track-index="0" data-start="0" data-duration="20">
    <audio id="b" src="b.wav" data-track-index="0" data-start="15">
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);
    const { results } = await lintProject(project);
    const finding = results[0]?.result.findings.find((f) => f.code === "duplicate_audio_track");
    expect(finding).toBeDefined();
  });

  it("formats Infinity end times as 'end' without crashing", async () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-duration="30">
    <audio id="a" src="a.wav" data-track-index="0" data-start="0">
    <audio id="b" src="b.wav" data-track-index="0" data-start="5">
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);
    const { results } = await lintProject(project);
    const finding = results[0]?.result.findings.find((f) => f.code === "duplicate_audio_track");
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("end");
    expect(finding?.message).not.toContain("Infinity");
  });

  it("finds audio across multiple HTML sources (g-flag regression)", async () => {
    const project = makeProject(validHtmlWithAudio(), {
      "scene.html": `<html><body>
  <div data-composition-id="scene" data-width="1920" data-height="1080">
    <audio id="overlap" src="music.wav" data-track-index="0" data-start="5" data-duration="20">
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["scene"] = gsap.timeline({ paused: true });</script>
</body></html>`,
    });
    writeFileSync(join(project, "song.mp3"), "fake");
    writeFileSync(join(project, "music.wav"), "fake");
    const { results } = await lintProject(project);
    const finding = results[0]?.result.findings.find((f) => f.code === "duplicate_audio_track");
    // song.mp3@0 (from validHtmlWithAudio, no data-duration → Infinity) and music.wav@5-25 overlap
    expect(finding).toBeDefined();
  });
});

describe("missing_or_empty_sub_composition", () => {
  function htmlWithSubComp(srcPath: string): string {
    return `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10">
    <div data-composition-src="${srcPath}" data-composition-id="scene-title" data-start="0" data-duration="5"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
  }

  function validSubCompHtml(): string {
    return `<!doctype html><html><body>
  <div data-composition-id="scene-title" data-width="1920" data-height="1080">
    <div class="title">Hello</div>
  </div>
</body></html>`;
  }

  // Shared assertion: lint a project referencing "compositions/scene-title.html"
  // (or a custom srcPath) and return the missing_or_empty_sub_composition
  // finding, if any, plus the raw lint result for callers that need totalErrors.
  async function lintSubComp(
    srcPath: string,
    subCompFiles?: Record<string, string>,
  ): Promise<{ finding: HyperframeLintFinding | undefined; totalErrors: number }> {
    const project = makeProject(htmlWithSubComp(srcPath), subCompFiles);
    const { totalErrors, results } = await lintProject(project);
    const finding = results
      .flatMap((r) => r.result.findings)
      .find((f) => f.code === "missing_or_empty_sub_composition");
    return { finding, totalErrors };
  }

  it.each([
    {
      label: "empty",
      content: "",
      expectMessageContains: "empty",
    },
    {
      label: "whitespace-only",
      content: "   \n\t  ",
      expectMessageContains: "empty",
    },
    {
      label: "malformed / non-HTML",
      content: "just some plain text, no tags at all",
      expectMessageContains: "could not be parsed",
    },
  ])(
    "errors when the referenced sub-composition file is $label",
    async ({ content, expectMessageContains }) => {
      const { finding, totalErrors } = await lintSubComp("compositions/scene-title.html", {
        "scene-title.html": content,
      });

      expect(totalErrors).toBeGreaterThan(0);
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      expect(finding?.message).toContain(expectMessageContains);
    },
  );

  it("errors when the referenced sub-composition file does not exist", async () => {
    // No subComps passed — compositions/ directory doesn't even exist.
    const { finding, totalErrors } = await lintSubComp("compositions/does-not-exist.html");

    expect(totalErrors).toBeGreaterThan(0);
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("compositions/does-not-exist.html");
    expect(finding?.message).toContain("does not exist");
  });

  it("does not error when the referenced sub-composition file is valid (happy path)", async () => {
    const { finding } = await lintSubComp("compositions/scene-title.html", {
      "scene-title.html": validSubCompHtml(),
    });
    expect(finding).toBeUndefined();
  });

  it("does not error on a project with no data-composition-src references", async () => {
    const project = makeProject(validHtml());
    const { results } = await lintProject(project);
    const finding = results
      .flatMap((r) => r.result.findings)
      .find((f) => f.code === "missing_or_empty_sub_composition");
    expect(finding).toBeUndefined();
  });

  it("dedupes a single bad reference into one finding even if repeated", async () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10">
    <div data-composition-src="compositions/scene-title.html" data-composition-id="a" data-start="0" data-duration="5"></div>
    <div data-composition-src="compositions/scene-title.html" data-composition-id="b" data-start="5" data-duration="5"></div>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html, { "scene-title.html": "" });

    const { results } = await lintProject(project);

    const findings = results
      .flatMap((r) => r.result.findings)
      .filter((f) => f.code === "missing_or_empty_sub_composition");
    expect(findings).toHaveLength(1);
  });
});

describe("shouldBlockRender", () => {
  it("default: does not block on errors", async () => {
    expect(shouldBlockRender(false, false, 5, 0)).toBe(false);
  });

  it("default: does not block on warnings", async () => {
    expect(shouldBlockRender(false, false, 0, 3)).toBe(false);
  });

  it("--strict: blocks on errors", async () => {
    expect(shouldBlockRender(true, false, 1, 0)).toBe(true);
  });

  it("--strict: does not block on warnings only", async () => {
    expect(shouldBlockRender(true, false, 0, 5)).toBe(false);
  });

  it("--strict-all: blocks on errors", async () => {
    expect(shouldBlockRender(true, true, 1, 0)).toBe(true);
  });

  it("--strict-all: blocks on warnings", async () => {
    expect(shouldBlockRender(true, true, 0, 1)).toBe(true);
  });

  it("--strict-all: does not block when clean", async () => {
    expect(shouldBlockRender(true, true, 0, 0)).toBe(false);
  });

  it("--strict-all alone: blocks on errors", async () => {
    expect(shouldBlockRender(false, true, 1, 0)).toBe(true);
  });

  it("--strict-all alone: blocks on warnings", async () => {
    expect(shouldBlockRender(false, true, 0, 1)).toBe(true);
  });
});
