import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VideoSourceExtractionError } from "../services/videoFrameExtractor.js";
import { getFfmpegBinary, getFfprobeBinary } from "./ffmpegBinaries.js";
import { _setDemuxerListingForTests } from "@hyperframes/parsers/ff-binaries";
import { redactUrlQueriesInError, urlInputArgs } from "./urlInput.js";

const signed =
  "https://bucket.s3.us-east-2.amazonaws.com/a/b?X-Amz-Credential=AKID&X-Amz-Signature=deadbeef";

const LISTING = [
  " ..d = Is a device",
  " D   concat          Virtual concatenation script",
  " D   dash            Dynamic Adaptive Streaming over HTTP",
  " D   hls             Apple HTTP Live Streaming",
  " D   imf             IMF (Interoperable Master Format)",
  " D d lavfi           Libavfilter virtual input device",
  " D   mov,mp4,m4a     QuickTime / MOV",
].join("\n");

const formatsOf = (args: string[]) => args[args.indexOf("-format_whitelist") + 1]!.split(",");

describe("urlInputArgs", () => {
  afterEach(() => _setDemuxerListingForTests());

  it("refuses a local path that ffmpeg would read as a pattern of other files", () => {
    _setDemuxerListingForTests(LISTING);
    expect(() => urlInputArgs("/job/.x%d/decoy%d.png")).toThrow(/pattern of other files/);
    expect(() => urlInputArgs("/job/clip%%.mp4", { tool: "ffprobe" })).toThrow(/pattern/);
    expect(formatsOf(urlInputArgs("/job/clip 100% done.mp4"))).toContain("mov");
  });

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

  const anyDemuxers = ["-format_whitelist", expect.any(String)];

  it("makes ffmpeg verify the certificate of an https input and reconnect on network errors", () => {
    expect(urlInputArgs(signed, { caBundles })).toEqual([
      ...verifyAndReconnect,
      "-reconnect_on_network_error",
      "1",
      ...anyDemuxers,
    ]);
  });

  it("gives ffprobe only the options its 4.0 build accepts", () => {
    expect(urlInputArgs(signed, { tool: "ffprobe", caBundles })).toEqual([
      ...verifyAndReconnect,
      ...anyDemuxers,
    ]);
  });

  it.each(["true", "1", " TRUE\n"])(
    "on a render service, reads an https input the render did not declare only through the public-only proxy (%j)",
    (flag) => {
      vi.stubEnv("PRODUCER_RESTRICT_PAGE_NETWORK", flag);
      try {
        expect(urlInputArgs(signed, { tool: "ffprobe", caBundles })).toEqual([
          ...verifyAndReconnect,
          "-protocol_whitelist",
          "http,https,tls,tcp,httpproxy",
          "-format_whitelist",
          expect.any(String),
          "-http_proxy",
          "http://127.0.0.1:9",
        ]);
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
          spawnSync(getFfprobeBinary(), [
            "-v",
            "error",
            "-format_whitelist",
            formats,
            "-show_format",
            "--",
            path,
          ]).status;
        expect(probe(video)).toBe(0);
        expect(probe(playlist)).not.toBe(0);
        expect(probe(concat)).not.toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it("lets a local path or plain http open every demuxer except the ones that open other files", () => {
    _setDemuxerListingForTests(LISTING);
    for (const input of ["/plan/compiled/bg.mp4", "http://127.0.0.1:8080/bg.mp4"]) {
      expect(formatsOf(urlInputArgs(input, { caBundles: [] }))).toEqual([
        "concat",
        "hls",
        "mov",
        "mp4",
        "m4a",
      ]);
    }
  });

  it("falls back to the self-contained list when the demuxers cannot be listed", () => {
    _setDemuxerListingForTests("not a listing");
    expect(formatsOf(urlInputArgs("/plan/compiled/bg.mp4"))).toContain("mov");
    expect(formatsOf(urlInputArgs("/plan/compiled/bg.mp4"))).not.toContain("hls");
  });

  it.skipIf(spawnSync(getFfprobeBinary(), ["-version"]).status !== 0)(
    "carries the demuxer limit into every file a concat list or playlist opens",
    () => {
      const formats = formatsOf(urlInputArgs("/plan/compiled/bg.mp4"));
      const dir = mkdtempSync(join(tmpdir(), "hf-url-input-"));
      try {
        const lavfi = ["-f", "lavfi", "-i", "testsrc2=size=32x32:rate=5:duration=1"];
        spawnSync(
          getFfmpegBinary(),
          ["-v", "error", "-y", ...lavfi, "-c:v", "mpeg2video"].concat([
            "-f",
            "mpegts",
            join(dir, "seg.ts"),
          ]),
        );
        const lists = {
          "concat.mp4": "ffconcat version 1.0\nfile seg.ts\n",
          "list.m3u8": "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nseg.ts\n#EXT-X-ENDLIST\n",
        };
        for (const [name, body] of Object.entries(lists)) {
          const file = join(dir, name);
          writeFileSync(file, body);
          const probe = (allowed: string[]) =>
            spawnSync(getFfprobeBinary(), [
              "-v",
              "error",
              "-format_whitelist",
              allowed.join(","),
              "-show_format",
              "--",
              file,
            ]).status;
          expect(probe(formats)).toBe(0);
          expect(probe(formats.filter((format) => format !== "mpegts"))).not.toBe(0);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  // fails without the fix: off a render service a local input had no protocol limit and a scheme went to ffmpeg as
  // is, so a relative src such as concat:a.wav|/elsewhere/b.wav made ffmpeg open files the project never held.
  it("opens a local input with the file protocol only, in every mode", () => {
    for (const restricted of ["", "true"]) {
      vi.stubEnv("PRODUCER_RESTRICT_PAGE_NETWORK", restricted);
      try {
        for (const input of [
          "/plan/compiled/bg.mp4",
          "clip.mp4",
          "./a:b.wav",
          "C:\\renders\\bg.mp4",
        ])
          expect(urlInputArgs(input).slice(0, 2)).toEqual(["-protocol_whitelist", "file"]);
      } finally {
        vi.unstubAllEnvs();
      }
    }
  });

  it.each(["ffmpeg", "ffprobe"] as const)(
    "refuses, for %s, a scheme ffmpeg would open as something other than the file it names",
    (tool) => {
      for (const input of [
        "concat:a.wav|/etc/passwd",
        "subfile,,start,0,end,0,,:/etc/passwd",
        "crypto:/etc/passwd",
        "async:/etc/passwd",
        "cache:/etc/passwd",
        "data:,x",
        "pipe:0",
        "fd:3",
      ])
        expect(() => urlInputArgs(input, { tool })).toThrow(/input is not read/);
      expect(urlInputArgs("http://127.0.0.1:8080/bg.mp4", { tool })).not.toContain(
        "-protocol_whitelist",
      );
    },
  );

  it.skipIf(spawnSync(getFfprobeBinary(), ["-version"]).status !== 0)(
    "keeps ffprobe from opening another protocol under a local input's options",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "hf-url-input-"));
      try {
        const wav = join(dir, "outside.wav");
        const tone = ["-f", "lavfi", "-i", "sine=frequency=440:duration=1"];
        spawnSync(getFfmpegBinary(), ["-v", "error", "-y", ...tone, wav]);
        const probe = (options: string[], input: string) =>
          spawnSync(getFfprobeBinary(), ["-v", "error", ...options, "-show_format", "--", input])
            .status;
        const local = urlInputArgs(wav, { tool: "ffprobe" });
        expect(probe(local, wav)).toBe(0);
        expect(probe([], `concat:${wav}|${wav}`)).toBe(0);
        expect(probe(local, `concat:${wav}|${wav}`)).not.toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

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
