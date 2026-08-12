import { describe, expect, it } from "vitest";
import { UrlDownloadError } from "../utils/urlDownloader.js";
import { classifyFfmpegSpawnError, classifyVideoExtractionError } from "./videoFrameExtractor.js";

describe("classifyFfmpegSpawnError", () => {
  it.each(["ENOENT", "EACCES", "ENOEXEC", "UNKNOWN"])(
    "keeps deterministic launch failure %s terminal",
    (code) => {
      expect(classifyFfmpegSpawnError(Object.assign(new Error(code), { code }))).toMatchObject({
        retryable: false,
      });
    },
  );

  it.each(["EAGAIN", "EMFILE", "ENFILE"])("retries known transient launch failure %s", (code) => {
    expect(classifyFfmpegSpawnError(Object.assign(new Error(code), { code }))).toMatchObject({
      kind: "ffmpeg_transient",
      retryable: true,
    });
  });
});

describe("classifyVideoExtractionError download integrity", () => {
  it("keeps deterministic HTML payloads non-retryable and user-owned as invalid media", () => {
    const classified = classifyVideoExtractionError(
      new UrlDownloadError("invalid_payload", false, "HTML payload"),
    );
    expect(classified).toMatchObject({ kind: "invalid_media", retryable: false });
  });

  it.each(["range_protocol", "length_mismatch", "hash_mismatch"] as const)(
    "keeps %s retryable after the downloader's one clean refetch is exhausted",
    (kind) => {
      expect(
        classifyVideoExtractionError(new UrlDownloadError(kind, true, "integrity failure")),
      ).toMatchObject({ kind: "download_transient", retryable: true });
    },
  );
});
