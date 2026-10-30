import { describe, expect, it } from "vitest";
import { VideoSourceExtractionError } from "../services/videoFrameExtractor.js";
import { redactUrlQueriesInError, urlInputArgs } from "./urlInput.js";

const signed =
  "https://bucket.s3.us-east-2.amazonaws.com/a/b?X-Amz-Credential=AKID&X-Amz-Signature=deadbeef";

describe("urlInputArgs", () => {
  const caBundles = ["/nonexistent.crt", import.meta.filename];
  const verifyAndReconnect = [
    "-tls_verify",
    "1",
    "-ca_file",
    import.meta.filename,
    "-rw_timeout",
    "30000000",
    "-reconnect",
    "1",
    "-reconnect_delay_max",
    "2",
  ];

  it("makes ffmpeg verify the certificate of an https input and reconnect on network errors", () => {
    expect(urlInputArgs(signed, { caBundles })).toEqual([
      ...verifyAndReconnect,
      "-reconnect_on_network_error",
      "1",
    ]);
  });

  it("gives ffprobe only the options its 4.0 build accepts", () => {
    expect(urlInputArgs(signed, { tool: "ffprobe", caBundles })).toEqual(verifyAndReconnect);
  });

  it("adds nothing for local paths and plain http", () => {
    expect(urlInputArgs("/plan/compiled/bg.mp4", { caBundles: [] })).toEqual([]);
    expect(urlInputArgs("http://127.0.0.1:8080/bg.mp4", { caBundles: [] })).toEqual([]);
  });

  it("refuses an https input when no CA bundle exists", () => {
    expect(() => urlInputArgs(signed, { caBundles: ["/nonexistent.crt"] })).toThrow(/no CA bundle/);
  });
});

describe("redactUrlQueriesInError", () => {
  it("strips a signed URL's query from the message, diagnostic and stack", () => {
    const error = redactUrlQueriesInError(
      new VideoSourceExtractionError("ffmpeg_failed", false, `read ${signed}`, `${signed}: 403`),
    );
    for (const text of [error.message, error.diagnostic, error.stack]) {
      expect(text).toContain("https://bucket.s3.us-east-2.amazonaws.com/a/b?");
      expect(text).not.toContain("deadbeef");
    }
  });

  it("also strips it from a wrapped cause", () => {
    const error = redactUrlQueriesInError(
      new Error("render failed", { cause: new Error(`read ${signed}`) }),
    );
    expect(String((error.cause as Error).message)).not.toContain("deadbeef");
  });
});
