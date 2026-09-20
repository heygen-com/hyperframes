import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPartialCaptureState, writePartialCaptureBundle } from "./partialCapture.js";

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

    writePartialCaptureBundle(opts, state, {
      schema: "hyperframes.capture.phase.v1",
      phase: "complete",
      status: "degraded",
      remainingMs: null,
      reason: "deadline",
    });

    const tokensPath = join(outputDir, "extracted", "tokens.json");
    expect(existsSync(tokensPath)).toBe(true);
    expect(JSON.parse(readFileSync(tokensPath, "utf8"))).toMatchObject({
      title: "Collected before deadline",
      colors: ["#ABCDEF"],
    });
    expect(
      JSON.parse(readFileSync(join(outputDir, "extracted", "design-styles.json"), "utf8")),
    ).toEqual(state.designStyles);
    expect(JSON.parse(readFileSync(join(outputDir, "extracted", "palette.json"), "utf8"))).toEqual({
      colors: ["#ABCDEF"],
    });
    expect(readFileSync(join(outputDir, "extracted", "page.html"), "utf8")).toBe(state.pageHtml);
    expect(JSON.parse(readFileSync(join(outputDir, "meta.json"), "utf8"))).toMatchObject({
      partial: true,
    });
  });
});
