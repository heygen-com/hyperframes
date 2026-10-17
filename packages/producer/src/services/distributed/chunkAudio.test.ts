import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assemble } from "./assemble.js";
import { audioCutForChunk, muxChunkWithAudio } from "./chunkAudio.js";

const FPS = { num: 30, den: 1 };

describe("audioCutForChunk", () => {
  it("gives each chunk the AAC packets that start in its range, priming to chunk 0", () => {
    const grid = { sampleRate: 48000, firstStart: -1024, packetSamples: 1024, packetCount: 564 };
    const chunks = [0, 120, 240].map((startFrame, index) => ({
      index,
      startFrame,
      endFrame: startFrame + 120,
    }));
    const cuts = chunks.map((_, index) => audioCutForChunk(grid, chunks, index, FPS));
    expect(cuts).toEqual([
      { seekSeconds: null, durationSeconds: 4, firstPacket: 0, packetCount: 189 },
      {
        seekSeconds: 4,
        durationSeconds: (375 * 1024 - 512) / 48000 - 4,
        firstPacket: 189,
        packetCount: 187,
      },
      {
        seekSeconds: (375 * 1024 - 512) / 48000,
        durationSeconds: null,
        firstPacket: 376,
        packetCount: 188,
      },
    ]);
  });
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

describe.skipIf(!hasFfmpeg)("chunks that carry their audio", () => {
  const TOTAL_FRAMES = 91;
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "hf-chunk-audio-"));
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function run(cmd: string, args: string[]): string {
    const result = spawnSync(cmd, args, { maxBuffer: 1 << 28, encoding: "latin1" });
    if (result.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${result.stderr}`);
    return result.stdout;
  }
  const ffmpeg = (args: string[]) => run("ffmpeg", ["-nostdin", "-loglevel", "error", ...args]);
  const frames = (path: string) =>
    ffmpeg(["-i", path, "-map", "0:v", "-f", "framemd5", "-"])
      .split("\n")
      .filter((line) => line && !line.startsWith("#"));
  const pcm = (path: string) => ffmpeg(["-i", path, "-map", "0:a", "-f", "s16le", "-"]);
  const streams = (path: string) =>
    JSON.parse(
      run("ffprobe", [
        "-v",
        "error",
        "-count_packets",
        "-show_entries",
        "stream=codec_type,nb_read_packets,duration,r_frame_rate,avg_frame_rate",
        "-of",
        "json",
        "--",
        path,
      ]),
    ).streams as { codec_type: string; nb_read_packets: string; duration: string }[];

  // Uneven chunks with a 1-frame tail, and a single chunk (read without a concat list today).
  it.each([
    ["three", [0, 47, 90, 91]],
    ["one", [0, 91]],
  ] as const)(
    "%s chunk(s) join through today's assemble like video-only chunks",
    async (name, edges) => {
      const CHUNKS = edges.slice(1).map((end, index) => ({
        index,
        startFrame: edges[index]!,
        endFrame: end,
      }));
      const dir = join(root, name);
      mkdirSync(dir, { recursive: true });
      const audioPath = join(dir, "audio.m4a");
      ffmpeg(
        `-f lavfi -i aevalsrc=0.4*sin(2*PI*(220+40*t)*t):s=48000:d=${TOTAL_FRAMES / 30} -c:a aac -b:a 192k -y`
          .split(" ")
          .concat(audioPath),
      );
      const planDir = join(dir, "plan");
      mkdirSync(join(planDir, "meta"), { recursive: true });
      writeFileSync(
        join(planDir, "plan.json"),
        JSON.stringify({
          planHash: "fake",
          totalFrames: TOTAL_FRAMES,
          hasAudio: true,
          dimensions: { fpsNum: 30, fpsDen: 1, width: 160, height: 120, format: "mp4" },
        }),
      );
      writeFileSync(join(planDir, "meta", "chunks.json"), JSON.stringify(CHUNKS));

      const videoPaths: string[] = [];
      const chunkPaths: string[] = [];
      for (const slice of CHUNKS) {
        const n = String(slice.endFrame - slice.startFrame);
        videoPaths.push(join(dir, `video-${slice.index}.mp4`));
        chunkPaths.push(join(dir, `chunk-${slice.index}.mp4`));
        // Closed GOP, no B-frames, headers repeated: shaped like renderChunk's encode.
        ffmpeg(
          `-f lavfi -i testsrc2=size=160x120:rate=30,trim=start_frame=${slice.startFrame}:end_frame=${slice.endFrame} -c:v libx264 -preset veryfast -g ${n} -keyint_min ${n} -sc_threshold 0 -bf 0 -x264-params scenecut=0:open-gop=0:repeat-headers=1 -pix_fmt yuv420p -avoid_negative_ts make_zero -y`
            .split(" ")
            .concat(videoPaths[slice.index]!),
        );
        await muxChunkWithAudio({
          videoPath: videoPaths[slice.index]!,
          audioPath,
          outputPath: chunkPaths[slice.index]!,
          chunks: CHUNKS,
          chunkIndex: slice.index,
          fps: FPS,
          timeoutMs: 60_000,
        });
      }
      // Every plan audio packet lands in exactly one chunk.
      const audioPackets = Number(streams(audioPath)[0]!.nb_read_packets);
      const chunkPackets = chunkPaths.map((path) => Number(streams(path)[1]!.nb_read_packets));
      expect(chunkPackets.reduce((a, b) => a + b, 0)).toBe(audioPackets);

      const withAudio = join(dir, "with-audio.mp4");
      const videoOnly = join(dir, "video-only.mp4");
      writeFileSync(
        join(planDir, "meta", "encoder.json"),
        JSON.stringify({ chunksCarryAudio: true }),
      );
      await assemble(planDir, chunkPaths, audioPath, withAudio);
      // Today's join of the video-only encodes, from a plan without the option.
      writeFileSync(join(planDir, "meta", "encoder.json"), "{}");
      await assemble(planDir, videoPaths, audioPath, videoOnly);
      expect(frames(withAudio)).toEqual(frames(videoOnly));
      expect(pcm(withAudio) === pcm(videoOnly)).toBe(true);
      expect(streams(withAudio)).toEqual(streams(videoOnly));
    },
    60_000,
  );
});
