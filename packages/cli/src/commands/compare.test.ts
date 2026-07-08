import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildCompareSuccessPayload,
  capCompareVariants,
  parseCompareArgs,
  prepareCompareVariantProjects,
} from "./compare.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "hf-compare-test-"));
}

describe("parseCompareArgs", () => {
  it("requires at least two composition paths", () => {
    expect(() => parseCompareArgs({ _: ["variant-a"] }, "/tmp")).toThrow(
      "need 2+ paths to compare",
    );
  });

  it("rejects --labels when the count does not match the path count", () => {
    expect(() =>
      parseCompareArgs({ _: ["variant-a", "variant-b"], labels: "one,two,three" }, "/tmp"),
    ).toThrow("--labels count (3) must match path count (2)");
  });

  it("derives default labels from directory basenames and html filenames", () => {
    const parsed = parseCompareArgs(
      { _: ["./looks/warm", "./looks/cool.html", "/tmp/hero.alt.html"] },
      "/work/project",
    );

    // Labels are the subject here — derived cross-platform via path.basename.
    // (inputPath/displayPath are absolute/relative resolutions that differ by OS
    // — separators + drive letter on Windows — and are covered by the resolution
    // tests; asserting them literally here made this a POSIX-only test.)
    expect(parsed.variants.map((v) => v.label)).toEqual(["warm", "cool", "hero.alt"]);
  });
});

describe("capCompareVariants", () => {
  it("truncates over-cap variants and exposes truncation metadata for JSON output", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const variants = Array.from({ length: 20 }, (_, index) => ({
        label: `variant ${index + 1}`,
        inputPath: `/tmp/variant-${index + 1}`,
        displayPath: `variant-${index + 1}`,
      }));

      const capped = capCompareVariants(variants);

      expect(capped.variants).toHaveLength(16);
      expect(capped.variants.at(0)?.label).toBe("variant 1");
      expect(capped.variants.at(15)?.label).toBe("variant 16");
      expect(capped.truncated).toBe(true);
      expect(capped.total).toBe(20);
      expect(buildCompareSuccessPayload("/tmp/compare.png", capped.variants, capped)).toMatchObject(
        {
          ok: true,
          sheet: "/tmp/compare.png",
          rendered: 16,
          truncated: true,
          total: 20,
        },
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Warning: 20 compare variants exceed the 16-variant cap"),
      );
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("prepareCompareVariantProjects", () => {
  it("uses project directories directly and stages standalone html files as index.html", () => {
    const dir = tempDir();
    try {
      const projectDir = join(dir, "variant-a");
      const htmlDir = join(dir, "variant-b");
      const projectIndex = join(projectDir, "index.html");
      const htmlFile = join(htmlDir, "candidate.html");
      mkdirSync(projectDir, { recursive: true });
      mkdirSync(htmlDir, { recursive: true });
      writeFileSync(projectIndex, "<!doctype html><title>A</title>", { flag: "wx" });
      writeFileSync(htmlFile, "<!doctype html><title>B</title>", { flag: "wx" });
      writeFileSync(join(htmlDir, "asset.txt"), "asset");

      const prepared = prepareCompareVariantProjects([
        { label: "A", inputPath: projectDir, displayPath: "variant-a" },
        { label: "B", inputPath: htmlFile, displayPath: "variant-b/candidate.html" },
      ]);

      try {
        expect(prepared).toHaveLength(2);
        expect(prepared[0]).toMatchObject({
          label: "A",
          inputPath: projectDir,
          displayPath: "variant-a",
          projectDir,
        });
        expect(prepared[0]?.stagedDir).toBeUndefined();
        expect(prepared[1]?.projectDir).not.toBe(htmlDir);
        expect(prepared[1]?.stagedDir).toBe(prepared[1]?.projectDir);
        expect(readFileSync(join(prepared[1]!.projectDir, "index.html"), "utf-8")).toContain(
          "<title>B</title>",
        );
        expect(readFileSync(join(prepared[1]!.projectDir, "asset.txt"), "utf-8")).toBe("asset");
        expect(existsSync(join(prepared[1]!.projectDir, "candidate.html"))).toBe(false);
      } finally {
        for (const variant of prepared) {
          if (variant.stagedDir) rmSync(variant.stagedDir, { recursive: true, force: true });
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("errors clearly for inputs that are not composition projects or html files", () => {
    const dir = tempDir();
    try {
      const badFile = join(dir, "notes.txt");
      writeFileSync(badFile, "not a composition");

      expect(() =>
        prepareCompareVariantProjects([
          { label: "notes", inputPath: badFile, displayPath: "notes.txt" },
          { label: "other", inputPath: join(dir, "missing"), displayPath: "missing" },
        ]),
      ).toThrow(/not a composition input.*notes\.txt/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
