import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  assertArchiveFits,
  resolveAspectRatioForSubmit,
  validateDryRunSource,
  type ProjectInputSource,
} from "./render.js";
import { CliRuntimeError, CliUsageError } from "../../utils/commandResult.js";

const cliEntry = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "cli.ts");

// errorBox writes to console; silence it so test output stays clean.
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

function writeComposition(width: number, height: number): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-cloud-render-test-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><html><body><div data-composition-id="main" data-width="${width}" data-height="${height}"></div></body></html>`,
    "utf-8",
  );
  return dir;
}

describe("validateDryRunSource", () => {
  it("accepts a local directory and rejects already-uploaded sources", () => {
    expect(() => validateDryRunSource({ kind: "dir", dir: "." }, true)).not.toThrow();
    expect(() => validateDryRunSource({ kind: "asset_id", assetId: "asst_123" }, true)).toThrow(
      CliUsageError,
    );
    expect(() =>
      validateDryRunSource({ kind: "url", url: "https://example.com/project.zip" }, true),
    ).toThrow(CliUsageError);
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

describe("cloud render --dry-run with heavy media", () => {
  it("plans the media as HeyGen asset uploads and leaves it out of the archive", () => {
    const dir = writeComposition(1920, 1080);
    writeFileSync(
      join(dir, "index.html"),
      `<!doctype html><html><body><div data-composition-id="main" data-width="1920" data-height="1080"><video src="clip.mp4"></video></div></body></html>`,
      "utf-8",
    );
    writeFileSync(join(dir, "clip.mp4"), Buffer.alloc(6 * 1024 * 1024, 1));
    const result = spawnSync(
      "bun",
      ["run", cliEntry, "cloud", "render", dir, "--dry-run", "--json"],
      {
        encoding: "utf-8",
        timeout: 30_000,
        env: {
          ...process.env,
          CI: "1",
          HEYGEN_API_URL: "http://127.0.0.1:1",
          HYPERFRAMES_NO_UPDATE_CHECK: "1",
          HOME: dir,
        },
      },
    );

    expect(result.status).toBe(0);
    const { archive } = JSON.parse(result.stdout) as {
      archive: {
        file_count: number;
        size_bytes: number;
        offloaded_media: Array<{ path: string; action: string; size_bytes: number }>;
      };
    };
    expect(archive.offloaded_media).toEqual([
      { path: "clip.mp4", action: "upload", size_bytes: 6 * 1024 * 1024 },
    ]);
    expect(archive.file_count).toBe(1);
    expect(archive.size_bytes).toBeLessThan(64 * 1024);
  });
});

describe("cloud render --dry-run with a file over 4 GiB left in the zip", () => {
  it("reports it as over the limit without reading it", () => {
    const dir = writeComposition(1920, 1080);
    mkdirSync(join(dir, "raw"));
    writeFileSync(join(dir, "raw", "take.mov"), "");
    truncateSync(join(dir, "raw", "take.mov"), 2 ** 32 + 1);
    const result = spawnSync(
      "bun",
      ["run", cliEntry, "cloud", "render", dir, "--dry-run", "--json"],
      {
        encoding: "utf-8",
        timeout: 60_000,
        env: {
          ...process.env,
          CI: "1",
          HEYGEN_API_URL: "http://127.0.0.1:1",
          HYPERFRAMES_NO_UPDATE_CHECK: "1",
          HOME: dir,
        },
      },
    );

    expect(result.status).toBe(0);
    const { archive } = JSON.parse(result.stdout) as {
      archive: {
        exceeds_upload_limit: boolean;
        largest_files: Array<{ path: string; size_bytes: number }>;
      };
    };
    expect(archive.exceeds_upload_limit).toBe(true);
    expect(archive.largest_files[0]).toEqual({ path: "raw/take.mov", size_bytes: 2 ** 32 + 1 });
  });
});

describe("assertArchiveFits", () => {
  it("passes an archive at the limit and fails one over it, naming its largest files", () => {
    expect(() => assertArchiveFits(200 * 1024 * 1024, [])).not.toThrow();
    const errors = vi.mocked(console.error);
    const logs = vi.mocked(console.log);
    expect(() =>
      assertArchiveFits(200 * 1024 * 1024 + 1, [
        { path: "data/scan.tiff", size_bytes: 190 * 1024 * 1024 },
      ]),
    ).toThrow(CliRuntimeError);
    expect([...errors.mock.calls, ...logs.mock.calls].flat().join("\n")).toContain(
      "data/scan.tiff",
    );
  });
});

describe("resolveAspectRatioForSubmit — non-local sources", () => {
  it("trusts an explicit flag for asset_id / url", () => {
    const asset: ProjectInputSource = { kind: "asset_id", assetId: "a" };
    expect(resolveAspectRatioForSubmit(asset, undefined, "9:16", true)).toBe("9:16");
    const url: ProjectInputSource = { kind: "url", url: "https://x/z.zip" };
    expect(resolveAspectRatioForSubmit(url, undefined, undefined, true)).toBeUndefined();
  });
});

describe("resolveAspectRatioForSubmit — local dir", () => {
  it("auto-detects from composition dims when no explicit flag", () => {
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
    const dir = writeComposition(1920, 1080);
    expect(resolveAspectRatioForSubmit({ kind: "dir", dir }, undefined, "16:9", true)).toBe("16:9");
  });

  it("rejects an explicit flag that conflicts with the composition", () => {
    const dir = writeComposition(1920, 1080);
    expect(() => resolveAspectRatioForSubmit({ kind: "dir", dir }, undefined, "1:1", true)).toThrow(
      CliRuntimeError,
    );
  });

  it("rejects an explicit flag when the composition ratio is unsupported (no-match)", () => {
    // 1080×1350 is 4:5 — not one of 16:9 / 9:16 / 1:1, so detection is `no-match`.
    const dir = writeComposition(1080, 1350);
    expect(() =>
      resolveAspectRatioForSubmit({ kind: "dir", dir }, undefined, "9:16", true),
    ).toThrow(CliRuntimeError);
  });

  it("fails fast when the --composition entry is missing", () => {
    const dir = writeComposition(1920, 1080);
    expect(() =>
      resolveAspectRatioForSubmit(
        { kind: "dir", dir },
        "compositions/missing.html",
        undefined,
        true,
      ),
    ).toThrow(CliRuntimeError);
  });

  it("names the resolved entry path and project directory when the entry is missing", () => {
    const dir = writeComposition(1920, 1080);
    const printed = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() =>
      resolveAspectRatioForSubmit({ kind: "dir", dir }, "missing.html", undefined, true),
    ).toThrow(CliRuntimeError);
    const output = printed.mock.calls.flat().join("\n");
    expect(output).toContain(`resolves to ${resolve(dir, "missing.html")}`);
    expect(output).toContain(`project directory ${resolve(dir)}`);
  });
});
