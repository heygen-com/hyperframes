// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { injectDeterministicFontFaces } from "./deterministicFonts.js";

let previousCacheDir: string | undefined;
let testCacheDir: string;

beforeAll(() => {
  previousCacheDir = process.env.HYPERFRAMES_FONT_CACHE_DIR;
  testCacheDir = mkdtempSync(join(tmpdir(), "hf-font-shorthand-"));
  process.env.HYPERFRAMES_FONT_CACHE_DIR = testCacheDir;
});

afterAll(() => {
  if (previousCacheDir === undefined) delete process.env.HYPERFRAMES_FONT_CACHE_DIR;
  else process.env.HYPERFRAMES_FONT_CACHE_DIR = previousCacheDir;
  rmSync(testCacheDir, { recursive: true, force: true });
});

const offline = (async () => {
  throw new Error("offline");
}) as unknown as typeof fetch;

const inject = (css: string) =>
  injectDeterministicFontFaces(`<html><head><style>${css}</style></head><body>x</body></html>`, {
    fetchImpl: offline,
    allowSystemFontCapture: false,
  });

describe("a bundled family named only in the font shorthand loads", () => {
  it.each([
    ["size and family", "p { font: 24px Inter, sans-serif; }"],
    ["weight, size, line-height", "p { font: 700 24px/1.2 Inter, sans-serif; }"],
    ["style, variant, weight, size", 'p { font: italic small-caps bold 1.5rem "Inter", serif; }'],
    ["a keyword size", "p { font: bold large Inter; }"],
    ["a calc() size", "p { font: calc(10px + 2vw) Inter; }"],
  ])("%s", async (_case, css) => {
    expect(await inject(css)).toMatch(/@font-face\s*\{[^}]*font-family:\s*"Inter"/i);
  });

  it("ignores a system-font keyword", async () => {
    expect(await inject("p { font: caption; }")).not.toContain("@font-face");
  });
});
