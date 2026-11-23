import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveOutputResolutionFromSize } from "./_dimensions.js";

const indexHtml = (width: number, height: number) =>
  `<!doctype html><html><body><div data-composition-id="root" data-width="${width}" data-height="${height}"></div></body></html>`;

describe("resolveOutputResolutionFromSize", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-dim-size-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const resolve = (compositionSize: [number, number], size: [number, number]) => {
    writeFileSync(join(dir, "index.html"), indexHtml(...compositionSize));
    return resolveOutputResolutionFromSize({
      projectDir: dir,
      cliWidth: size[0],
      cliHeight: size[1],
      outputResolution: undefined,
    });
  };

  it("renders a whole-number multiple of the composition at that scale", () => {
    expect(resolve([1920, 1080], [3840, 2160])).toBe("landscape-4k");
    expect(resolve([1080, 1920], [2160, 3840])).toBe("portrait-4k");
  });

  it("leaves the composition's own size alone", () => {
    expect(resolve([1920, 1080], [1920, 1080])).toBeUndefined();
  });

  it("refuses a size that is not a supported multiple, naming the composition", () => {
    expect(() => resolve([1920, 1080], [2560, 1440])).toThrow(/1920×1080/);
    expect(() => resolve([1920, 1080], [3840, 1080])).toThrow(/1920×1080/);
  });

  it("refuses a size smaller than the composition", () => {
    expect(() => resolve([1920, 1080], [1280, 720])).toThrow(
      /smaller than the composition \(1920×1080\)/,
    );
  });

  it("keeps an explicit --output-resolution", () => {
    writeFileSync(join(dir, "index.html"), indexHtml(1920, 1080));
    expect(
      resolveOutputResolutionFromSize({
        projectDir: dir,
        cliWidth: 1234,
        cliHeight: 567,
        outputResolution: "landscape-4k",
      }),
    ).toBe("landscape-4k");
  });

  it("passes through when the composition is not on disk", () => {
    expect(
      resolveOutputResolutionFromSize({
        projectDir: join(dir, "missing"),
        cliWidth: 3840,
        cliHeight: 2160,
        outputResolution: undefined,
      }),
    ).toBeUndefined();
  });
});
