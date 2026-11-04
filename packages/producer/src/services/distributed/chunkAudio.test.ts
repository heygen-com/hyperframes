import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assemble } from "./assemble.js";
import {
  audioCutForChunk,
  chunkAudioSource,
  chunksWithSubRange,
  muxChunkWithAudio,
  writeChunkAudioSlices,
} from "./chunkAudio.js";

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

describe("chunksWithSubRange", () => {
  const grid = { sampleRate: 48000, firstStart: -1024, packetSamples: 1024, packetCount: 564 };
  const chunks = [0, 120, 240].map((startFrame, index) => ({
    index,
    startFrame,
    endFrame: startFrame + 120,
  }));
  const packetsOf = (list: typeof chunks, index: number) => {
    const cut = audioCutForChunk(grid, list, index, FPS);
    return cut ? [cut.firstPacket, cut.firstPacket + cut.packetCount] : null;
  };

  it("splits only the chunk, and the range is a chunk of its own", () => {
    expect(chunksWithSubRange(chunks, 1, { startFrame: 150, endFrame: 200 })).toEqual({
      chunks: [
        { index: 0, startFrame: 0, endFrame: 120 },
        { index: 1, startFrame: 120, endFrame: 150 },
        { index: 2, startFrame: 150, endFrame: 200 },
        { index: 3, startFrame: 200, endFrame: 240 },
        { index: 4, startFrame: 240, endFrame: 360 },
      ],
      index: 2,
    });
    expect(chunksWithSubRange(chunks, 1, { startFrame: 120, endFrame: 240 })).toEqual({
      chunks,
      index: 1,
    });
  });

  it.each([0, 1, 2])("gives chunk %i's parts its packets, each once and in order", (index) => {
    const slice = chunks[index]!;
    const edges = [slice.startFrame, slice.startFrame + 7, slice.startFrame + 61, slice.endFrame];
    const parts = edges.slice(1).map((endFrame, i) => {
      const split = chunksWithSubRange(chunks, index, { startFrame: edges[i]!, endFrame });
      return packetsOf(split.chunks, split.index);
    });
    const owned = parts.filter((part) => part !== null);
    expect(owned[0]![0]).toBe(packetsOf(chunks, index)![0]);
    expect(owned.at(-1)![1]).toBe(packetsOf(chunks, index)![1]);
    for (let i = 1; i < owned.length; i++) expect(owned[i]![0]).toBe(owned[i - 1]![1]);
  });
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

describe.skipIf(!hasFfmpeg)("chunks that carry their audio", () => {
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
  // Each stream's packets (timing, size, payload hash), independent of how the muxer interleaved them.
  const packets = (path: string) =>
    run("ffprobe", [
      ...["-v", "error", "-show_entries", "stream=index,start_pts,duration_ts:packet=stream_index"],
      ...[
        "-show_entries",
        "packet=pts,dts,duration,size,flags,data_hash",
        "-show_data_hash",
        "sha256",
      ],
      ...["-of", "compact", "--", path],
    ])
      .split("\n")
      .sort(
        (a, b) =>
          Number(/stream_index=(\d)/.exec(a)?.[1]) - Number(/stream_index=(\d)/.exec(b)?.[1]),
      );

  // Uneven chunks with a 1-frame tail, and a single chunk (read without a concat list today). At
  // 60 fps a 1-frame tail is shorter than an AAC packet: 51 frames are 40800 samples, 41 packets
  // after the priming, and packet 41 would be the tail's first, so the tail owns none.
  it.each([
    ["three", 30, [0, 47, 90, 91], true],
    ["one", 30, [0, 91], true],
    ["60fps-silent-tail", 60, [0, 50, 51], false],
  ] as const)(
    "%s chunk(s) at %i fps assemble into the frames and audio of today's video-only join",
    async (name, rate, edges, tailHasAudio) => {
      const fps = { num: rate, den: 1 };
      const totalFrames = edges.at(-1)!;
      const CHUNKS = edges.slice(1).map((end, index) => ({
        index,
        startFrame: edges[index]!,
        endFrame: end,
      }));
      const dir = join(root, name);
      mkdirSync(dir, { recursive: true });
      const audioPath = join(dir, "audio.m4a");
      ffmpeg(
        `-f lavfi -i aevalsrc=0.4*sin(2*PI*(220+40*t)*t):s=48000:d=${totalFrames / rate} -c:a aac -b:a 192k -y`
          .split(" ")
          .concat(audioPath),
      );
      const planDir = join(dir, "plan");
      mkdirSync(join(planDir, "meta"), { recursive: true });
      writeFileSync(
        join(planDir, "plan.json"),
        JSON.stringify({
          planHash: "fake",
          totalFrames,
          hasAudio: true,
          dimensions: { fpsNum: rate, fpsDen: 1, width: 160, height: 120, format: "mp4" },
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
          `-f lavfi -i testsrc2=size=160x120:rate=${rate},trim=start_frame=${slice.startFrame}:end_frame=${slice.endFrame} -c:v libx264 -preset veryfast -g ${n} -keyint_min ${n} -sc_threshold 0 -bf 0 -x264-params scenecut=0:open-gop=0:repeat-headers=1 -pix_fmt yuv420p -avoid_negative_ts make_zero -y`
            .split(" ")
            .concat(videoPaths[slice.index]!),
        );
        await muxChunkWithAudio({
          videoPath: videoPaths[slice.index]!,
          audioPath,
          outputPath: chunkPaths[slice.index]!,
          chunks: CHUNKS,
          chunkIndex: slice.index,
          fps,
          timeoutMs: 60_000,
        });
      }
      // A chunk muxing from its slice of a sliced plan writes the same packets as from the whole file.
      const slicedPlanDir = join(dir, "sliced-plan");
      await writeChunkAudioSlices({ audioPath, planDir: slicedPlanDir, chunks: CHUNKS, fps });
      for (const slice of CHUNKS) {
        const slicedChunk = join(dir, `sliced-chunk-${slice.index}.mp4`);
        await muxChunkWithAudio({
          videoPath: videoPaths[slice.index]!,
          audioPath: chunkAudioSource(slicedPlanDir, slice.index, join(dir, "rebuilt.m4a")),
          outputPath: slicedChunk,
          chunks: CHUNKS,
          chunkIndex: slice.index,
          fps,
          timeoutMs: 60_000,
        });
        expect(packets(slicedChunk)).toEqual(packets(chunkPaths[slice.index]!));
      }

      // Every plan audio packet lands in exactly one chunk; a tail that owns none has no audio track.
      const audioOf = (path: string) => streams(path).find((s) => s.codec_type === "audio");
      const audioPackets = Number(audioOf(audioPath)!.nb_read_packets);
      const chunkPackets = chunkPaths.map((path) => Number(audioOf(path)?.nb_read_packets ?? 0));
      expect(chunkPackets.reduce((a, b) => a + b, 0)).toBe(audioPackets);
      expect(audioOf(chunkPaths.at(-1)!) !== undefined).toBe(tailHasAudio);

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

      // Video-only chunks stitched with the whole plan audio as a separate file: the same packets.
      const separate = join(dir, "separate-audio.mp4");
      writeFileSync(join(planDir, "meta", "encoder.json"), JSON.stringify({ separateAudio: true }));
      await assemble(planDir, videoPaths, audioPath, separate);
      expect(packets(separate)).toEqual(packets(withAudio));
      expect(streams(separate)).toEqual(streams(withAudio));
    },
    60_000,
  );

  // Chunks 0 and 1 rendered as parts (chunk 0's first part keeps the priming), chunk 2 whole.
  it("chunks rendered as frame sub-ranges assemble into the same audio and joined frames", async () => {
    const totalFrames = 91;
    const CHUNKS = [0, 47, 90].map((startFrame, index) => ({
      index,
      startFrame,
      endFrame: [47, 90, 91][index]!,
    }));
    const PARTS = [
      [0, 20, 47],
      [47, 60, 90],
      [90, 91],
    ];
    const dir = join(root, "parts");
    mkdirSync(dir, { recursive: true });
    const audioPath = join(dir, "audio.m4a");
    ffmpeg(
      `-f lavfi -i aevalsrc=0.4*sin(2*PI*(220+40*t)*t):s=48000:d=${totalFrames / 30} -c:a aac -b:a 192k -y`
        .split(" ")
        .concat(audioPath),
    );
    const planDir = join(dir, "plan");
    mkdirSync(join(planDir, "meta"), { recursive: true });
    writeFileSync(
      join(planDir, "plan.json"),
      JSON.stringify({
        planHash: "fake",
        totalFrames,
        hasAudio: true,
        dimensions: { fpsNum: 30, fpsDen: 1, width: 160, height: 120, format: "mp4" },
      }),
    );
    writeFileSync(join(planDir, "meta", "chunks.json"), JSON.stringify(CHUNKS));
    const slicedPlanDir = join(dir, "sliced-plan");
    await writeChunkAudioSlices({ audioPath, planDir: slicedPlanDir, chunks: CHUNKS, fps: FPS });

    // Encode and mux one frame range of chunk `index`, as renderChunk does with `frameRange`.
    const renderRange = async (index: number, startFrame: number, endFrame: number) => {
      const name = `${index}-${startFrame}-${endFrame}`;
      const videoPath = join(dir, `video-${name}.mp4`);
      const n = String(endFrame - startFrame);
      ffmpeg(
        `-f lavfi -i testsrc2=size=160x120:rate=30,trim=start_frame=${startFrame}:end_frame=${endFrame} -c:v libx264 -preset veryfast -g ${n} -keyint_min ${n} -sc_threshold 0 -bf 0 -x264-params scenecut=0:open-gop=0:repeat-headers=1 -pix_fmt yuv420p -avoid_negative_ts make_zero -y`
          .split(" ")
          .concat(videoPath),
      );
      const chunkPath = join(dir, `chunk-${name}.mp4`);
      const split = chunksWithSubRange(CHUNKS, index, { startFrame, endFrame });
      await muxChunkWithAudio({
        videoPath,
        audioPath: chunkAudioSource(slicedPlanDir, index, join(dir, "rebuilt.m4a")),
        outputPath: chunkPath,
        chunks: split.chunks,
        chunkIndex: split.index,
        fps: FPS,
        timeoutMs: 60_000,
      });
      return { videoPath, chunkPath };
    };
    const wholes = await Promise.all(
      CHUNKS.map((slice) => renderRange(slice.index, slice.startFrame, slice.endFrame)),
    );
    const parts = await Promise.all(
      PARTS.map((edges, index) =>
        Promise.all(edges.slice(1).map((end, i) => renderRange(index, edges[i]!, end))),
      ),
    );

    writeFileSync(
      join(planDir, "meta", "encoder.json"),
      JSON.stringify({ chunksCarryAudio: true }),
    );
    const fromWholes = join(dir, "from-wholes.mp4");
    const fromParts = join(dir, "from-parts.mp4");
    await assemble(
      planDir,
      wholes.map((whole) => whole.chunkPath),
      audioPath,
      fromWholes,
    );
    await assemble(
      planDir,
      parts.map((chunk) => chunk.map((part) => part.chunkPath)),
      audioPath,
      fromParts,
    );
    // The parts carry the same audio packets the whole chunks do, so the audio is unchanged.
    expect(pcm(fromParts) === pcm(fromWholes)).toBe(true);
    const audioPacketsOf = (path: string) =>
      streams(path).find((stream) => stream.codec_type === "audio")!.nb_read_packets;
    expect(audioPacketsOf(fromParts)).toBe(audioPacketsOf(fromWholes));
    expect(audioPacketsOf(fromParts)).toBe(audioPacketsOf(audioPath));

    // Frames are the parts' own frames in order: today's video-only join of the same encodes.
    const videoOnly = join(dir, "parts-video-only.mp4");
    writeFileSync(join(planDir, "meta", "encoder.json"), "{}");
    await assemble(
      planDir,
      parts.map((chunk) => chunk.map((part) => part.videoPath)),
      audioPath,
      videoOnly,
    );
    expect(frames(fromParts)).toEqual(frames(videoOnly));
    expect(frames(fromParts)).toHaveLength(totalFrames);
  }, 60_000);
});
