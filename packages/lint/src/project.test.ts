import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { ChildProcess, execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
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
        <style>[data-composition-id="main"] .title { opacity: 0; }</style>
        <div style="mask-image: url(missing-inline-mask.png)"></div>
        <template><style>[data-composition-id="main"] .nested { opacity: 0; }</style></template>
      </template>
      <script>window.__timelines = {};</script>
    </body></html>`);
    writeFileSync(
      join(project, "shell.css"),
      '[data-composition-id="main"] .from-link { opacity: 0; }',
    );

    const { results } = await lintProject(project);
    const findings = results.flatMap((entry) => entry.result.findings);
    expect(
      findings.filter((finding) => finding.code === "composition_self_attribute_selector"),
    ).toHaveLength(3);
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
