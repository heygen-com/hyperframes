// fallow-ignore-file code-duplication
import { EventEmitter } from "events";
import { readFileSync } from "fs";
import { basename, resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractMediaMetadata,
  extractPngMetadataFromBuffer,
  parseFrameRate,
  pixelFormatHasAlpha,
} from "./ffprobe.js";

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i] ?? 0;
    for (let bit = 0; bit < 8; bit++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: number[]): Buffer {
  const chunkData = Buffer.from(data);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(chunkData.length, 0);
  header.write(type, 4, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), chunkData])), 0);
  return Buffer.concat([header, chunkData, crc]);
}

function buildPngWithChunks(chunks: Buffer[]): Buffer {
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]);
}

function buildMinimalPng(options?: {
  cIcpAfterIdat?: boolean;
  invalidCrc?: boolean;
  longCicp?: boolean;
}) {
  const ihdr = pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 16, 2, 0, 0, 0]);
  const cicpData = options?.longCicp ? [9, 16, 0, 1, 255] : [9, 16, 0, 1];
  let cicp = pngChunk("cICP", cicpData);
  if (options?.invalidCrc) {
    cicp = Buffer.from(cicp);
    cicp[cicp.length - 1] ^= 0xff;
  }
  const idat = pngChunk(
    "IDAT",
    [0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0x00, 0x00, 0x00, 0x04, 0x00, 0x01],
  );
  const iend = pngChunk("IEND", []);
  return options?.cIcpAfterIdat
    ? buildPngWithChunks([ihdr, idat, cicp, iend])
    : buildPngWithChunks([ihdr, cicp, idat, iend]);
}

describe("extractMediaMetadata", () => {
  it("reads HDR PNG cICP metadata when ffprobe color fields are absent", async () => {
    const fixturePath = resolve(
      __dirname,
      "../../../producer/tests/hdr-regression/src/hdr-photo-pq.png",
    );

    const metadata = await extractMediaMetadata(fixturePath);

    expect(metadata.colorSpace).toEqual({
      colorPrimaries: "bt2020",
      colorTransfer: "smpte2084",
      colorSpace: "gbr",
    });
  });
});

describe("extractPngMetadataFromBuffer", () => {
  it("accepts a valid cICP chunk before IDAT", () => {
    const metadata = extractPngMetadataFromBuffer(buildMinimalPng());
    expect(metadata?.colorSpace).toEqual({
      colorPrimaries: "bt2020",
      colorTransfer: "smpte2084",
      colorSpace: "gbr",
    });
  });

  it("rejects cICP chunks after IDAT", () => {
    const metadata = extractPngMetadataFromBuffer(buildMinimalPng({ cIcpAfterIdat: true }));
    expect(metadata).toEqual({
      width: 1,
      height: 1,
      colorSpace: null,
    });
  });

  it("rejects cICP chunks with invalid CRC", () => {
    expect(extractPngMetadataFromBuffer(buildMinimalPng({ invalidCrc: true }))).toBeNull();
  });

  it("rejects cICP chunks whose payload is not exactly four bytes", () => {
    const metadata = extractPngMetadataFromBuffer(buildMinimalPng({ longCicp: true }));
    expect(metadata).toEqual({
      width: 1,
      height: 1,
      colorSpace: null,
    });
  });

  it("continues to parse the checked-in HDR PNG fixture", () => {
    const fixture = readFileSync(
      resolve(__dirname, "../../../producer/tests/hdr-regression/src/hdr-photo-pq.png"),
    );
    expect(extractPngMetadataFromBuffer(fixture)?.colorSpace?.colorTransfer).toBe("smpte2084");
  });
});

interface SpawnCall {
  command: string;
  args: readonly string[];
}

interface FakeProc extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
}

type SpawnOutcome =
  | { kind: "missing" }
  | { kind: "error"; message: string; code?: string }
  | {
      kind: "exit";
      code: number;
      stdout?: string;
      stderr?: string;
      /** Emit stdout as these exact byte chunks, to exercise a multi-byte
       *  character split across a pipe-chunk boundary. */
      stdoutChunks?: Buffer[];
    };

