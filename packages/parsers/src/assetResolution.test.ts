import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectSubCompositionSrcs,
  isUnresolvedAssetPlaceholder,
  maskNonScannableRanges,
  resolveProjectRelativeSrc,
} from "./assetResolution.js";

describe("maskNonScannableRanges", () => {
  it("masks complete comments without changing offsets", () => {
    const html = '<video src="before.mp4"><!-- <video src="hidden.mp4"> --><video src="after.mp4">';
    const masked = maskNonScannableRanges(html);

    expect(masked).toHaveLength(html.length);
    expect(masked).toContain('<video src="before.mp4">');
    expect(masked).not.toContain("hidden.mp4");
    expect(masked).toContain('<video src="after.mp4">');
  });

  it("handles many comment openers in linear scans", () => {
    const html = `prefix${"<!--".repeat(10_000)}-->suffix`;
    const masked = maskNonScannableRanges(html);

    expect(masked).toHaveLength(html.length);
    expect(masked).toBe(`prefix${" ".repeat(html.length - 12)}suffix`);
  });
});

describe("isUnresolvedAssetPlaceholder", () => {
  it("is true for __UPPER__ placeholders (raw or padded)", () => {
    for (const src of ["__DURATION__", "  __DURATION__  ", "__X__"]) {
      expect(isUnresolvedAssetPlaceholder(src)).toBe(true);
    }
  });

  it("is true for unresolved templating tokens, including ?/# inside ${...}", () => {
    for (const src of [
      "<<tts_x>>",
      "{{ videoUrl }}",
      "${audioUrl}",
      "${asset?.url}", // cleanAssetUrl would chop this to `${asset` — must match on the raw value
      "${a ?? b}",
      "${u}?v=1",
      "audio/${name}.mp3", // embedded token in an otherwise path-shaped value
    ]) {
      expect(isUnresolvedAssetPlaceholder(src)).toBe(true);
    }
  });

  it("is false for real paths and remote URLs (remote handling is left to each caller)", () => {
    for (const src of [
      "audio/clip.mp3",
      "clip.mp4?v=1",
      "https://cdn.example.com/a.mp3",
      "//host/a.png",
      "",
      "   ",
    ]) {
      expect(isUnresolvedAssetPlaceholder(src)).toBe(false);
    }
  });
});

describe("collectSubCompositionSrcs", () => {
  it("finds mounts inside a template, which a DOM query cannot see", () => {
    const html =
      '<!doctype html><html><body><div data-composition-src="compositions/a.html"></div>' +
      '<template id="t"><div data-composition-src="compositions/b.html"></div></template></body></html>';
    expect(collectSubCompositionSrcs(html)).toEqual(["compositions/a.html", "compositions/b.html"]);
  });

  it("skips commented-out, scripted, and styled mounts", () => {
    const html =
      '<!-- <div data-composition-src="commented.html"></div> -->' +
      "<script>const s = '<div data-composition-src=\"scripted.html\"></div>';</script>" +
      '<style>/* <div data-composition-src="styled.html"></div> */</style>' +
      '<div data-composition-src="real.html"></div>';
    expect(collectSubCompositionSrcs(html)).toEqual(["real.html"]);
  });

  it("skips build-time placeholders and dedupes repeats", () => {
    const html =
      '<div data-composition-src="__SCENE__"></div>' +
      '<div data-composition-src="{{scene}}"></div>' +
      '<div data-composition-src="a.html"></div><div data-composition-src="a.html"></div>';
    expect(collectSubCompositionSrcs(html)).toEqual(["a.html"]);
  });

  // A remote mount names no file on disk, and every caller resolves what comes
  // back against the project root. Letting one through yields a nonsense path
  // (`<projectDir>/https:/host/a.html`): a false "does not exist" for lint, and
  // a wasted slot against the telemetry walk's file budget.
  it("drops remote and inline mounts, keeping local ones", () => {
    const html =
      '<div data-composition-src="https://host/remote.html"></div>' +
      '<div data-composition-src="//host/protocol-relative.html"></div>' +
      '<div data-composition-src="data:text/html,inline"></div>' +
      '<div data-composition-src="compositions/local.html"></div>';
    expect(collectSubCompositionSrcs(html)).toEqual(["compositions/local.html"]);
  });

  it("ignores an unterminated final tag and an attribute outside any tag", () => {
    expect(collectSubCompositionSrcs('<div data-composition-src="a.html"')).toEqual([]);
    expect(collectSubCompositionSrcs('data-composition-src="a.html"')).toEqual([]);
  });

  // Regression guard, and it needs no timing assertion to bite: the previous
  // whole-file regex had two open-ended `[^>]*` spans, which is quadratic on
  // input full of `<` with no `>`. At 1MB that ran for minutes, so this case
  // failed on the suite timeout. This scan walks tag by tag and is linear.
  // The function is on the render-plan path, so a truncated download or a blob
  // of stray `<` must not be able to hang a render before it starts.
  it("stays fast on a megabyte of unterminated tag openings", () => {
    expect(collectSubCompositionSrcs("<".repeat(1024 * 1024))).toEqual([]);
  });
});

