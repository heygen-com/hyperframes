/**
 * Unit tests for the Chrome runtime resolver.
 *
 * The actual @sparticuz/chromium probe lives in
 * `scripts/probe-beginframe.ts` (run in a Lambda-like Docker container).
 * These tests pin the env-var → source-selection logic so a misconfigured
 * deploy fails loudly rather than silently picking the wrong binary.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _setSparticuzChromiumForTests,
  ChromeBinaryUnavailableError,
  resolveChromeArgs,
  resolveChromeExecutablePath,
  resolveChromeSource,
} from "./chromium.js";

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv.HYPERFRAMES_LAMBDA_CHROME_SOURCE = process.env.HYPERFRAMES_LAMBDA_CHROME_SOURCE;
  savedEnv.HYPERFRAMES_LAMBDA_CHROME_PATH = process.env.HYPERFRAMES_LAMBDA_CHROME_PATH;
});

afterEach(() => {
  process.env.HYPERFRAMES_LAMBDA_CHROME_SOURCE = savedEnv.HYPERFRAMES_LAMBDA_CHROME_SOURCE;
  process.env.HYPERFRAMES_LAMBDA_CHROME_PATH = savedEnv.HYPERFRAMES_LAMBDA_CHROME_PATH;
  _setSparticuzChromiumForTests(null);
});

describe("resolveChromeSource", () => {
  it("defaults to sparticuz when no env var is set", () => {
    delete process.env.HYPERFRAMES_LAMBDA_CHROME_SOURCE;
    expect(resolveChromeSource()).toBe("sparticuz");
  });

  it("returns chrome-headless-shell when env var requests it", () => {
    process.env.HYPERFRAMES_LAMBDA_CHROME_SOURCE = "chrome-headless-shell";
    expect(resolveChromeSource()).toBe("chrome-headless-shell");
  });

  it("accepts the short alias 'shell'", () => {
    process.env.HYPERFRAMES_LAMBDA_CHROME_SOURCE = "shell";
    expect(resolveChromeSource()).toBe("chrome-headless-shell");
  });

  it("is case insensitive", () => {
    process.env.HYPERFRAMES_LAMBDA_CHROME_SOURCE = "Chrome-Headless-Shell";
    expect(resolveChromeSource()).toBe("chrome-headless-shell");
  });

  it("falls back to sparticuz on an unknown value", () => {
    process.env.HYPERFRAMES_LAMBDA_CHROME_SOURCE = "wat";
    expect(resolveChromeSource()).toBe("sparticuz");
  });
});

describe("resolveChromeExecutablePath", () => {
  it("returns the path from a stubbed sparticuz module", async () => {
    process.env.HYPERFRAMES_LAMBDA_CHROME_SOURCE = "sparticuz";
    const dir = mkdtempSync(join(tmpdir(), "hf-chrome-test-"));
    const binPath = join(dir, "chromium");
    writeFileSync(binPath, "fake binary");
    try {
      _setSparticuzChromiumForTests({
        args: ["--fake-arg"],
        executablePath: async () => binPath,
      });
      expect(await resolveChromeExecutablePath()).toBe(binPath);
      expect(await resolveChromeArgs()).toEqual(["--fake-arg"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Real-world wedge: a chunk hits `Sandbox.Timedout` mid-extraction,
  // leaving sparticuz's internal state inconsistent. On subsequent
  // invocations executablePath() returns empty/undefined and puppeteer-
  // core's downstream assertion buries the actionable signal. These
  // tests pin the typed-error contract so SFN can short-circuit retries.
  it("throws ChromeBinaryUnavailableError when sparticuz returns empty string", async () => {
    process.env.HYPERFRAMES_LAMBDA_CHROME_SOURCE = "sparticuz";
    _setSparticuzChromiumForTests({
      args: [],
      executablePath: async () => "",
    });
    await expect(resolveChromeExecutablePath()).rejects.toBeInstanceOf(
      ChromeBinaryUnavailableError,
    );
  });

  it("throws ChromeBinaryUnavailableError when sparticuz returns a non-existent path", async () => {
    process.env.HYPERFRAMES_LAMBDA_CHROME_SOURCE = "sparticuz";
    _setSparticuzChromiumForTests({
      args: [],
      executablePath: async () => "/nonexistent/sparticuz/chromium",
    });
    await expect(resolveChromeExecutablePath()).rejects.toBeInstanceOf(
      ChromeBinaryUnavailableError,
    );
  });

  it("ChromeBinaryUnavailableError carries the source + resolved path", async () => {
    process.env.HYPERFRAMES_LAMBDA_CHROME_SOURCE = "sparticuz";
    _setSparticuzChromiumForTests({
      args: [],
      executablePath: async () => "/missing",
    });
    try {
      await resolveChromeExecutablePath();
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ChromeBinaryUnavailableError);
      const typed = err as ChromeBinaryUnavailableError;
      expect(typed.source).toBe("sparticuz");
      expect(typed.resolvedPath).toBe("/missing");
      expect(typed.name).toBe("ChromeBinaryUnavailableError");
    }
  });

  it("reads chrome-headless-shell path from HYPERFRAMES_LAMBDA_CHROME_PATH", async () => {
    process.env.HYPERFRAMES_LAMBDA_CHROME_SOURCE = "chrome-headless-shell";
    const dir = mkdtempSync(join(tmpdir(), "hf-chrome-test-"));
    const binPath = join(dir, "chrome-headless-shell");
    writeFileSync(binPath, "fake binary contents");
    try {
      process.env.HYPERFRAMES_LAMBDA_CHROME_PATH = binPath;
      expect(await resolveChromeExecutablePath()).toBe(binPath);
      expect(await resolveChromeArgs()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws ChromeBinaryUnavailableError if chrome-headless-shell path is missing", async () => {
    process.env.HYPERFRAMES_LAMBDA_CHROME_SOURCE = "chrome-headless-shell";
    delete process.env.HYPERFRAMES_LAMBDA_CHROME_PATH;
    await expect(resolveChromeExecutablePath()).rejects.toBeInstanceOf(
      ChromeBinaryUnavailableError,
    );
  });

  it("throws ChromeBinaryUnavailableError if chrome-headless-shell path doesn't exist on disk", async () => {
    process.env.HYPERFRAMES_LAMBDA_CHROME_SOURCE = "chrome-headless-shell";
    process.env.HYPERFRAMES_LAMBDA_CHROME_PATH = "/nonexistent/path/chrome-headless-shell";
    await expect(resolveChromeExecutablePath()).rejects.toBeInstanceOf(
      ChromeBinaryUnavailableError,
    );
  });
});