function createSpawnSpy(outcomes: SpawnOutcome[]): {
  spawn: (command: string, args: readonly string[]) => FakeProc;
  calls: SpawnCall[];
} {
  const calls: SpawnCall[] = [];
  let invocation = 0;
  const spawn = (command: string, args: readonly string[]): FakeProc => {
    calls.push({ command, args });
    const outcome = outcomes[invocation] ?? outcomes[outcomes.length - 1];
    invocation += 1;

    const proc = new EventEmitter() as FakeProc;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();

    process.nextTick(() => {
      if (!outcome) return;
      if (outcome.kind === "missing") {
        const err = new Error("spawn ffprobe ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        proc.emit("error", err);
        return;
      }
      if (outcome.kind === "error") {
        const err = new Error(outcome.message) as NodeJS.ErrnoException;
        if (outcome.code) err.code = outcome.code;
        proc.emit("error", err);
        return;
      }
      if (outcome.stdoutChunks) {
        for (const chunk of outcome.stdoutChunks) proc.stdout.emit("data", chunk);
      } else if (outcome.stdout) proc.stdout.emit("data", Buffer.from(outcome.stdout));
      if (outcome.stderr) proc.stderr.emit("data", Buffer.from(outcome.stderr));
      proc.emit("close", outcome.code);
    });

    return proc;
  };
  return { spawn, calls };
}

describe("ffprobe missing-binary fallback", () => {
  const originalFfprobePath = process.env.HYPERFRAMES_FFPROBE_PATH;
  const originalPath = process.env.PATH;

  function hidePathBinaries(): void {
    process.env.PATH = "";
  }

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("child_process");
    if (originalFfprobePath === undefined) delete process.env.HYPERFRAMES_FFPROBE_PATH;
    else process.env.HYPERFRAMES_FFPROBE_PATH = originalFfprobePath;
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  });

  it("spawns the configured absolute FFprobe path when HYPERFRAMES_FFPROBE_PATH is set", async () => {
    process.env.HYPERFRAMES_FFPROBE_PATH = "/tools/ffprobe.exe";
    const successfulStderr = "recoverable diagnostic on a successful probe";
    const { spawn, calls } = createSpawnSpy([
      {
        kind: "exit",
        code: 0,
        stdout: JSON.stringify({
          streams: [{ codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2 }],
          format: { duration: "1.25", bit_rate: "128000" },
        }),
        stderr: successfulStderr,
      },
    ]);
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { extractAudioMetadata } = await import("./ffprobe.js");
    const meta = await extractAudioMetadata("/tmp/uses-configured-ffprobe.wav");

    expect(meta.durationSeconds).toBe(1.25);
    expect(JSON.stringify(meta)).not.toContain(successfulStderr);
    expect(calls[0]?.command).toBe(resolve("/tools/ffprobe.exe"));
    expect(calls[0]?.args.slice(0, 2)).toEqual(["-v", "error"]);
  });

  // `profile` matters now: the packet refinement is an allowlist on AAC-LC,
  // because the 1024-sample formula is wrong for LD/ELD/HE and unverified for
  // the rest. An unprofiled "aac" stream deliberately keeps its container
  // duration rather than being refined on an assumption.
  it.each([
    {
      name: "non-AAC metadata",
      codec: "mp3",
      profile: undefined,
      packets: undefined,
      expected: 1.25,
      calls: 1,
    },
    {
      name: "unprofiled AAC",
      codec: "aac",
      profile: undefined,
      packets: "783",
      expected: 1.25,
      calls: 1,
    },
    {
      name: "valid AAC-LC packet count",
      codec: "aac",
      profile: "LC",
      packets: "783",
      expected: 16.704,
      calls: 2,
    },
    {
      name: "missing AAC packet count",
      codec: "aac",
      profile: "LC",
      packets: undefined,
      expected: 1.25,
      calls: 2,
    },
    {
      name: "zero AAC packet count",
      codec: "aac",
      profile: "LC",
      packets: "0",
      expected: 1.25,
      calls: 2,
    },
    {
      name: "invalid AAC packet count",
      codec: "aac",
      profile: "LC",
      packets: "invalid",
      expected: 1.25,
      calls: 2,
    },
  ])(
    "derives audio duration for $name",
    async ({ codec, profile, packets, expected, calls: expectedCalls }) => {
      const outcomes: SpawnOutcome[] = [
        {
          kind: "exit",
          code: 0,
          stdout: JSON.stringify({
            streams: [
              {
                codec_type: "audio",
                codec_name: codec,
                sample_rate: "48000",
                channels: 2,
                profile,
              },
            ],
            format: { duration: "1.25", bit_rate: "128000" },
          }),
        },
      ];
      if (codec === "aac" && profile === "LC") {
        outcomes.push({
          kind: "exit",
          code: 0,
          stdout: JSON.stringify({ streams: [{ nb_read_packets: packets }], format: {} }),
        });
      }
      const { spawn, calls } = createSpawnSpy(outcomes);
      vi.resetModules();
      vi.doMock("child_process", () => ({ spawn }));

      const { extractAudioMetadata } = await import("./ffprobe.js");
      const meta = await extractAudioMetadata(`/tmp/${codec}-${packets ?? "none"}.audio`);

      expect(meta.durationSeconds).toBeCloseTo(expected, 6);
      expect(calls).toHaveLength(expectedCalls);
    },
  );

  it("extractMediaMetadata falls back to PNG cICP metadata when ffprobe is missing", async () => {
    const { spawn, calls } = createSpawnSpy([{ kind: "missing" }]);
    hidePathBinaries();
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { extractMediaMetadata: extractMediaMetadataMocked } = await import("./ffprobe.js");
    const fixture = resolve(
      __dirname,
      "../../../producer/tests/hdr-regression/src/hdr-photo-pq.png",
    );
    const meta = await extractMediaMetadataMocked(fixture);

    expect(calls.length).toBe(1);
    expect(basename(calls[0]?.command ?? "")).toMatch(/^ffprobe(?:\.exe)?$/);
    expect(meta.videoCodec).toBe("png");
    expect(meta.durationSeconds).toBe(0);
    expect(meta.fps).toBe(0);
    expect(meta.hasAudio).toBe(false);
    expect(meta.isVFR).toBe(false);
    expect(meta.hasAlpha).toBe(false);
    expect(meta.colorSpace?.colorTransfer).toBe("smpte2084");
    expect(meta.colorSpace?.colorPrimaries).toBe("bt2020");
  });

  it("extractMediaMetadata detects VP9 alpha_mode streams", async () => {
    const { spawn } = createSpawnSpy([
      {
        kind: "exit",
        code: 0,
        stdout: JSON.stringify({
          streams: [
            {
              codec_type: "video",
              codec_name: "vp9",
              width: 320,
              height: 180,
              r_frame_rate: "30/1",
              avg_frame_rate: "30/1",
              pix_fmt: "yuv420p",
              tags: { alpha_mode: "1" },
            },
          ],
          format: { duration: "1.5" },
        }),
      },
    ]);
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { extractMediaMetadata: extractMediaMetadataMocked } = await import("./ffprobe.js");
    const meta = await extractMediaMetadataMocked("/tmp/alpha.webm");

    expect(meta.videoCodec).toBe("vp9");
    expect(meta.hasAlpha).toBe(true);
  });

  it("normalizes omitted video color components to empty strings", async () => {
    const { spawn } = createSpawnSpy([
      {
        kind: "exit",
        code: 0,
        stdout: JSON.stringify({
          streams: [
            {
              codec_type: "video",
              codec_name: "h264",
              width: 64,
              height: 64,
              r_frame_rate: "30/1",
              avg_frame_rate: "30/1",
              pix_fmt: "yuv420p",
              color_space: "bt709",
            },
          ],
          format: { duration: "1" },
        }),
      },
    ]);
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { extractMediaMetadata: extractMediaMetadataMocked } = await import("./ffprobe.js");
    const metadata = await extractMediaMetadataMocked("/tmp/partial-color.mp4");

    expect(metadata.colorSpace).toEqual({
      colorPrimaries: "",
      colorTransfer: "",
      colorSpace: "bt709",
    });
  });

  // Regression: newer libavformat builds (and the output of `hyperframes
  // remove-background` itself) write the VP9-alpha sidecar tag as
  // `ALPHA_MODE` (uppercase). The lowercase-only check classified those
  // files as having no alpha, the producer extracted them as JPGs, and
  // the injected <img> overlays were fully opaque rectangles that hid
  // every static element below them on the z-stack. The bug was silent —
  // studio preview rendered correctly via native <video> playback while
  // production renders covered headlines and captions with the avatar.
  it("extractMediaMetadata detects ALPHA_MODE (uppercase) streams from newer ffmpeg builds", async () => {
    const { spawn } = createSpawnSpy([
      {
        kind: "exit",
        code: 0,
        stdout: JSON.stringify({
          streams: [
            {
              codec_type: "video",
              codec_name: "vp9",
              width: 320,
              height: 180,
              r_frame_rate: "30/1",
              avg_frame_rate: "30/1",
              pix_fmt: "yuv420p",
              tags: { ALPHA_MODE: "1" },
            },
          ],
          format: { duration: "1.5" },
        }),
      },
    ]);
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { extractMediaMetadata: extractMediaMetadataMocked } = await import("./ffprobe.js");
    const meta = await extractMediaMetadataMocked("/tmp/alpha-uppercase.webm");

    expect(meta.videoCodec).toBe("vp9");
    expect(meta.hasAlpha).toBe(true);
  });

  it("extractMediaMetadata rethrows ffprobe-missing error for non-image files without fallback", async () => {
    const { spawn } = createSpawnSpy([{ kind: "missing" }]);
    hidePathBinaries();
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { extractMediaMetadata: extractMediaMetadataMocked } = await import("./ffprobe.js");

    await expect(extractMediaMetadataMocked("/tmp/no-such-video.mp4")).rejects.toThrow(/ffprobe/);
  });

  it("surfaces bounded ffprobe stderr for invalid media", async () => {
    const leadingNoise = "x".repeat(10_000);
    const diagnostic = "Invalid data found when processing input";
    const inputPath = "/tmp/render/My Secret Video.mp4";
    const { spawn, calls } = createSpawnSpy([
      {
        kind: "exit",
        code: 1,
        stderr: `${leadingNoise}${inputPath}: ${diagnostic}`,
      },
    ]);
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { extractAudioMetadata } = await import("./ffprobe.js");

    let thrown: unknown;
    try {
      await extractAudioMetadata(inputPath);
    } catch (error) {
      thrown = error;
    }
    expect(String(thrown)).toContain(diagnostic);
    expect(String(thrown)).toContain("[input]");
    expect(String(thrown)).not.toContain(inputPath);
    expect(String(thrown)).not.toContain("My Secret Video.mp4");
    expect(String(thrown).length).toBeLessThan(4_500);
    expect(calls[0]?.args.slice(0, 2)).toEqual(["-v", "error"]);
    expect(calls[0]?.args.at(-1)).toBe(inputPath);
  });

  it("redacts an input path fragment when the stderr tail starts inside its basename", async () => {
    const diagnostic = "Invalid data found when processing input";
    const inputPath = "/tmp/render/Confidential Client Preview.mp4";
    const retainedPathFragment = "Client Preview.mp4";
    const diagnosticPrefix = `: ${diagnostic} `;
    const remainingBytes =
      8 * 1024 - Buffer.byteLength(retainedPathFragment) - Buffer.byteLength(diagnosticPrefix);
    const multibyteCount = Math.floor(remainingBytes / Buffer.byteLength("€"));
    const trailingAscii = "x".repeat(remainingBytes - multibyteCount * Buffer.byteLength("€"));
    const stderr = `${inputPath}${diagnosticPrefix}${"€".repeat(multibyteCount)}${trailingAscii}`;
    const { spawn } = createSpawnSpy([{ kind: "exit", code: 1, stderr }]);
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { extractAudioMetadata } = await import("./ffprobe.js");

    let thrown: unknown;
    try {
      await extractAudioMetadata(inputPath);
    } catch (error) {
      thrown = error;
    }
    expect(String(thrown)).toContain(diagnostic);
    expect(String(thrown)).toContain("[input]");
    expect(String(thrown)).not.toContain(retainedPathFragment);
    expect(String(thrown)).not.toContain("Client Preview.mp4");
  });

  it("extractAudioMetadata surfaces a ffprobe-missing error verbatim", async () => {
    const { spawn, calls } = createSpawnSpy([{ kind: "missing" }]);
    hidePathBinaries();
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { extractAudioMetadata } = await import("./ffprobe.js");

    await expect(extractAudioMetadata("/tmp/no-such-audio.wav")).rejects.toThrow(
      /ffprobe not found/,
    );
    expect(calls.length).toBe(1);
    expect(basename(calls[0]?.command ?? "")).toMatch(/^ffprobe(?:\.exe)?$/);
  });

  it("analyzeKeyframeIntervals surfaces a ffprobe-missing error verbatim", async () => {
    const { spawn, calls } = createSpawnSpy([{ kind: "missing" }]);
    hidePathBinaries();
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { analyzeKeyframeIntervals } = await import("./ffprobe.js");

    await expect(analyzeKeyframeIntervals("/tmp/no-such-video.mp4")).rejects.toThrow(
      /ffprobe not found/,
    );
    expect(calls.length).toBe(1);
    expect(basename(calls[0]?.command ?? "")).toMatch(/^ffprobe(?:\.exe)?$/);
  });

  it("ffprobe-missing error message includes install hint", async () => {
    const { spawn } = createSpawnSpy([{ kind: "missing" }]);
    hidePathBinaries();
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { extractAudioMetadata } = await import("./ffprobe.js");

    await expect(extractAudioMetadata("/tmp/example.mp3")).rejects.toThrow(/install FFmpeg/i);
  });
});