// The browser clamps `..` at the origin root; path.join does not. One resolver must serve lint and render.
describe("resolveProjectRelativeSrc — the one src resolver for lint and render", () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "hf-resolver-"));
    mkdirSync(join(tmp, "project", "assets"), { recursive: true });
    writeFileSync(join(tmp, "project", "assets", "foo.mp4"), "");
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns the literal join when the file exists at projectDir/src", () => {
    const projectDir = join(tmp, "project");
    expect(resolveProjectRelativeSrc("assets/foo.mp4", projectDir)).toBe(
      join(projectDir, "assets/foo.mp4"),
    );
  });

  it("resolves a browser root-absolute URL from the project root", () => {
    const projectDir = join(tmp, "project");
    expect(resolveProjectRelativeSrc("/assets/foo.mp4", projectDir)).toBe(
      join(projectDir, "assets/foo.mp4"),
    );
  });

  it("clamps a leading `../` so `../assets/foo.mp4` resolves to assets/foo.mp4", () => {
    const projectDir = join(tmp, "project");
    expect(resolveProjectRelativeSrc("../assets/foo.mp4", projectDir)).toBe(
      join(projectDir, "assets/foo.mp4"),
    );
  });

  it("clamps multiple leading `../../../` segments", () => {
    const projectDir = join(tmp, "project");
    expect(resolveProjectRelativeSrc("../../../assets/foo.mp4", projectDir)).toBe(
      join(projectDir, "assets/foo.mp4"),
    );
  });

  it("clamps mid-path traversal that escapes baseDir (not just leading `..`)", () => {
    const projectDir = join(tmp, "project");
    expect(resolveProjectRelativeSrc("assets/../../assets/foo.mp4", projectDir)).toBe(
      join(projectDir, "assets/foo.mp4"),
    );
  });

  it("returns the (non-existent) base-dir path on miss so callers get a stable error message", () => {
    const projectDir = join(tmp, "project");
    expect(resolveProjectRelativeSrc("../assets/missing.mp4", projectDir)).toBe(
      join(projectDir, "../assets/missing.mp4"),
    );
  });

  it("prefers compiled-dir over base-dir when the file exists in both", () => {
    const projectDir = join(tmp, "project");
    const compiledDir = join(tmp, "compiled");
    mkdirSync(join(compiledDir, "assets"), { recursive: true });
    writeFileSync(join(compiledDir, "assets", "foo.mp4"), "");
    expect(resolveProjectRelativeSrc("assets/foo.mp4", projectDir, compiledDir)).toBe(
      join(compiledDir, "assets/foo.mp4"),
    );
  });

  it("resolves percent-encoded non-Latin filenames across scripts", () => {
    const projectDir = join(tmp, "project");
    const cases = [
      "%D9%87%D9%86%D8%A7-%D9%85%D8%B1%D9%88%D8%A7.mp4",
      "%E6%97%A5%E6%9C%AC%E8%AA%9E.mp4",
      "%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82.mp4",
      "%ED%95%9C%EA%B8%80.mp4",
    ];

    for (const encodedFilename of cases) {
      const filename = decodeURIComponent(encodedFilename);
      writeFileSync(join(projectDir, "assets", filename), "");

      expect(resolveProjectRelativeSrc(`assets/${encodedFilename}`, projectDir)).toBe(
        join(projectDir, "assets", filename),
      );
    }
  });

  it("falls back to literal filenames when percent sequences are malformed", () => {
    const projectDir = join(tmp, "project");
    const filename = "100%-discount.mp4";
    writeFileSync(join(projectDir, "assets", filename), "");

    expect(resolveProjectRelativeSrc(`assets/${filename}`, projectDir)).toBe(
      join(projectDir, "assets", filename),
    );
  });

  it("ignores a query string when locating the file", () => {
    const projectDir = join(tmp, "project");
    expect(resolveProjectRelativeSrc("assets/foo.mp4?v=2", projectDir)).toBe(
      join(projectDir, "assets/foo.mp4"),
    );
  });
});
