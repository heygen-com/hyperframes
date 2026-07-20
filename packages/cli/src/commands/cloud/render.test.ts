import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  resolveAspectRatioForSubmit,
  validateDryRunSource,
  validateResolutionFormatCombo,
  type ProjectInputSource,
} from "./render.js";

const cliEntry = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "cli.ts");

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

describe("validateDryRunSource", () => {
  it("accepts a local directory and rejects already-uploaded sources", () => {
    const exit = trapExit();
    expect(() => validateDryRunSource({ kind: "dir", dir: "." }, true)).not.toThrow();
    expect(() => validateDryRunSource({ kind: "asset_id", assetId: "asst_123" }, true)).toThrow(
      "process.exit:1",
    );
    expect(() =>
      validateDryRunSource({ kind: "url", url: "https://example.com/project.zip" }, true),
    ).toThrow("process.exit:1");
    expect(exit).toHaveBeenCalledTimes(2);
  });
});

describe("cloud render --dry-run", () => {
  it("reports the real archive without contacting the cloud", () => {
    const dir = writeComposition(1920, 1080);
    try {
      writeFileSync(
        join(dir, "index.html"),
        `<!doctype html><html data-composition-variables='[{"id":"title","type":"string","label":"Title","default":"x"}]'><body><div data-composition-id="main" data-width="1920" data-height="1080"></div></body></html>`,
        "utf-8",
      );
      writeFileSync(join(dir, "asset.bin"), "archive-input", "utf-8");
      const result = spawnSync(
        "bun",
        [
          "run",
          cliEntry,
          "cloud",
          "render",
          dir,
          "--dry-run",
          "--json",
          "--variables",
          '{"extra":1}',
        ],
        {
          encoding: "utf-8",
          timeout: 30_000,
          env: {
            ...process.env,
            CI: "1",
            HEYGEN_API_URL: "http://127.0.0.1:1",
            HYPERFRAMES_NO_UPDATE_CHECK: "1",
          },
        },
      );

      expect(result.status).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        archive: {
          file_count: number;
          size_bytes: number;
          upload_limit_bytes: number;
          exceeds_upload_limit: boolean;
          largest_files: Array<{ path: string }>;
        };
      };
      expect(payload.archive.file_count).toBe(2);
      expect(payload.archive.size_bytes).toBeGreaterThan(0);
      expect(payload.archive.upload_limit_bytes).toBe(200 * 1024 * 1024);
      expect(payload.archive.exceeds_upload_limit).toBe(false);
      expect(payload.archive.largest_files.map((file) => file.path)).toContain("asset.bin");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