describe("ffprobe option separator", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("child_process");
  });

  it("places -- before the file path so paths starting with - are not parsed as options", async () => {
    const { spawn, calls } = createSpawnSpy([
      {
        kind: "exit",
        code: 0,
        stdout: JSON.stringify({
          streams: [
            {
              codec_type: "video",
              codec_name: "h264",
              width: 320,
              height: 180,
              r_frame_rate: "30/1",
              avg_frame_rate: "30/1",
            },
          ],
          format: { duration: "1.5" },
        }),
      },
    ]);
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { extractMediaMetadata } = await import("./ffprobe.js");
    const filePath = "/tmp/-dangerous-name.mp4";
    await extractMediaMetadata(filePath);

    const args = calls[0]?.args ?? [];
    const filePathIndex = args.indexOf(filePath);
    expect(filePathIndex).toBeGreaterThan(0);
    expect(args[filePathIndex - 1]).toBe("--");
  });

  it("uses -- for audio and keyframe probes too", async () => {
    const { spawn, calls } = createSpawnSpy([
      {
        kind: "exit",
        code: 0,
        stdout: JSON.stringify({
          streams: [
            {
              codec_type: "audio",
              codec_name: "aac",
              // LC, so the packet-count refinement actually runs and its
              // argv is covered here too.
              profile: "LC",
              sample_rate: "48000",
              channels: 2,
            },
          ],
          format: { duration: "1.25" },
        }),
      },
      {
        kind: "exit",
        code: 0,
        stdout: JSON.stringify({
          streams: [{ nb_read_packets: "783" }],
          format: {},
        }),
      },
      { kind: "exit", code: 0, stdout: "0.000\n1.000\n" },
    ]);
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { extractAudioMetadata, analyzeKeyframeIntervals } = await import("./ffprobe.js");
    await extractAudioMetadata("/tmp/-audio.wav");
    await analyzeKeyframeIntervals("/tmp/-video.mp4");

    // Per call, not a flattened count. A total of 3 is satisfied by one call
    // emitting three `--` and two emitting none — i.e. it cannot fail for
    // misplacement, which is the shape of bug this exists to catch.
    expect(calls.map((call) => (call.args ?? []).slice(-2))).toEqual([
      ["--", "/tmp/-audio.wav"],
      ["--", "/tmp/-audio.wav"],
      ["--", "/tmp/-video.mp4"],
    ]);
  });
});

