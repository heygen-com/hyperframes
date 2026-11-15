import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { VideoSourceExtractionError } from "../services/videoFrameExtractor.js";
import { getFfmpegBinary, getFfprobeBinary } from "./ffmpegBinaries.js";
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

  it.each(["true", "1", " TRUE\n"])(
    "limits what an https input may open to HTTPS on a render service (%j)",
    (flag) => {
      vi.stubEnv("PRODUCER_RESTRICT_PAGE_NETWORK", flag);
      try {
        expect(urlInputArgs(signed, { tool: "ffprobe", caBundles })).toEqual([
          ...verifyAndReconnect,
          "-protocol_whitelist",
          "https,tls,tcp",
          "-format_whitelist",
          expect.any(String),
        ]);
        expect(urlInputArgs("/plan/compiled/bg.mp4", { caBundles: [] })).toEqual([]);
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  it.skipIf(spawnSync(getFfprobeBinary(), ["-version"]).status !== 0)(
    "on a render service lets ffprobe open a video but not a playlist or concat list named .mp4",
    () => {
      vi.stubEnv("PRODUCER_RESTRICT_PAGE_NETWORK", "true");
      const args = urlInputArgs(signed, { caBundles });
      vi.unstubAllEnvs();
      const formats = args[args.indexOf("-format_whitelist") + 1]!;
      const dir = mkdtempSync(join(tmpdir(), "hf-url-input-"));
      try {
        const video = join(dir, "clip.mp4");
        const lavfi = ["-f", "lavfi", "-i", "testsrc2=size=32x32:rate=5:duration=1"];
        spawnSync(getFfmpegBinary(), ["-v", "error", "-y", ...lavfi, "-c:v", "mpeg4", video]);
        const playlist = join(dir, "playlist.mp4");
        writeFileSync(playlist, "#EXTM3U\n#EXTINF:1,\nhttps://127.0.0.1:9/a.ts\n#EXT-X-ENDLIST\n");
        const concat = join(dir, "concat.mp4");
        writeFileSync(concat, "ffconcat version 1.0\nfile https://127.0.0.1:9/a.mp4\n");
        const probe = (path: string) =>
          spawnSync(getFfprobeBinary(), ["-v", "error", "-format_whitelist", formats, path]).status;
        expect(probe(video)).toBe(0);
        expect(probe(playlist)).not.toBe(0);
        expect(probe(concat)).not.toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

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
