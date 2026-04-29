import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { lintProject, shouldBlockRender } from "./lintProject.js";
import type { ProjectDir } from "./project.js";

function tmpProject(name: string): string {
  const dir = join(tmpdir(), `hf-test-${name}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
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

function makeProject(indexHtml: string, subComps?: Record<string, string>): ProjectDir {
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
  return { dir, name: "test-project", indexPath: join(dir, "index.html") };
}

afterEach(() => {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
  }
  dirs = [];
});

describe("lintProject", () => {
  it("returns zero errors/warnings for a clean project", () => {
    const project = makeProject(validHtml());
    const { totalErrors, totalWarnings, results } = lintProject(project);

    expect(totalErrors).toBe(0);
    expect(totalWarnings).toBe(0);
    expect(results).toHaveLength(1);
    const first = results[0];
    expect(first).toBeDefined();
    expect(first?.file).toBe("index.html");
  });

  it("detects errors in index.html", () => {
    const project = makeProject(htmlWithMissingMediaId());
    const { totalErrors, results } = lintProject(project);

    expect(totalErrors).toBeGreaterThan(0);
    const first = results[0];
    expect(first).toBeDefined();
    const mediaFinding = first?.result.findings.find((f) => f.code === "media_missing_id");
    expect(mediaFinding).toBeDefined();
  });

  it("lints sub-compositions in compositions/ directory", () => {
    const project = makeProject(validHtml(), {
      "captions.html": htmlWithMissingMediaId(),
    });
    const { totalErrors, results } = lintProject(project);

    expect(results).toHaveLength(2);
    const second = results[1];
    expect(second).toBeDefined();
    expect(second?.file).toBe("compositions/captions.html");
    expect(totalErrors).toBeGreaterThan(0);
    const subFindings = second?.result.findings ?? [];
    expect(subFindings.some((f) => f.code === "media_missing_id")).toBe(true);
  });

  it("lints linked CSS next to sub-compositions", () => {
    const project = makeProject(validHtml(), {
      "scene.html": `<html><head><link rel="stylesheet" href="scene.css"></head><body>
  <div id="scene" data-composition-id="scene" data-width="1920" data-height="1080" data-start="0" data-duration="2"></div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["scene"] = gsap.timeline({ paused: true });</script>
</body></html>`,
    });
    writeFileSync(
      join(project.dir, "compositions", "scene.css"),
      '[data-composition-id="scene"] .title { opacity: 0; }',
    );

    const { results } = lintProject(project);
    const subResult = results.find((result) => result.file === "compositions/scene.html");
    const finding = subResult?.result.findings.find(
      (item) => item.code === "composition_self_attribute_selector",
    );

    expect(finding).toBeDefined();
    expect(finding?.selector).toBe('[data-composition-id="scene"] .title');
  });

  it("aggregates errors across index.html and sub-compositions", () => {
    const project = makeProject(htmlWithMissingMediaId(), {
      "overlay.html": htmlWithMissingMediaId(),
    });
    const { totalErrors, results } = lintProject(project);

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

  it("aggregates warnings from sub-compositions", () => {
    const project = makeProject(validHtml(), {
      "captions.html": htmlWithPreloadNone(),
    });
    const { totalWarnings, results } = lintProject(project);

    expect(results).toHaveLength(2);
    expect(totalWarnings).toBeGreaterThan(0);
    const second = results[1];
    expect(second).toBeDefined();
    const preloadWarning = second?.result.findings.find((f) => f.code === "media_preload_none");
    expect(preloadWarning).toBeDefined();
  });

  it("handles project with no compositions/ directory", () => {
    const project = makeProject(validHtml());
    // No compositions/ dir created
    const { results } = lintProject(project);

    expect(results).toHaveLength(1);
  });

  it("ignores non-HTML files in compositions/", () => {
    const project = makeProject(validHtml(), {
      "captions.html": validHtml("captions"),
    });
    // Add a non-HTML file
    writeFileSync(join(project.dir, "compositions", "readme.txt"), "not html");

    const { results } = lintProject(project);

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

describe("audio_file_without_element", () => {
  it("warns when audio file exists but no <audio> element", () => {
    const project = makeProject(validHtml());
    writeFileSync(join(project.dir, "music.mp3"), "fake");

    const { totalWarnings, results } = lintProject(project);

    expect(totalWarnings).toBeGreaterThan(0);
    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_file_without_element");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("music.mp3");
  });

  it("does not warn when audio file exists and <audio> element is present", () => {
    const project = makeProject(validHtmlWithAudio());
    writeFileSync(join(project.dir, "song.mp3"), "fake");

    const { results } = lintProject(project);

    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_file_without_element");
    expect(finding).toBeUndefined();
  });

  it("does not warn when no audio files exist", () => {
    const project = makeProject(validHtml());

    const { results } = lintProject(project);

    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_file_without_element");
    expect(finding).toBeUndefined();
  });

  it("detects multiple audio file extensions", () => {
    const project = makeProject(validHtml());
    writeFileSync(join(project.dir, "narration.wav"), "fake");
    writeFileSync(join(project.dir, "bgm.ogg"), "fake");

    const { results } = lintProject(project);

    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_file_without_element");
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("narration.wav");
    expect(finding?.message).toContain("bgm.ogg");
  });

  it("does not warn when <audio> element is in a sub-composition", () => {
    const project = makeProject(validHtml(), {
      "captions.html": validHtmlWithAudio("captions"),
    });
    writeFileSync(join(project.dir, "song.mp3"), "fake");

    const { results } = lintProject(project);

    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_file_without_element");
    expect(finding).toBeUndefined();
  });
});

describe("audio_src_not_found", () => {
  it("errors when <audio> src references a file that does not exist", () => {
    const project = makeProject(validHtmlWithAudio());
    // song.mp3 is referenced in validHtmlWithAudio but not on disk

    const { totalErrors, results } = lintProject(project);

    expect(totalErrors).toBeGreaterThan(0);
    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_src_not_found");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("song.mp3");
  });

  it("does not error when <audio> src file exists", () => {
    const project = makeProject(validHtmlWithAudio());
    writeFileSync(join(project.dir, "song.mp3"), "fake");

    const { results } = lintProject(project);

    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_src_not_found");
    expect(finding).toBeUndefined();
  });

  it("does not error when <audio> src is an HTTP URL", () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <audio id="music" src="https://cdn.example.com/song.mp3" data-start="0" data-track-index="0" data-volume="1"></audio>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);

    const { results } = lintProject(project);

    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_src_not_found");
    expect(finding).toBeUndefined();
  });

  it("detects missing src in sub-compositions", () => {
    const project = makeProject(validHtml(), {
      "captions.html": validHtmlWithAudio("captions"),
    });
    // song.mp3 referenced in sub-comp but not on disk

    const { totalErrors, results } = lintProject(project);

    expect(totalErrors).toBeGreaterThan(0);
    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_src_not_found");
    expect(finding).toBeDefined();
  });

  it("resolves relative paths from project root", () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <audio id="music" src="assets/bgm.mp3" data-start="0" data-track-index="0" data-volume="1"></audio>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);
    mkdirSync(join(project.dir, "assets"), { recursive: true });
    writeFileSync(join(project.dir, "assets", "bgm.mp3"), "fake");

    const { results } = lintProject(project);

    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_src_not_found");
    expect(finding).toBeUndefined();
  });

  it("deduplicates missing files across compositions", () => {
    const project = makeProject(validHtmlWithAudio(), {
      "captions.html": validHtmlWithAudio("captions"),
    });
    // Both reference song.mp3 which doesn't exist

    const { results } = lintProject(project);

    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_src_not_found");
    expect(finding).toBeDefined();
    // Should mention song.mp3 only once despite two references
    const occurrences = (finding?.message.match(/song\.mp3/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it("resolves sub-composition src relative to the sub-composition file (../assets/...)", () => {
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
    mkdirSync(join(project.dir, "assets"), { recursive: true });
    writeFileSync(join(project.dir, "assets", "bgm.mp3"), "fake");

    const { results } = lintProject(project);

    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_src_not_found");
    expect(finding).toBeUndefined();
  });

  it("flags sub-composition src that resolves to a missing file via ../", () => {
    const subComp = `<html><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <audio id="music" src="../assets/missing.mp3" data-start="0" data-track-index="0" data-volume="1"></audio>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["captions"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(validHtml(), { "captions.html": subComp });
    // No assets/ directory at all.

    const { results } = lintProject(project);

    const first = results[0];
    expect(first).toBeDefined();
    const finding = first?.result.findings.find((f) => f.code === "audio_src_not_found");
    expect(finding).toBeDefined();
    // The original (un-rewritten) src is what surfaces in the message so the
    // author can grep for it in their HTML.
    expect(finding?.message).toContain("../assets/missing.mp3");
  });
});

