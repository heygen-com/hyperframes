import { describe, expect, it } from "vitest";
import { sourceFailureHint } from "./sourceFailureHint.js";

function stageError(code: string, kinds: string[]): Error {
  return Object.assign(new Error(`Video extraction failed [${code}; ${kinds.join(",")}]`), {
    code,
    failures: kinds.map((kind) => ({ kind, count: 1 })),
  });
}

describe("sourceFailureHint", () => {
  it("tells the person to check a file FFmpeg could not read", () => {
    const hint = sourceFailureHint(stageError("VIDEO_SOURCE_UNRENDERABLE", ["invalid_media"]));
    expect(hint).toContain("ffprobe");
    expect(hint).toContain("still being written");
    expect(hint).not.toContain("--docker");
  });

  it("names a missing file and a missing URL apart", () => {
    expect(
      sourceFailureHint(stageError("VIDEO_SOURCE_UNRENDERABLE", ["source_missing"])),
    ).toContain("is not there");
    expect(
      sourceFailureHint(stageError("VIDEO_SOURCE_UNRENDERABLE", ["download_not_found"])),
    ).toContain("404");
  });

  it("joins the hints when sources failed in different ways", () => {
    const hint = sourceFailureHint(
      stageError("VIDEO_SOURCE_UNRENDERABLE", ["invalid_media", "source_missing"]),
    );
    expect(hint).toContain("ffprobe");
    expect(hint).toContain("is not there");
  });

  it("finds the stage error behind a wrapping error", () => {
    const wrapped = new Error("Render failed", {
      cause: stageError("VIDEO_SOURCE_UNRENDERABLE", ["invalid_media"]),
    });
    expect(sourceFailureHint(wrapped)).toContain("ffprobe");
  });

  it("leaves other failures to the generic hint", () => {
    expect(sourceFailureHint(new Error("Navigation timeout of 60000 ms exceeded"))).toBeNull();
    expect(
      sourceFailureHint(stageError("VIDEO_EXTRACTION_FAILED", ["ffmpeg_transient"])),
    ).toBeNull();
    expect(
      sourceFailureHint(stageError("VIDEO_SOURCE_UNRENDERABLE", ["invalid_media", "internal"])),
    ).toBeNull();
  });
});