describe("parseFrameRate", () => {
  // Direct against the exported function. The previous table drove this
  // through extractMediaMetadata behind a spawn mock, which cost a
  // vi.resetModules() plus a dynamic re-import of core's 238-file barrel per
  // row (74.9 ms vs 0.094 ms) — and 4 of its 7 rows produced identical values
  // against the pre-fix implementation, so it could not fail for the bugs it
  // was written to catch.
  it.each([
    ["30/1", 30],
    ["30000/1001", 29.97],
    ["24000/1001", 23.98],
    ["60", 60],
    ["25.5", 25.5],
  ])("parses %s as %s", (input, expected) => {
    expect(parseFrameRate(input)).toBe(expected);
  });

  it.each([
    ["30/", 0],
    ["30/0", 0],
    ["0/0", 0],
    ["abc/def", 0],
    ["", 0],
    [undefined, 0],
  ])("returns 0 for unusable input %s", (input, expected) => {
    expect(parseFrameRate(input)).toBe(expected);
  });

  // Finite operands, infinite quotient — the operand-only guard missed these.
  it.each(["1e308/1e-10", "2/1e-320"])("returns 0 for overflowing quotient %s", (input) => {
    expect(parseFrameRate(input)).toBe(0);
  });

  // Negatives were truthy, so `meta.fps || 30` did not rescue them and
  // buildEncoderArgs emitted `-r -30`.
  it.each(["-30/1", "30/-1", "-60"])("returns 0 for negative rate %s", (input) => {
    expect(parseFrameRate(input)).toBe(0);
  });

  // Fell through to a bare parseFloat that stops at trailing garbage. The
  // rational operands had the same defect after the plain path was fixed.
  it.each(["30/1/2", "60fps", "60fps/1", "60/1fps", "30garbage/1garbage", "/", "/1", "30/"])(
    "returns 0 for malformed input %s",
    (input) => {
      expect(parseFrameRate(input)).toBe(0);
    },
  );

  // raw * 100 overflows for a finite-but-huge rate, so the rounded value was
  // Infinity even though the pre-round guard passed.
  it.each(["1e307", "1e307/1", "1e308/0.5"])("returns 0 when rounding overflows: %s", (input) => {
    expect(parseFrameRate(input)).toBe(0);
  });

  // 2dp rounding collapsed these to 0, and the caller's `|| 30` then
  // re-encoded a 300-second timelapse as a ~1/30-second clip.
  it.each([
    ["1/300", 0.01],
    ["1/1000", 0.01],
    ["1/200", 0.01],
  ])("floors sub-0.005 rate %s to %s rather than 0", (input, expected) => {
    expect(parseFrameRate(input)).toBe(expected);
  });
});

