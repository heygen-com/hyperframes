import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  resolveAspectRatioForSubmit,
  validateResolutionFormatCombo,
  type ProjectInputSource,
} from "./render.js";

// errorBox writes to console; silence it so test output stays clean.
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Make process.exit throw so we can assert on the failure path. */
function trapExit() {
  return vi.spyOn(process, "exit").mockImplementation((code?: string | number | null): never => {
    throw new Error(`process.exit:${code ?? ""}`);
  });
}

function writeComposition(width: number, height: number): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-cloud-render-test-"));
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><html><body><div data-composition-id="main" data-width="${width}" data-height="${height}"></div></body></html>`,
    "utf-8",
  );
  return dir;
}

describe("validateResolutionFormatCombo", () => {
  it("rejects 4k + webm and 4k + mov", () => {
    const exit = trapExit();
    expect(() => validateResolutionFormatCombo("4k", "webm")).toThrow("process.exit:1");
    expect(() => validateResolutionFormatCombo("4k", "mov")).toThrow("process.exit:1");
    expect(exit).toHaveBeenCalled();
  });

  it("allows 4k + mp4 and 1080p + any format", () => {
    trapExit();
    expect(() => validateResolutionFormatCombo("4k", "mp4")).not.toThrow();
    expect(() => validateResolutionFormatCombo("1080p", "webm")).not.toThrow();
    expect(() => validateResolutionFormatCombo(undefined, undefined)).not.toThrow();
  });
});

describe("resolveAspectRatioForSubmit — non-local sources", () => {
  it("trusts an explicit flag for asset_id / url", () => {
    trapExit();
    const asset: ProjectInputSource = { kind: "asset_id", assetId: "a" };
    expect(resolveAspectRatioForSubmit(asset, undefined, "9:16", true)).toBe("9:16");
    const url: ProjectInputSource = { kind: "url", url: "https://x/z.zip" };
    expect(resolveAspectRatioForSubmit(url, undefined, undefined, true)).toBeUndefined();
  });
});

describe("resolveAspectRatioForSubmit — local dir", () => {
  it("auto-detects from composition dims when no explicit flag", () => {
    trapExit();
    const dir = writeComposition(1920, 1080);
    expect(resolveAspectRatioForSubmit({ kind: "dir", dir }, undefined, undefined, true)).toBe(
      "16:9",
    );
    const tall = writeComposition(1080, 1920);
    expect(
      resolveAspectRatioForSubmit({ kind: "dir", dir: tall }, undefined, undefined, true),
    ).toBe("9:16");
  });

  it("accepts an explicit flag that matches the composition", () => {
    trapExit();
    const dir = writeComposition(1920, 1080);
    expect(resolveAspectRatioForSubmit({ kind: "dir", dir }, undefined, "16:9", true)).toBe("16:9");
  });

  it("rejects an explicit flag that conflicts with the composition", () => {
    const exit = trapExit();
    const dir = writeComposition(1920, 1080);
    expect(() => resolveAspectRatioForSubmit({ kind: "dir", dir }, undefined, "1:1", true)).toThrow(
      "process.exit:1",
    );
    expect(exit).toHaveBeenCalled();
  });

  it("rejects an explicit flag when the composition ratio is unsupported (no-match)", () => {
    const exit = trapExit();
    // 1080×1350 is 4:5 — not one of 16:9 / 9:16 / 1:1, so detection is `no-match`.
    const dir = writeComposition(1080, 1350);
    expect(() =>
      resolveAspectRatioForSubmit({ kind: "dir", dir }, undefined, "9:16", true),
    ).toThrow("process.exit:1");
    expect(exit).toHaveBeenCalled();
  });

  it("fails fast when the --composition entry is missing", () => {
    const exit = trapExit();
    const dir = writeComposition(1920, 1080);
    expect(() =>
      resolveAspectRatioForSubmit(
        { kind: "dir", dir },
        "compositions/missing.html",
        undefined,
        true,
      ),
    ).toThrow("process.exit:1");
    expect(exit).toHaveBeenCalled();
  });
});
