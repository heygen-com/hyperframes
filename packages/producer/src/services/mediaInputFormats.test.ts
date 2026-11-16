import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ffmpegCalls: string[][] = [];

vi.mock("@hyperframes/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/engine")>()),
  runFfmpeg: vi.fn(async (args: string[]) => {
    ffmpegCalls.push(args);
    return { success: false, stderr: "", exitCode: 1 };
  }),
  runFfprobe: vi.fn(async () => JSON.stringify({ streams: [{ width: 8, height: 8 }] })),
  extractAudioMetadata: vi.fn(async () => ({ audioStreamCount: 1 })),
}));

const { _setDemuxerListingForTests } = await import("@hyperframes/parsers/ff-binaries");
const { buildAnimatedGifTranscodeArgs } = await import("./animatedGifPrep.js");
const { buildAudioSidecar } = await import("./distributed/audioSidecar.js");
const { convertHeifToJpeg } = await import("./heifImagePrep.js");

const dir = mkdtempSync(join(tmpdir(), "hf-media-formats-"));
const input = join(dir, "in.bin");
writeFileSync(input, "x");

const sites: Record<string, () => Promise<string[]>> = {
  gif: async () =>
    buildAnimatedGifTranscodeArgs({ inputPath: input, outputPath: "o", loopIterations: 1 }),
  sidecar: async () => {
    await buildAudioSidecar(input, "o");
    return ffmpegCalls.at(-1)!;
  },
  heif: async () => {
    await convertHeifToJpeg({ inputPath: input, outputPath: "o" }).catch(() => {});
    return ffmpegCalls.at(-1)!;
  },
};

describe("media inputs read by the producer", () => {
  beforeAll(() =>
    _setDemuxerListingForTests(" D  dash   DASH\n D  imf   IMF\n D  gif   GIF\n D  mov,mp4   MOV"),
  );
  afterAll(() => _setDemuxerListingForTests());

  it.each(Object.keys(sites))(
    "%s opens only demuxers that open nothing by themselves",
    async (name) => {
      const args = await sites[name]!();
      const formats = args[args.indexOf("-format_whitelist") + 1];
      expect(formats).toBe("gif,mov,mp4");
      expect(args.slice(0, args.indexOf("-i"))).toContain("-format_whitelist");
    },
  );
});
