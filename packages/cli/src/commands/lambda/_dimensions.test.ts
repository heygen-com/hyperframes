import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { warnOnDimensionMismatch } from "./_dimensions.js";

const indexHtml = (width: number, height: number) =>
  `<!doctype html><html><body><div data-composition-id="root" data-width="${width}" data-height="${height}"></div></body></html>`;

describe("warnOnDimensionMismatch", () => {
  let dir: string;
  let warnSpy: ReturnType<typeof vi.fn>;
  let originalWarn: typeof console.warn;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-dim-mismatch-"));
    originalWarn = console.warn;
    warnSpy = vi.fn();
    console.warn = warnSpy as unknown as typeof console.warn;
  });

  afterEach(() => {
    console.warn = originalWarn;
    rmSync(dir, { recursive: true, force: true });
  });

  function writeIndex(html: string): void {
    writeFileSync(join(dir, "index.html"), html);
  }

  it("warns when the CLI dimensions don't match the composition", () => {
    writeIndex(indexHtml(1920, 1080));
    warnOnDimensionMismatch({
      projectDir: dir,
      cliWidth: 3840,
      cliHeight: 2160,
      outputResolution: undefined,
      quiet: false,
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const call = (warnSpy.mock.calls[0]?.[0] as string) ?? "";
    expect(call).toContain("3840×2160");
    expect(call).toContain("1920×1080");
    expect(call).toContain("--output-resolution");
  });

  it("is silent when CLI and composition agree", () => {
    writeIndex(indexHtml(1920, 1080));
    warnOnDimensionMismatch({
      projectDir: dir,
      cliWidth: 1920,
      cliHeight: 1080,
      outputResolution: undefined,
      quiet: false,
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("is silent when --output-resolution is set (the supersampling path)", () => {
    writeIndex(indexHtml(1920, 1080));
    warnOnDimensionMismatch({
      projectDir: dir,
      cliWidth: 3840,
      cliHeight: 2160,
      outputResolution: "landscape-4k",
      quiet: false,
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("is silent when quiet=true (--json)", () => {
    writeIndex(indexHtml(1920, 1080));
    warnOnDimensionMismatch({
      projectDir: dir,
      cliWidth: 3840,
      cliHeight: 2160,
      outputResolution: undefined,
      quiet: true,
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("is silent when index.html is missing (typical with --site-id)", () => {
    warnOnDimensionMismatch({
      projectDir: dir,
      cliWidth: 3840,
      cliHeight: 2160,
      outputResolution: undefined,
      quiet: false,
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("is silent when the composition has no data-composition-id root", () => {
    writeIndex("<body><h1>just a comp</h1></body>");
    warnOnDimensionMismatch({
      projectDir: dir,
      cliWidth: 3840,
      cliHeight: 2160,
      outputResolution: undefined,
      quiet: false,
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
