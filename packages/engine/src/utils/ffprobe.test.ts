import { EventEmitter } from "events";
import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractMediaMetadata, extractPngMetadataFromBuffer } from "./ffprobe.js";

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
  | { kind: "exit"; code: number; stdout?: string; stderr?: string };

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
      if (outcome.stdout) proc.stdout.emit("data", Buffer.from(outcome.stdout));
      if (outcome.stderr) proc.stderr.emit("data", Buffer.from(outcome.stderr));
      proc.emit("close", outcome.code);
    });

    return proc;
  };
  return { spawn, calls };
}

describe("ffprobe missing-binary fallback", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("child_process");
  });

  it("extractMediaMetadata falls back to PNG cICP metadata when ffprobe is missing", async () => {
    const { spawn, calls } = createSpawnSpy([{ kind: "missing" }]);
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { extractMediaMetadata: extractMediaMetadataMocked } = await import("./ffprobe.js");
    const fixture = resolve(
      __dirname,
      "../../../producer/tests/hdr-regression/src/hdr-photo-pq.png",
    );
    const meta = await extractMediaMetadataMocked(fixture);

    expect(calls.length).toBe(1);
    expect(calls[0]?.command).toBe("ffprobe");
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

  it("extractMediaMetadata rethrows ffprobe-missing error for non-image files without fallback", async () => {
    const { spawn } = createSpawnSpy([{ kind: "missing" }]);
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { extractMediaMetadata: extractMediaMetadataMocked } = await import("./ffprobe.js");

    await expect(extractMediaMetadataMocked("/tmp/no-such-video.mp4")).rejects.toThrow(/ffprobe/);
  });

  it("extractAudioMetadata surfaces a ffprobe-missing error verbatim", async () => {
    const { spawn, calls } = createSpawnSpy([{ kind: "missing" }]);
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { extractAudioMetadata } = await import("./ffprobe.js");

    await expect(extractAudioMetadata("/tmp/no-such-audio.wav")).rejects.toThrow(
      /ffprobe not found/,
    );
    expect(calls.length).toBe(1);
    expect(calls[0]?.command).toBe("ffprobe");
  });

  it("analyzeKeyframeIntervals surfaces a ffprobe-missing error verbatim", async () => {
    const { spawn, calls } = createSpawnSpy([{ kind: "missing" }]);
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { analyzeKeyframeIntervals } = await import("./ffprobe.js");

    await expect(analyzeKeyframeIntervals("/tmp/no-such-video.mp4")).rejects.toThrow(
      /ffprobe not found/,
    );
    expect(calls.length).toBe(1);
    expect(calls[0]?.command).toBe("ffprobe");
  });

  it("ffprobe-missing error message includes install hint", async () => {
    const { spawn } = createSpawnSpy([{ kind: "missing" }]);
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { extractAudioMetadata } = await import("./ffprobe.js");

    await expect(extractAudioMetadata("/tmp/example.mp3")).rejects.toThrow(/install FFmpeg/i);
  });
});