describe("extractPngMetadataFromBuffer cICP ordering", () => {
  it("does not emit color space until IHDR provides width and height", () => {
    const ihdr = pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 16, 2, 0, 0, 0]);
    const cicp = pngChunk("cICP", [9, 16, 0, 1]);
    const iend = pngChunk("IEND", []);

    // cICP before IHDR is invalid PNG ordering; make sure we don't return
    // zero-sized metadata in that case.
    const malformed = buildPngWithChunks([cicp, ihdr, iend]);
    expect(extractPngMetadataFromBuffer(malformed)).toEqual({
      width: 1,
      height: 1,
      colorSpace: {
        colorPrimaries: "bt2020",
        colorTransfer: "smpte2084",
        colorSpace: "gbr",
      },
    });

    // Without any IHDR, a cICP alone should not produce a result.
    const onlyCicp = buildPngWithChunks([cicp, iend]);
    expect(extractPngMetadataFromBuffer(onlyCicp)).toBeNull();
  });
});

describe("PNG chunk walk — integrity of the fallback itself", () => {
  const IHDR_4K = [0, 0, 0x0f, 0, 0, 0, 0x08, 0x70, 16, 2, 0, 0, 0];
  const CICP_PQ = [9, 16, 0, 1];

  // Regression: the walk used to continue past cICP to IEND, which made
  // whole-file integrity a precondition for returning anything. A damaged
  // trailing chunk in an otherwise-good HDR PNG nulled the whole result, and
  // extractMediaMetadata then re-throws the ffprobe error it had swallowed
  // rather than using the fallback it just computed.
  it("returns metadata even when a chunk AFTER cICP is corrupt", () => {
    const bad = pngChunk("tEXt", [65, 66]);
    bad[bad.length - 1] ^= 0xff; // break the CRC
    const png = buildPngWithChunks([
      pngChunk("IHDR", IHDR_4K),
      pngChunk("cICP", CICP_PQ),
      pngChunk("IDAT", [0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]),
      bad,
      pngChunk("IEND", []),
    ]);
    expect(extractPngMetadataFromBuffer(png)).toEqual({
      width: 3840,
      height: 2160,
      colorSpace: { colorPrimaries: "bt2020", colorTransfer: "smpte2084", colorSpace: "gbr" },
    });
  });

  it("survives outright truncation after cICP", () => {
    const png = buildPngWithChunks([pngChunk("IHDR", IHDR_4K), pngChunk("cICP", CICP_PQ)]);
    const truncated = Buffer.concat([png, Buffer.from([0, 0, 0x7f, 0xff, 73, 68, 65, 84])]);
    expect(extractPngMetadataFromBuffer(truncated)?.width).toBe(3840);
  });

  // Regression: IHDR had no first-chunk anchor, so a later one overwrote the
  // real dimensions and the producer laid out a 1-pixel image.
  it("ignores a second IHDR", () => {
    const png = buildPngWithChunks([
      pngChunk("IHDR", IHDR_4K),
      pngChunk("cICP", CICP_PQ),
      pngChunk("IDAT", [0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]),
      pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 16, 2, 0, 0, 0]),
      pngChunk("IEND", []),
    ]);
    const meta = extractPngMetadataFromBuffer(png);
    expect(meta?.width).toBe(3840);
    expect(meta?.height).toBe(2160);
  });

  // A truncated 8-byte IHDR used to be accepted, reading height out of the
  // CRC bytes; the spec length is 13.
  it("rejects a short IHDR rather than reading garbage dimensions", () => {
    const png = buildPngWithChunks([
      pngChunk("IHDR", [0, 0, 0, 7, 0, 0, 0, 9]),
      pngChunk("cICP", CICP_PQ),
      pngChunk("IEND", []),
    ]);
    expect(extractPngMetadataFromBuffer(png)).toBeNull();
  });

  it("still rejects a PNG whose IHDR or cICP itself is corrupt", () => {
    const badIhdr = pngChunk("IHDR", IHDR_4K);
    badIhdr[badIhdr.length - 1] ^= 0xff;
    expect(
      extractPngMetadataFromBuffer(buildPngWithChunks([badIhdr, pngChunk("IEND", [])])),
    ).toBeNull();
  });
});

