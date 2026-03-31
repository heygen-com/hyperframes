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
  <div data-composition-id="${compId}" data-width="1920" data-height="1080"></div>
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
