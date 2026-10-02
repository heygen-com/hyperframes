import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPartialCaptureState, writePartialCaptureBundle } from "./partialCapture.js";
import { CAPTURE_PHASE_SCHEMA } from "./types.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("writePartialCaptureBundle", () => {
  it("writes tokens collected before the deadline", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "hyperframes-partial-capture-"));
    temporaryDirectories.push(outputDir);
    const opts = { url: "https://example.com", outputDir };
    const state = createPartialCaptureState(opts);
    state.tokens.title = "Collected before deadline";
    state.tokens.colors = ["#ABCDEF"];

    const result = writePartialCaptureBundle(opts, state, {
      schema: CAPTURE_PHASE_SCHEMA,
      phase: "complete",
      status: "degraded",
      remainingMs: null,
      reason: "deadline",
    });
    expect(result.ok).toBe(false);
    expect(result.lastPhase.reason).toBe("deadline");

    const tokensPath = join(outputDir, "extracted", "tokens.json");
    expect(existsSync(tokensPath)).toBe(true);
    expect(JSON.parse(readFileSync(tokensPath, "utf8"))).toMatchObject({
      title: "Collected before deadline",
      colors: ["#ABCDEF"],
    });
    expect(
      JSON.parse(readFileSync(join(outputDir, "extracted", "design-styles.json"), "utf8")),
    ).toEqual(state.designStyles);
    expect(readFileSync(join(outputDir, "extracted", "page.html"), "utf8")).toBe(state.pageHtml);
    expect(JSON.parse(readFileSync(join(outputDir, "meta.json"), "utf8"))).toMatchObject({
      partial: true,
    });
  });

  // Creating symlinks needs elevated rights on Windows.
  it.skipIf(process.platform === "win32")(
    "refuses to write through a planted extracted/ symlink (#4304)",
    () => {
      const root = mkdtempSync(join(tmpdir(), "hyperframes-partial-capture-"));
      temporaryDirectories.push(root);
      const outputDir = join(root, "capture");
      const outside = join(root, "outside");
      mkdirSync(outputDir);
      mkdirSync(outside);
      symlinkSync(outside, join(outputDir, "extracted"));
      const opts = { url: "https://example.com", outputDir };

      expect(() =>
        writePartialCaptureBundle(opts, createPartialCaptureState(opts), {
          schema: CAPTURE_PHASE_SCHEMA,
          phase: "complete",
          status: "degraded",
          remainingMs: null,
          reason: "deadline",
        }),
      ).toThrow(/outside the capture directory/);
      expect(readdirSync(outside)).toEqual([]);
    },
  );
});