describe("crc32 works on every runtime the package declares", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("node:zlib");
  });

  /** Load ffprobe.ts as it would evaluate on Node 22.0/22.1. */
  async function loadWithoutNativeCrc32() {
    const actual = await vi.importActual<typeof import("node:zlib")>("node:zlib");
    vi.resetModules();
    // zlib.crc32 landed in 22.2.0, but engine and cli both declare
    // `"node": ">=22"` behind a major-only gate. A NAMED import of a missing
    // export throws at module evaluation, so ffprobe.ts would fail to load
    // entirely on those runtimes — before any PNG is touched.
    vi.doMock("node:zlib", () => ({ ...actual, crc32: undefined }));
    return import("./ffprobe.js");
  }

  it("parses an HDR PNG identically with the native crc32 unavailable", async () => {
    const png = buildPngWithChunks([
      pngChunk("IHDR", [0, 0, 0x0f, 0, 0, 0, 0x08, 0x70, 16, 2, 0, 0, 0]),
      pngChunk("cICP", [9, 16, 0, 1]),
      pngChunk("IEND", []),
    ]);
    const withNative = extractPngMetadataFromBuffer(png);
    expect(withNative?.colorSpace?.colorTransfer).toBe("smpte2084");

    const fresh = await loadWithoutNativeCrc32();
    expect(fresh.extractPngMetadataFromBuffer(png)).toEqual(withNative);
  });

  it("rejects a corrupt chunk on the fallback path too", async () => {
    const bad = pngChunk("IHDR", [0, 0, 0x0f, 0, 0, 0, 0x08, 0x70, 16, 2, 0, 0, 0]);
    bad[bad.length - 1] ^= 0xff;
    const png = buildPngWithChunks([bad, pngChunk("IEND", [])]);

    const fresh = await loadWithoutNativeCrc32();
    expect(fresh.extractPngMetadataFromBuffer(png)).toBeNull();
  });
});

describe("pix_fmt alpha detection", () => {
  // The old pattern's (^|[^a-z]) anchor bound to `yuva` alone, and the list
  // omitted formats real files actually use.
  const ALPHA = [
    "yuva420p",
    "rgba",
    "argb",
    "bgra",
    "abgr",
    "gbrap",
    "ya8",
    "ya16le",
    "ayuv64le",
    "yuva444p12le",
  ];
  const OPAQUE = ["yuv420p", "rgb24", "gray", "gbrp", "nv12", "yuv444p10le", "bgr0", "rgb0"];

  it.each(ALPHA)("detects alpha in %s", (fmt) => expect(pixelFormatHasAlpha(fmt)).toBe(true));
  it.each(OPAQUE)("reports %s as opaque", (fmt) => expect(pixelFormatHasAlpha(fmt)).toBe(false));
});

