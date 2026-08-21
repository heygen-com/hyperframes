import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { ChildProcess, execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { HyperframeLintFinding } from "./types.js";
import { lintProject } from "./project.js";

// Keep project lint tests independent of the host's ffprobe installation.
vi.mock("node:child_process", () => {
  const mocked = { ChildProcess: class {}, execFile: vi.fn(), execSync: vi.fn() };
  return { ...mocked, default: mocked };
});

function tmpProject(name: string): string {
  return mkdtempSync(join(tmpdir(), `hf-lint-test-${name}-`));
}

function validHtml(compId = "main"): string {
  return `<html><body>
  <div data-composition-id="${compId}" data-width="1920" data-height="1080" data-start="0" data-duration="10"></div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["${compId}"] = gsap.timeline({ paused: true });</script>
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

describe("external symlink assets", () => {
  it("does not report a shared asset addressed through an in-project symlink", async () => {
    const project = makeProject(
      validHtml().replace("</div>", '<img src="assets/shared/sample.svg" /></div>'),
    );
    const externalDir = tmpProject("shared-assets");
    dirs.push(externalDir);
    mkdirSync(join(project, "assets"));
    writeFileSync(join(externalDir, "sample.svg"), "<svg>shared</svg>");
    try {
      symlinkSync(externalDir, join(project, "assets", "shared"), "dir");
    } catch {
      return;
    }

    const { results } = await lintProject(project);
    const findings = results.flatMap((result) => result.result.findings);

    expect(findings.some((finding) => finding.code === "missing_local_asset")).toBe(false);
  });
});

describe("blank_root_with_standalone_composition", () => {
  it("errors when the default entry is blank but an authored standalone composition lives under compositions", async () => {
    const project = makeProject(validHtml(), {
      "index.html": `<!doctype html><html><body>
  <div data-composition-id="bona-brand-card" data-width="1920" data-height="1080" data-start="0" data-duration="5">
    <div id="main-clip" class="clip" data-start="0" data-duration="5" data-track-index="0">BONA</div>
  </div>
  <script>window.__timelines = { "bona-brand-card": gsap.timeline({ paused: true }) };</script>
</body></html>`,
    });

    const { results, totalErrors } = await lintProject(project);
    const finding = results
      .flatMap((result) => result.result.findings)
      .find((item) => item.code === "blank_root_with_standalone_composition");

    expect(totalErrors).toBeGreaterThan(0);
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("compositions/index.html");
    expect(finding?.message).toContain("index.html");
    expect(finding?.message).toContain("publish");
    expect(finding?.fixHint).toContain("data-composition-src");
    expect(finding?.suggestedComposition).toBe("compositions/index.html");
  });

  it("treats non-rendering script, style, link, meta, and template children as blank", async () => {
    const shellOnlyRoot = validHtml().replace(
      "</div>",
      `<script type="application/json">{}</script>
       <style>.unused { color: white; }</style>
       <link rel="stylesheet" href="data:text/css,.unused%7Bcolor:white%7D">
       <meta name="description" content="shell">
       <template id="row-template"><div>row</div></template>
       </div>`,
    );
    const project = makeProject(shellOnlyRoot, {
      "authored.html": `<!doctype html><html><body>
  <div data-composition-id="authored" data-width="1920" data-height="1080" data-start="0" data-duration="5">
    <div class="clip" data-start="0" data-duration="5">Visible</div>
  </div>
</body></html>`,
    });

    const { results } = await lintProject(project);
    const finding = results
      .flatMap((result) => result.result.findings)
      .find((item) => item.code === "blank_root_with_standalone_composition");

    expect(finding).toBeDefined();
  });

  it("does not fire when index.html already contains authored clip content", async () => {
    const authoredRoot = validHtml().replace(
      "</div>",
      '<div class="clip" data-start="0" data-duration="10">Master content</div></div>',
    );
    const project = makeProject(authoredRoot, {
      "alternate.html": `<!doctype html><html><body>
  <div data-composition-id="alternate" data-width="1920" data-height="1080" data-start="0" data-duration="5">
    <div class="clip" data-start="0" data-duration="5">Alternate</div>
  </div>
</body></html>`,
    });

    const { results } = await lintProject(project);
    const finding = results
      .flatMap((result) => result.result.findings)
      .find((item) => item.code === "blank_root_with_standalone_composition");

    expect(finding).toBeUndefined();
  });

  it("does not treat a template-wrapped sub-composition as a misplaced standalone entry", async () => {
    const project = makeProject(validHtml(), {
      "scene.html": `<template>
  <div data-composition-id="scene" data-width="1920" data-height="1080">
    <div class="clip" data-start="0" data-duration="5">Scene</div>
  </div>
</template>`,
    });

    const { results } = await lintProject(project);
    const finding = results
      .flatMap((result) => result.result.findings)
      .find((item) => item.code === "blank_root_with_standalone_composition");

    expect(finding).toBeUndefined();
  });

  it("still catches a standalone composition that contains an unrelated nested template", async () => {
    const project = makeProject(validHtml(), {
      "card.html": `<!doctype html><html><body>
  <div data-composition-id="card" data-width="1920" data-height="1080" data-start="0" data-duration="5">
    <div class="clip" data-start="0" data-duration="5">Card</div>
    <template id="repeated-row"><div class="row">Row</div></template>
  </div>
</body></html>`,
    });

    const { results } = await lintProject(project);
    const finding = results
      .flatMap((result) => result.result.findings)
      .find((item) => item.code === "blank_root_with_standalone_composition");

    expect(finding).toBeDefined();
  });

  it("does not treat a composition that only mounts another composition as standalone", async () => {
    const project = makeProject(validHtml(), {
      "wrapper.html": `<!doctype html><html><body>
  <div data-composition-id="wrapper" data-width="1920" data-height="1080" data-start="0" data-duration="5">
    <div data-composition-src="compositions/scene.html" data-start="0" data-duration="5"></div>
  </div>
</body></html>`,
      "scene.html": `<template><div data-composition-id="scene"><p>Scene</p></div></template>`,
    });

    const { results } = await lintProject(project);
    const finding = results
      .flatMap((result) => result.result.findings)
      .find((item) => item.code === "blank_root_with_standalone_composition");

    expect(finding).toBeUndefined();
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

  it("errors when the referenced sub-composition file has content but no data-composition-id root", async () => {
    const { finding, totalErrors } = await lintSubComp("compositions/scene-title.html", {
      "scene-title.html": "<!doctype html><html><body><p>TODO: scene content</p></body></html>",
    });

    expect(totalErrors).toBeGreaterThan(0);
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("data-composition-id");
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

  // Regression: lint used to raw-filesystem-walk every .html under
  // compositions/, regardless of whether the root composition actually
  // references it. render's pre-flight (assertSubCompositionsUsable) only
  // follows real data-composition-src references starting from the root, so
  // an orphaned file with its own dangling reference made `lint`/`validate`
  // fail even though `render` succeeds fine on the same project.
  it("does not error on an orphaned, unreferenced file under compositions/ with a dangling reference inside it", async () => {
    const project = makeProject(validHtml(), {});
    const archivedDir = join(project, "compositions", "archived");
    mkdirSync(archivedDir, { recursive: true });
    // Never referenced from index.html — this file is unreachable.
    writeFileSync(
      join(archivedDir, "old-draft.html"),
      `<!doctype html><html><body>
  <div data-composition-id="old-draft" data-width="1920" data-height="1080">
    <div data-composition-src="compositions/does-not-exist.html" data-composition-id="ghost"></div>
  </div>
</body></html>`,
    );

    const { results, totalErrors } = await lintProject(project);
    const finding = results
      .flatMap((r) => r.result.findings)
      .find((f) => f.code === "missing_or_empty_sub_composition");

    expect(finding).toBeUndefined();
    expect(totalErrors).toBe(0);
  });

  it("still errors when a broken reference IS reachable from the root (nested, not just top-level)", async () => {
    const project = makeProject(htmlWithSubComp("compositions/parent.html"));
    mkdirSync(join(project, "compositions"), { recursive: true });
    writeFileSync(
      join(project, "compositions", "parent.html"),
      `<!doctype html><html><body>
  <div data-composition-id="scene-title" data-width="1920" data-height="1080">
    <div data-composition-src="compositions/does-not-exist.html" data-composition-id="child"></div>
  </div>
</body></html>`,
    );

    const { results, totalErrors } = await lintProject(project);
    const finding = results
      .flatMap((r) => r.result.findings)
      .find((f) => f.code === "missing_or_empty_sub_composition");

    expect(totalErrors).toBeGreaterThan(0);
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("compositions/does-not-exist.html");
  });
});

describe("template shell style sources", () => {
  it("collects links, style blocks, and inline styles from template content", async () => {
    const project = makeProject(`<html><body>
      <div id="scene" data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10"></div>
      <template data-composition-id="shell">
        <link rel="stylesheet" href="shell.css">
        <style>[data-composition-id="from-style-block"] .title { opacity: 0; }</style>
        <div style="mask-image: url(missing-inline-mask.png)"></div>
        <template><style>[data-composition-id="from-nested-template"] .nested { opacity: 0; }</style></template>
      </template>
      <script>window.__timelines = {};</script>
    </body></html>`);
    writeFileSync(
      join(project, "shell.css"),
      '[data-composition-id="from-link"] .from-link { opacity: 0; }',
    );

    const { results } = await lintProject(project);
    const findings = results.flatMap((entry) => entry.result.findings);
    // Each style source scopes CSS to a composition id that has no wrapper, so
    // one scoped_css_missing_wrapper per source proves all three were collected.
    expect(
      findings
        .filter((finding) => finding.code === "scoped_css_missing_wrapper")
        .map((finding) => finding.selector)
        .sort(),
    ).toEqual([
      '[data-composition-id="from-link"]',
      '[data-composition-id="from-nested-template"]',
      '[data-composition-id="from-style-block"]',
    ]);
    expect(findings.some((finding) => finding.code === "texture_mask_asset_not_found")).toBe(true);
  });
});

describe("hevc_preview_codec", () => {
  interface ProbeStream {
    codec_name: string;
    codec_tag_string: string;
  }

  const mockExecFile = vi.mocked(execFile);

  // Any real file works as a stand-in "ffprobe" path — execFile itself is
  // mocked below, so it's never actually spawned.
  const FAKE_FFPROBE_PATH = process.execPath;

  function mockFfprobeStreams(streamsByFile: Record<string, ProbeStream[]>): void {
    mockExecFile.mockImplementation((_file, args, _options, callback) => {
      const filePath = args[args.length - 1] ?? "";
      callback(
        null,
        Buffer.from(JSON.stringify({ streams: streamsByFile[filePath] ?? [] })),
        Buffer.alloc(0),
      );
      return new ChildProcess();
    });
  }

  function videoHtml(...videoSrcs: string[]): string {
    const videoTags = videoSrcs
      .map(
        (src, i) =>
          `<video id="v${i}" class="clip" src="${src}" muted data-start="${i * 5}" data-duration="5"></video>`,
      )
      .join("\n    ");
    return `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10">
    ${videoTags}
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
  }

  function makeVideoProject(
    videoSrc: string,
    writeVideoFile = true,
  ): { project: string; videoAbsPath: string } {
    const project = makeProject(videoHtml(videoSrc));
    const videoAbsPath = join(project, videoSrc);
    if (writeVideoFile) writeFileSync(videoAbsPath, "fake video bytes");
    return { project, videoAbsPath };
  }

  async function hevcFindings(project: string): Promise<HyperframeLintFinding[]> {
    const { results } = await lintProject(project);
    return results.flatMap((r) => r.result.findings).filter((f) => f.code === "hevc_preview_codec");
  }

  beforeEach(() => {
    process.env.HYPERFRAMES_FFPROBE_PATH = FAKE_FFPROBE_PATH;
    mockExecFile.mockReset();
  });

  afterEach(() => {
    delete process.env.HYPERFRAMES_FFPROBE_PATH;
    mockExecFile.mockReset();
  });

  it("flags an HEVC video with exactly one info finding naming the file", async () => {
    const { project, videoAbsPath } = makeVideoProject("clip.mp4");
    mockFfprobeStreams({
      [videoAbsPath]: [{ codec_name: "hevc", codec_tag_string: "hvc1" }],
    });

    const result = await lintProject(project);
    const findings = result.results
      .flatMap((entry) => entry.result.findings)
      .filter((finding) => finding.code === "hevc_preview_codec");

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("info");
    expect(findings[0]?.code).toBe("hevc_preview_codec");
    expect(findings[0]?.message).toContain("clip.mp4");
    expect(findings[0]?.message).toContain("automatically uses a cached H.264 proxy");
    expect(result.totalErrors).toBe(0);
    expect(result.results[0]?.result.ok).toBe(true);
  });

  it('flags an hev1-tagged HEVC video the same way (ffprobe reports codec_name "hevc" regardless of the container fourcc)', async () => {
    const { project, videoAbsPath } = makeVideoProject("clip-hev1.mp4");
    mockFfprobeStreams({
      [videoAbsPath]: [{ codec_name: "hevc", codec_tag_string: "hev1" }],
    });

    const findings = await hevcFindings(project);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("clip-hev1.mp4");
  });

  it("does not flag an H.264 video", async () => {
    const { project, videoAbsPath } = makeVideoProject("clip.mp4");
    mockFfprobeStreams({
      [videoAbsPath]: [{ codec_name: "h264", codec_tag_string: "avc1" }],
    });

    const findings = await hevcFindings(project);

    expect(findings).toHaveLength(0);
  });

  it("does not flag anything, and lint completes normally, when ffprobe cannot be resolved", async () => {
    const { project } = makeVideoProject("clip.mp4");
    process.env.HYPERFRAMES_FFPROBE_PATH = join(project, "missing-ffprobe");

    const { results, totalErrors } = await lintProject(project);

    const findings = results.flatMap((r) => r.result.findings);
    expect(findings.some((f) => f.code === "hevc_preview_codec")).toBe(false);
    expect(mockExecFile).not.toHaveBeenCalled();
    expect(totalErrors).toBe(0);
  });

  it("silently skips the finding when ffprobe errors or times out", async () => {
    const { project } = makeVideoProject("clip.mp4");
    mockExecFile.mockImplementation((_file, _args, _options, callback) => {
      callback(new Error("ffprobe timed out"), Buffer.alloc(0), Buffer.alloc(0));
      return new ChildProcess();
    });

    const { results, totalErrors } = await lintProject(project);

    const findings = results.flatMap((entry) => entry.result.findings);
    expect(findings.some((finding) => finding.code === "hevc_preview_codec")).toBe(false);
    expect(totalErrors).toBe(0);
  });

  it("does not probe or flag a missing video file — missing_local_asset covers it instead", async () => {
    const { project } = makeVideoProject("missing.mp4", false);

    const { results } = await lintProject(project);

    const findings = results.flatMap((r) => r.result.findings);
    expect(findings.some((f) => f.code === "hevc_preview_codec")).toBe(false);
    expect(findings.some((f) => f.code === "missing_local_asset")).toBe(true);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("probes the same HEVC file once when referenced twice (per-run cache)", async () => {
    const project = makeProject(videoHtml("clip.mp4", "clip.mp4"));
    const videoAbsPath = join(project, "clip.mp4");
    writeFileSync(videoAbsPath, "fake video bytes");
    mockFfprobeStreams({
      [videoAbsPath]: [{ codec_name: "hevc", codec_tag_string: "hvc1" }],
    });

    const findings = await hevcFindings(project);

    expect(findings).toHaveLength(1);
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });
});

describe("audio_src_not_found with templating tokens", () => {
  // A src carrying an unresolved templating placeholder is late-bound before render,
  // so the static linter cannot resolve it to a file and must not report it missing.
  function audioProject(src: string): string {
    return makeProject(`<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10"></div>
  <audio id="a1" class="clip" data-start="0" data-duration="3" data-track-index="10" src="${src}"></audio>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`);
  }

  async function hasAudioSrcNotFound(project: string): Promise<boolean> {
    const { results } = await lintProject(project);
    const findings: HyperframeLintFinding[] = results.flatMap((entry) => entry.result.findings);
    return findings.some((finding) => finding.code === "audio_src_not_found");
  }

  it("does not flag unresolved <<token>>, {{ token }}, or ${token} audio srcs", async () => {
    for (const token of ["<<tts_abc>>", "{{ audioUrl }}", "${audioUrl}"]) {
      expect(await hasAudioSrcNotFound(audioProject(token))).toBe(false);
    }
  });

  it("still flags a genuinely missing local audio file", async () => {
    expect(await hasAudioSrcNotFound(audioProject("audio/missing.mp3"))).toBe(true);
  });
});

describe("templating tokens are checked on the raw src, before cleanAssetUrl", () => {
  // cleanAssetUrl splits on ?/#, which also chops inside a ${...} expression
  // (e.g. `${asset?.url}` -> `${asset`). The token skip must run on the RAW value or
  // these still false-positive at the video/img/source and CSS-url() sites.
  function projectWith(bodyInner: string): string {
    return makeProject(`<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10"></div>
  ${bodyInner}
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`);
  }
  async function codes(project: string): Promise<Set<string>> {
    const { results } = await lintProject(project);
    return new Set(results.flatMap((entry) => entry.result.findings).map((f) => f.code));
  }

  // The blocker: ?/# lives inside the templating expression, so cleanAssetUrl truncates it.
  const TRICKY = ["${asset?.url}", "${a ?? b}", "${u}?v=1", "<<video_x>>", "{{ videoUrl }}"];

  it("does not flag missing_local_asset for <video> token srcs (incl. ?/# inside ${...})", async () => {
    for (const src of TRICKY) {
      const c = await codes(
        projectWith(
          `<video id="v1" class="clip" src="${src}" muted data-start="0" data-duration="3"></video>`,
        ),
      );
      expect(c.has("missing_local_asset")).toBe(false);
    }
  });

  it("does not flag missing_local_asset for <img> token srcs (incl. ?/# inside ${...})", async () => {
    for (const src of TRICKY) {
      const c = await codes(projectWith(`<img src="${src}" />`));
      expect(c.has("missing_local_asset")).toBe(false);
    }
  });

  it("does not flag texture_mask_asset_not_found for CSS url() token values (incl. ?/# inside ${...})", async () => {
    for (const url of ["${asset?.url}", "${a ?? b}"]) {
      const c = await codes(projectWith(`<div style="mask-image: url(${url})"></div>`));
      expect(c.has("texture_mask_asset_not_found")).toBe(false);
    }
  });

  // `\bsrc\s*=` also matched the tail of `data-var-src="bg"`, and `[^>]*` is greedy,
  // so a real src earlier in the same tag lost to the variable id: bindings were
  // reported as a missing file named after the variable.
  it("reports the real src, not the data-var-src variable id", async () => {
    const { results } = await lintProject(
      projectWith(`<img src="assets/logo.png" data-var-src="bg" />`),
    );
    const finding = results
      .flatMap((entry) => entry.result.findings)
      .find((f) => f.code === "missing_local_asset");
    expect(finding?.message).toContain("assets/logo.png");
    expect(finding?.message).not.toContain("bg");
  });

  it("does not invent a missing asset for a binding on an element whose src resolves", async () => {
    const c = await codes(projectWith(`<img src="${"${imgUrl}"}" data-var-src="bg" />`));
    expect(c.has("missing_local_asset")).toBe(false);
  });

  it("still flags a genuinely missing local video file", async () => {
    const c = await codes(
      projectWith(
        `<video id="v1" class="clip" src="assets/missing.mp4" muted data-start="0" data-duration="3"></video>`,
      ),
    );
    expect(c.has("missing_local_asset")).toBe(true);
  });
});
