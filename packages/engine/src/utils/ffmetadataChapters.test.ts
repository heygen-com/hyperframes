import { describe, expect, it } from "vitest";
import {
  appendFfmetadataChapterInput,
  countFfmpegInputFlags,
  serializeFfmetadataChapters,
} from "./ffmetadataChapters.js";

describe("serializeFfmetadataChapters", () => {
  it("writes TIMEBASE=1/1000 START/END title blocks", () => {
    const text = serializeFfmetadataChapters(
      [
        { start: 0, title: "Hook" },
        { start: 4, title: "Product walkthrough" },
      ],
      16,
    );
    expect(text).toBe(
      [
        ";FFMETADATA1",
        "[CHAPTER]",
        "TIMEBASE=1/1000",
        "START=0",
        "END=4000",
        "title=Hook",
        "[CHAPTER]",
        "TIMEBASE=1/1000",
        "START=4000",
        "END=16000",
        "title=Product walkthrough",
        "",
      ].join("\n"),
    );
  });

  it("escapes ffmetadata special characters in titles", () => {
    const text = serializeFfmetadataChapters([{ start: 0, title: "A=B;C#D" }], 2);
    expect(text).toContain("title=A\\=B\\;C\\#D");
  });
});

describe("appendFfmetadataChapterInput", () => {
  it("uses the next free -i index after existing inputs", () => {
    const args = ["-i", "video.mp4", "-i", "audio.m4a"];
    appendFfmetadataChapterInput(args, "out.mp4", "/tmp/chapters.ffmetadata");
    expect(countFfmpegInputFlags(args)).toBe(3);
    expect(args).toEqual([
      "-i",
      "video.mp4",
      "-i",
      "audio.m4a",
      "-i",
      "/tmp/chapters.ffmetadata",
      "-map_metadata",
      "2",
    ]);
  });

  it("maps metadata at index 1 when only the video input is present", () => {
    const args = ["-i", "video.mp4"];
    appendFfmetadataChapterInput(args, "out.mov", "/tmp/chapters.ffmetadata");
    expect(args).toContain("-map_metadata");
    expect(args[args.indexOf("-map_metadata") + 1]).toBe("1");
  });

  it("does not add an input for WebM or when the path is omitted", () => {
    const webm = ["-i", "video.webm", "-i", "audio.opus"];
    appendFfmetadataChapterInput(webm, "out.webm", "/tmp/chapters.ffmetadata");
    expect(webm).toEqual(["-i", "video.webm", "-i", "audio.opus"]);

    const mp4 = ["-i", "video.mp4"];
    appendFfmetadataChapterInput(mp4, "out.mp4");
    expect(mp4).toEqual(["-i", "video.mp4"]);
  });
});