describe("AAC duration refinement must never fail or distort the call", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("child_process");
  });

  const aacStream = (profile?: string) =>
    JSON.stringify({
      streams: [
        { codec_type: "audio", codec_name: "aac", sample_rate: "44100", channels: 2, profile },
      ],
      format: { duration: "600", bit_rate: "128000" },
    });

  async function probe(outcomes: SpawnOutcome[], file: string) {
    const { spawn, calls } = createSpawnSpy(outcomes);
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));
    const { extractAudioMetadata } = await import("./ffprobe.js");
    return { meta: await extractAudioMetadata(file), calls };
  }

  // Regression: the refinement had no try/catch, so its failure rejected a
  // call whose duration was already correct. htmlCompiler catches that as
  // "no audio stream", returns 0, and the render ships silent.
  it("keeps the container duration when the packet probe fails", async () => {
    const { meta } = await probe(
      [
        { kind: "exit", code: 0, stdout: aacStream("LC") },
        { kind: "exit", code: 1, stdout: "", stderr: "ffprobe exploded" },
      ],
      "/tmp/aac-packet-probe-fails.m4a",
    );
    expect(meta.durationSeconds).toBe(600);
  });

  it("keeps the container duration when the packet probe returns junk", async () => {
    const { meta } = await probe(
      [
        { kind: "exit", code: 0, stdout: aacStream("LC") },
        { kind: "exit", code: 0, stdout: "not json at all" },
      ],
      "/tmp/aac-packet-probe-junk.m4a",
    );
    expect(meta.durationSeconds).toBe(600);
  });

  // Regression: codec_name is "aac" for HE-AAC too, but its packets carry
  // 2048 output samples — assuming 1024 halved a 10:00 podcast to 5:00.
  it.each([
    "HE-AAC",
    "HE-AACv2",
    "he-aac",
    // 512- and 480-sample framing: the 1024 multiplier overstates these by
    // 2x and ~2.13x, overwriting an already-correct container duration.
    "LD",
    "ELD",
    // Not verified for this maths, so not allowlisted.
    "Main",
    "SSR",
    "LTP",
    "xHE-AAC",
    // Missing or unrecognised profile must NOT fall through to the formula —
    // that is how an unknown HE spelling kept the truncation bug.
    "",
    "SomethingNew",
  ])("does not apply the LC packet maths to profile %s", async (profile) => {
    const { meta, calls } = await probe(
      [{ kind: "exit", code: 0, stdout: aacStream(profile) }],
      `/tmp/heaac-${profile}.m4a`,
    );
    expect(meta.durationSeconds).toBe(600);
    // The second probe is not even attempted.
    expect(calls).toHaveLength(1);
  });

  it.each(["LC", " lc "])("still refines AAC profile %s", async (profile) => {
    const { meta } = await probe(
      [
        { kind: "exit", code: 0, stdout: aacStream(profile) },
        {
          kind: "exit",
          code: 0,
          stdout: JSON.stringify({ streams: [{ nb_read_packets: "861" }], format: {} }),
        },
      ],
      `/tmp/aac-lc-${profile.trim()}.m4a`,
    );
    expect(meta.durationSeconds).toBeCloseTo((861 * 1024) / 44100, 5);
  });

  it("still refines a plain AAC-LC stream", async () => {
    const { meta } = await probe(
      [
        { kind: "exit", code: 0, stdout: aacStream("LC") },
        {
          kind: "exit",
          code: 0,
          stdout: JSON.stringify({ streams: [{ nb_read_packets: "861" }], format: {} }),
        },
      ],
      "/tmp/aac-lc-refined.m4a",
    );
    expect(meta.durationSeconds).toBeCloseTo((861 * 1024) / 44100, 5);
  });
});