describe("multiple_root_compositions", () => {
  it("fires when two HTML files have data-composition-id", () => {
    const project = makeProject(validHtml());
    writeFileSync(
      join(project.dir, "scaffold.html"),
      '<div data-composition-id="scaffold" data-width="1920" data-height="1080" data-duration="10"></div>',
    );
    const { totalErrors, results } = lintProject(project);
    const finding = results[0]?.result.findings.find(
      (f) => f.code === "multiple_root_compositions",
    );
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("scaffold.html");
    expect(totalErrors).toBeGreaterThan(0);
  });

  it("does NOT fire with a single root composition", () => {
    const project = makeProject(validHtml());
    const { results } = lintProject(project);
    const finding = results[0]?.result.findings.find(
      (f) => f.code === "multiple_root_compositions",
    );
    expect(finding).toBeUndefined();
  });

  it("ignores HTML files without data-composition-id", () => {
    const project = makeProject(validHtml());
    writeFileSync(join(project.dir, "readme.html"), "<html><body>Not a composition</body></html>");
    const { results } = lintProject(project);
    const finding = results[0]?.result.findings.find(
      (f) => f.code === "multiple_root_compositions",
    );
    expect(finding).toBeUndefined();
  });
});

describe("duplicate_audio_track", () => {
  it("detects overlapping audio with attributes in any order", () => {
    // The original scaffold bug: data-start BEFORE data-track-index
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-duration="30">
    <audio id="narration" data-start="0" data-duration="28" data-track-index="0" src="narration.wav">
    <audio id="bg" src="bg.wav" data-track-index="0" data-start="5" data-duration="20">
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);
    const { results } = lintProject(project);
    const finding = results[0]?.result.findings.find((f) => f.code === "duplicate_audio_track");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
  });

  it("does NOT fire for non-overlapping audio on the same track", () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-duration="20">
    <audio id="a" src="a.wav" data-track-index="0" data-start="0" data-duration="10">
    <audio id="b" src="b.wav" data-track-index="0" data-start="10" data-duration="10">
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);
    const { results } = lintProject(project);
    const finding = results[0]?.result.findings.find((f) => f.code === "duplicate_audio_track");
    expect(finding).toBeUndefined();
  });

  it("does NOT fire for audio on different tracks", () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-duration="20">
    <audio id="a" src="a.wav" data-track-index="0" data-start="0" data-duration="20">
    <audio id="b" src="b.wav" data-track-index="1" data-start="5" data-duration="10">
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);
    const { results } = lintProject(project);
    const finding = results[0]?.result.findings.find((f) => f.code === "duplicate_audio_track");
    expect(finding).toBeUndefined();
  });

  it("deduplicates same audio found in root + sub-composition", () => {
    const project = makeProject(validHtmlWithAudio(), {
      "scene.html": validHtmlWithAudio("scene"),
    });
    writeFileSync(join(project.dir, "song.mp3"), "fake");
    const { results } = lintProject(project);
    const finding = results[0]?.result.findings.find((f) => f.code === "duplicate_audio_track");
    expect(finding).toBeUndefined();
  });

  it("detects overlap when data-duration is missing (Infinity fallback)", () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-duration="30">
    <audio id="a" src="a.wav" data-track-index="0" data-start="0" data-duration="20">
    <audio id="b" src="b.wav" data-track-index="0" data-start="15">
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);
    const { results } = lintProject(project);
    const finding = results[0]?.result.findings.find((f) => f.code === "duplicate_audio_track");
    expect(finding).toBeDefined();
  });

  it("formats Infinity end times as 'end' without crashing", () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-duration="30">
    <audio id="a" src="a.wav" data-track-index="0" data-start="0">
    <audio id="b" src="b.wav" data-track-index="0" data-start="5">
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const project = makeProject(html);
    const { results } = lintProject(project);
    const finding = results[0]?.result.findings.find((f) => f.code === "duplicate_audio_track");
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("end");
    expect(finding?.message).not.toContain("Infinity");
  });

  it("finds audio across multiple HTML sources (g-flag regression)", () => {
    const project = makeProject(validHtmlWithAudio(), {
      "scene.html": `<html><body>
  <div data-composition-id="scene" data-width="1920" data-height="1080">
    <audio id="overlap" src="music.wav" data-track-index="0" data-start="5" data-duration="20">
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["scene"] = gsap.timeline({ paused: true });</script>
</body></html>`,
    });
    writeFileSync(join(project.dir, "song.mp3"), "fake");
    writeFileSync(join(project.dir, "music.wav"), "fake");
    const { results } = lintProject(project);
    const finding = results[0]?.result.findings.find((f) => f.code === "duplicate_audio_track");
    // song.mp3@0 (from validHtmlWithAudio, no data-duration → Infinity) and music.wav@5-25 overlap
    expect(finding).toBeDefined();
  });
});

describe("shouldBlockRender", () => {
  it("default: does not block on errors", () => {
    expect(shouldBlockRender(false, false, 5, 0)).toBe(false);
  });

  it("default: does not block on warnings", () => {
    expect(shouldBlockRender(false, false, 0, 3)).toBe(false);
  });

  it("--strict: blocks on errors", () => {
    expect(shouldBlockRender(true, false, 1, 0)).toBe(true);
  });

  it("--strict: does not block on warnings only", () => {
    expect(shouldBlockRender(true, false, 0, 5)).toBe(false);
  });

  it("--strict-all: blocks on errors", () => {
    expect(shouldBlockRender(true, true, 1, 0)).toBe(true);
  });

  it("--strict-all: blocks on warnings", () => {
    expect(shouldBlockRender(true, true, 0, 1)).toBe(true);
  });

  it("--strict-all: does not block when clean", () => {
    expect(shouldBlockRender(true, true, 0, 0)).toBe(false);
  });

  it("--strict-all alone: blocks on errors", () => {
    expect(shouldBlockRender(false, true, 1, 0)).toBe(true);
  });

  it("--strict-all alone: blocks on warnings", () => {
    expect(shouldBlockRender(false, true, 0, 1)).toBe(true);
  });
});