describe("final video frame timestamp probes", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("child_process");
  });

  it("normalizes absolute frame PTS by the selected video stream start", async () => {
    const { spawn, calls } = createSpawnSpy([
      {
        kind: "exit",
        code: 0,
        stdout: JSON.stringify({
          streams: [
            {
              codec_type: "video",
              codec_name: "h264",
              width: 64,
              height: 64,
              duration: "3",
              start_time: "5",
              r_frame_rate: "1/1",
              avg_frame_rate: "1/1",
            },
          ],
          format: { duration: "8" },
        }),
      },
      { kind: "exit", code: 0, stdout: "5.000000,\n6.000000\n7.000000\n" },
    ]);
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));
    const { extractFinalVideoFrameTimestamp, extractMediaMetadata } = await import("./ffprobe.js");

    const metadata = await extractMediaMetadata("/tmp/nonzero-start.mp4");
    expect(metadata.videoStreamDurationSeconds).toBe(3);
    expect(metadata.videoStreamStartSeconds).toBe(5);
    await expect(extractFinalVideoFrameTimestamp("/tmp/nonzero-start.mp4", metadata)).resolves.toBe(
      2,
    );

    const intervalIndex = calls[1]?.args.indexOf("-read_intervals") ?? -1;
    expect(calls[1]?.args[intervalIndex + 1]).toBe("7%8");
  });

  it("falls back to a bounded-output full scan when a transport cannot interval-seek", async () => {
    const { spawn, calls } = createSpawnSpy([
      { kind: "exit", code: 0, stdout: "" },
      { kind: "exit", code: 0, stdout: "-2.000000,\n-1.000000\n0.000000\n" },
    ]);
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));
    const { extractFinalVideoFrameTimestamp } = await import("./ffprobe.js");

    await expect(
      extractFinalVideoFrameTimestamp("/tmp/unindexed-negative-base.ts", {
        videoStreamDurationSeconds: 3,
        videoStreamStartSeconds: -2,
      }),
    ).resolves.toBe(2);

    const intervalIndex = calls[0]?.args.indexOf("-read_intervals") ?? -1;
    expect(calls[0]?.args[intervalIndex + 1]).toBe("0%1");
    expect(calls[1]?.args).not.toContain("-read_intervals");
  });

  it("does not share a caller-cancellable probe across render consumers", async () => {
    type KillableFakeProc = FakeProc & { kill: (signal?: NodeJS.Signals) => boolean };
    const processes: KillableFakeProc[] = [];
    const spawn = () => {
      const proc = new EventEmitter() as KillableFakeProc;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn(() => {
        process.nextTick(() => proc.emit("close", null, "SIGTERM"));
        return true;
      });
      processes.push(proc);
      process.nextTick(() => proc.emit("spawn"));
      return proc;
    };
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));
    const { extractFinalVideoFrameTimestamp } = await import("./ffprobe.js");
    const metadata = { videoStreamDurationSeconds: 3, videoStreamStartSeconds: 0 };
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = extractFinalVideoFrameTimestamp(
      "/tmp/shared-source.mp4",
      metadata,
      firstController.signal,
    );
    const second = extractFinalVideoFrameTimestamp(
      "/tmp/shared-source.mp4",
      metadata,
      secondController.signal,
    );
    expect(processes).toHaveLength(2);

    firstController.abort();
    await expect(first).rejects.toThrow(/ffprobe abort/);
    expect(processes[0]?.kill).toHaveBeenCalledWith("SIGTERM");
    expect(processes[1]?.kill).not.toHaveBeenCalled();

    processes[1]?.stdout.emit("data", Buffer.from("2.000000\n"));
    processes[1]?.emit("close", 0, null);
    await expect(second).resolves.toBe(2);

    expect(secondController.signal.aborted).toBe(false);
  });

  it("deduplicates the interval and fallback chain within one cancellation scope", async () => {
    const { spawn, calls } = createSpawnSpy([
      { kind: "exit", code: 0, stdout: "" },
      { kind: "exit", code: 0, stdout: "-2.000000\n-1.000000\n0.000000\n" },
    ]);
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));
    const { extractFinalVideoFrameTimestamp } = await import("./ffprobe.js");
    const metadata = { videoStreamDurationSeconds: 3, videoStreamStartSeconds: -2 };
    const signal = new AbortController().signal;

    await expect(
      Promise.all([
        extractFinalVideoFrameTimestamp("/tmp/repeated-held-tail.ts", metadata, signal),
        extractFinalVideoFrameTimestamp("/tmp/repeated-held-tail.ts", metadata, signal),
      ]),
    ).resolves.toEqual([2, 2]);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.args).toContain("-read_intervals");
    expect(calls[1]?.args).not.toContain("-read_intervals");
  });

  it("still deduplicates cancellation-independent probes", async () => {
    const { spawn, calls } = createSpawnSpy([{ kind: "exit", code: 0, stdout: "2.000000\n" }]);
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));
    const { extractFinalVideoFrameTimestamp } = await import("./ffprobe.js");
    const metadata = { videoStreamDurationSeconds: 3, videoStreamStartSeconds: 0 };

    await Promise.all([
      extractFinalVideoFrameTimestamp("/tmp/shared-source.mp4", metadata),
      extractFinalVideoFrameTimestamp("/tmp/shared-source.mp4", metadata),
    ]);

    expect(calls).toHaveLength(1);
  });
});

describe("runFfprobe process and stream handling", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("child_process");
  });

  // Regression: `--` protects "-intro.mp4" but not a path of exactly "-",
  // which ffprobe rewrites to fd: AFTER option parsing and then reads stdin.
  // With stdin left as an unwritten pipe the probe hung for the full 30s
  // deadline and failed with an empty diagnostic.
  it("rejects a filePath of '-' immediately instead of hanging on stdin", async () => {
    const { spawn, calls } = createSpawnSpy([{ kind: "exit", code: 0, stdout: "{}" }]);
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));
    const { extractMediaMetadata } = await import("./ffprobe.js");

    await expect(extractMediaMetadata("-")).rejects.toThrow(/stdin is not a supported input path/);
    expect(calls).toHaveLength(0);
  });

  it("never leaves the child's stdin as a writable pipe", async () => {
    const stdios: unknown[] = [];
    const spawn = (_c: string, _a: readonly string[], opts?: { stdio?: unknown }) => {
      stdios.push(opts?.stdio);
      const proc = new EventEmitter() as FakeProc;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      process.nextTick(() => {
        proc.stdout.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              streams: [{ codec_type: "video", codec_name: "h264", width: 2, height: 2 }],
              format: { duration: "1" },
            }),
          ),
        );
        proc.emit("close", 0);
      });
      return proc;
    };
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));
    const { extractMediaMetadata } = await import("./ffprobe.js");

    await extractMediaMetadata("/tmp/stdio-shape.mp4");
    expect(stdios[0]).toEqual(["ignore", "pipe", "pipe"]);
  });

  // NOTE on the StringDecoder change: a per-chunk toString() corrupts a
  // multi-byte character split across a pipe boundary into U+FFFD, but
  // U+FFFD is valid JSON string content, so JSON.parse still succeeds and
  // extractMediaMetadata's public surface returns nothing that exposes the
  // mangled tag value. There is no assertion here that fails on the old
  // implementation, so rather than ship a test that cannot fail, the
  // corruption is stated in the commit and this covers the bound instead.
  it("refuses to parse stdout that exceeds the size bound", async () => {
    const huge = "x".repeat(8_000_001);
    const { spawn } = createSpawnSpy([{ kind: "exit", code: 0, stdout: huge }]);
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));
    const { extractMediaMetadata } = await import("./ffprobe.js");

    await expect(extractMediaMetadata("/tmp/unbounded-output.mov")).rejects.toThrow(
      /exceeded 8000000 characters/,
    );
  });
});
