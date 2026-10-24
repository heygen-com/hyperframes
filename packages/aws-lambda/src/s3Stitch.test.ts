// fallow-ignore-file code-duplication
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";
import { assemble, muxChunkWithAudio } from "@hyperframes/producer/distributed";
import { type Part, planParts, stitchMp4InS3, uploadParts } from "./s3Stitch.js";

const MiB = 1024 * 1024;
const range = (uri: string, start: number, end: number) => ({ uri, start, end });

describe("planParts", () => {
  it("copies big ranges and merges the header into a part that borrows from chunk 0", () => {
    const header = { bytes: Buffer.alloc(MiB) };
    const parts = planParts([
      header,
      range("s3://b/0", 40, 40 + 10 * MiB),
      range("s3://b/1", 40, 40 + 6 * MiB),
      range("s3://b/2", 40, 1040),
    ]);
    expect(parts).toEqual([
      { upload: [header, range("s3://b/0", 40, 40 + 4 * MiB)] },
      { copy: range("s3://b/0", 40 + 4 * MiB, 40 + 10 * MiB) },
      { copy: range("s3://b/1", 40, 40 + 6 * MiB) },
      { upload: [range("s3://b/2", 40, 1040)] },
    ]);
  });

  it("downloads a chunk whole when borrowing would leave its rest under the minimum", () => {
    const header = { bytes: Buffer.alloc(MiB) };
    const small = range("s3://b/1", 0, 2 * MiB);
    const parts = planParts([
      header,
      range("s3://b/0", 0, 8 * MiB),
      small,
      range("s3://b/2", 0, 9 * MiB),
    ]);
    expect(parts).toEqual([
      { upload: [header, range("s3://b/0", 0, 8 * MiB)] },
      { upload: [small, range("s3://b/2", 0, 3 * MiB)] },
      { copy: range("s3://b/2", 3 * MiB, 9 * MiB) },
    ]);
  });
});

/** S3 stand-in: ranged reads, and multipart parts concatenated on complete under S3's size rule. */
class FakeS3 {
  readonly objects = new Map<string, Buffer>();
  readonly sent: { name: string; input: Record<string, unknown> }[] = [];
  private readonly parts = new Map<number, Buffer>();
  constructor(
    private readonly minPartBytes: number,
    private readonly failPart?: number,
  ) {}

  private object(bucket: unknown, key: unknown, byteRange?: unknown): Buffer {
    const bytes = this.objects.get(`s3://${bucket}/${key}`);
    if (!bytes) throw new Error(`NoSuchKey ${bucket}/${key}`);
    const match = /^bytes=(\d+)-(\d+)$/.exec(String(byteRange ?? ""));
    return match ? bytes.subarray(Number(match[1]), Number(match[2]) + 1) : bytes;
  }

  // fallow-ignore-next-line complexity
  async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
    const { name } = command.constructor;
    const input = command.input;
    this.sent.push({ name, input });
    if (this.failPart && input.PartNumber === this.failPart) throw new Error("part failed");
    if (name === "GetObjectCommand") {
      const bytes = this.object(input.Bucket, input.Key, input.Range);
      return { Body: { transformToByteArray: async () => new Uint8Array(bytes) } };
    }
    if (name === "CreateMultipartUploadCommand") return { UploadId: "up-1" };
    if (name === "UploadPartCommand") {
      this.parts.set(input.PartNumber as number, input.Body as Buffer);
      return { ETag: `"p${input.PartNumber}"` };
    }
    if (name === "UploadPartCopyCommand") {
      const [bucket, ...key] = decodeURI(String(input.CopySource)).split("/");
      const bytes = this.object(bucket, key.join("/"), input.CopySourceRange);
      this.parts.set(input.PartNumber as number, bytes);
      return { CopyPartResult: { ETag: `"p${input.PartNumber}"` } };
    }
    if (name === "CompleteMultipartUploadCommand") {
      const listed = (input.MultipartUpload as { Parts: { PartNumber: number }[] }).Parts;
      const parts = listed.map((part) => this.parts.get(part.PartNumber)!);
      if (parts.slice(0, -1).some((part) => part.length < this.minPartBytes)) {
        throw new Error("EntityTooSmall");
      }
      this.objects.set(`s3://${input.Bucket}/${input.Key}`, Buffer.concat(parts));
    }
    return {};
  }

  asClient(): S3Client {
    return this as unknown as S3Client;
  }
}

describe("uploadParts", () => {
  const parts: Part[] = [
    { upload: [{ bytes: Buffer.from("header") }] },
    { copy: range("s3://bucket/r/chunks/0001.mp4", 0, 4) },
  ];

  it("aborts the upload when a part fails", async () => {
    const s3 = new FakeS3(0, 2);
    s3.objects.set("s3://bucket/r/chunks/0001.mp4", Buffer.from("abcd"));
    await expect(
      uploadParts(s3.asClient(), parts, "s3://bucket/r/out.mp4", "video/mp4"),
    ).rejects.toThrow("part failed");
    expect(s3.sent.at(-1)).toEqual({
      name: "AbortMultipartUploadCommand",
      input: { Bucket: "bucket", Key: "r/out.mp4", UploadId: "up-1" },
    });
    expect(s3.sent.some((c) => c.name === "CompleteMultipartUploadCommand")).toBe(false);
  });
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

type Slice = { index: number; startFrame: number; endFrame: number };
const slices = (edges: readonly number[]): Slice[] =>
  edges.slice(1).map((endFrame, index) => ({ index, startFrame: edges[index]!, endFrame }));

describe.skipIf(!hasFfmpeg)("stitchMp4InS3 on real chunks", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "hf-s3-stitch-"));
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

  /** Closed-GOP chunk shaped like renderChunk's: IDR at frame 0, no B-frames. */
  function encodeChunk(path: string, slice: Slice, rate: number): void {
    const frames = String(slice.endFrame - slice.startFrame);
    ffmpeg(
      `-f lavfi -i testsrc2=size=160x120:rate=${rate},trim=start_frame=${slice.startFrame}:end_frame=${slice.endFrame} -c:v libx264 -preset veryfast -g ${frames} -keyint_min ${frames} -sc_threshold 0 -bf 0 -x264-params scenecut=0:open-gop=0:repeat-headers=1 -pix_fmt yuv420p -avoid_negative_ts make_zero -y`
        .split(" ")
        .concat(path),
    );
  }

  const frames = (path: string) =>
    ffmpeg(["-i", path, "-map", "0:v", "-f", "framemd5", "-"])
      .split("\n")
      .filter((line) => line && !line.startsWith("#"));
  const pcm = (path: string) => ffmpeg(["-i", path, "-map", "0:a", "-f", "s16le", "-"]);
  const probe = (path: string) =>
    JSON.parse(
      run("ffprobe", [
        "-v",
        "error",
        "-count_packets",
        "-show_entries",
        "stream=codec_type,nb_read_packets,duration",
        "-of",
        "json",
        "--",
        path,
      ]),
    ).streams as { codec_type: string; nb_read_packets: string; duration: string }[];

  // Uneven chunks and a 1-frame tail; at 60 fps that tail is shorter than an AAC packet and owns
  // none, so its chunk has no audio track.
  it.each([
    ["30", 30, [0, 47, 90, 91]],
    ["60", 60, [0, 50, 51]],
  ] as const)(
    "assembles a faststart mp4 at %s fps with the frames and audio of today's join",
    async (name, rate, edges) => {
      const FPS = { num: rate, den: 1 };
      const CHUNKS = slices(edges);
      const TOTAL_FRAMES = edges.at(-1)!;
      const dir = join(root, name);
      mkdirSync(dir, { recursive: true });
      const audioPath = join(dir, "audio.m4a");
      ffmpeg(
        `-f lavfi -i aevalsrc=0.4*sin(2*PI*(220+40*t)*t):s=48000:d=${TOTAL_FRAMES / rate} -c:a aac -b:a 192k -y`
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
          dimensions: { fpsNum: rate, fpsDen: 1, width: 160, height: 120, format: "mp4" },
        }),
      );
      writeFileSync(join(planDir, "meta", "chunks.json"), JSON.stringify(CHUNKS));

      const s3 = new FakeS3(16 * 1024);
      const videoPaths: string[] = [];
      const chunkPaths: string[] = [];
      for (const slice of CHUNKS) {
        videoPaths.push(join(dir, `video-${slice.index}.mp4`));
        chunkPaths.push(join(dir, `chunk-${slice.index}.mp4`));
        encodeChunk(videoPaths[slice.index]!, slice, rate);
        await muxChunkWithAudio({
          videoPath: videoPaths[slice.index]!,
          audioPath,
          outputPath: chunkPaths[slice.index]!,
          chunks: CHUNKS,
          chunkIndex: slice.index,
          fps: FPS,
          timeoutMs: 60_000,
        });
        s3.objects.set(
          `s3://bucket/chunks/${slice.index}.mp4`,
          readFileSync(chunkPaths[slice.index]!),
        );
      }
      // The 60 fps tail owns no AAC packet, so its chunk carries video alone.
      const tailAudio = probe(chunkPaths.at(-1)!).some((s) => s.codec_type === "audio");
      expect(tailAudio).toBe(rate === 30);
      const uris = CHUNKS.map((slice) => `s3://bucket/chunks/${slice.index}.mp4`);
      // A 16 KiB part minimum makes these small chunks take every path S3 takes at 5 MiB.
      const result = await stitchMp4InS3(s3.asClient(), uris, "s3://bucket/out.mp4", {
        minPartBytes: 16 * 1024,
      });
      const outputPath = join(dir, "out.mp4");
      const output = s3.objects.get("s3://bucket/out.mp4")!;
      writeFileSync(outputPath, output);
      expect(result.fileSize).toBe(output.length);
      const sent = s3.sent.map((c) => c.name);
      expect(sent).toContain("UploadPartCopyCommand");
      expect(sent).toContain("UploadPartCommand");

      const check = spawnSync("ffprobe", ["-v", "error", "--", outputPath], { encoding: "utf-8" });
      expect([check.status, check.stderr]).toEqual([0, ""]);
      const topLevel: string[] = [];
      for (let at = 0; at < output.length; ) {
        topLevel.push(output.toString("latin1", at + 4, at + 8));
        const size = output.readUInt32BE(at);
        at += size === 1 ? Number(output.readBigUInt64BE(at + 8)) : size;
      }
      expect(topLevel).toEqual(["ftyp", "moov", "mdat"]);

      // The same chunks joined on disk give the same bytes.
      writeFileSync(
        join(planDir, "meta", "encoder.json"),
        JSON.stringify({ chunksCarryAudio: true }),
      );
      const localPath = join(dir, "local.mp4");
      await assemble(planDir, chunkPaths, null, localPath);
      expect(readFileSync(localPath).equals(output)).toBe(true);

      // Today's join: the video-only chunks plus the plan audio.
      writeFileSync(join(planDir, "meta", "encoder.json"), "{}");
      const referencePath = join(dir, "reference.mp4");
      await assemble(planDir, videoPaths, audioPath, referencePath);
      expect(frames(outputPath)).toEqual(frames(referencePath));
      expect(pcm(outputPath) === pcm(referencePath)).toBe(true);

      const [video, sound] = probe(outputPath);
      const audioPackets = probe(audioPath)[0]!.nb_read_packets;
      expect([video!.nb_read_packets, sound!.nb_read_packets]).toEqual([
        String(TOTAL_FRAMES),
        audioPackets,
      ]);
      // Same lengths as today's mux: the edit lists trim only the AAC priming (both round
      // through the 1000-tick movie timescale).
      const reference = probe(referencePath);
      expect([video!.duration, sound!.duration]).toEqual([
        reference[0]!.duration,
        reference[1]!.duration,
      ]);

      // Video-only chunks with the plan audio as a separate object: the same bytes as on disk,
      // and the same frames and audio as today's join.
      s3.objects.set("s3://bucket/audio.m4a", readFileSync(audioPath));
      for (const [i, path] of videoPaths.entries()) {
        s3.objects.set(`s3://bucket/video/${i}.mp4`, readFileSync(path));
      }
      await stitchMp4InS3(
        s3.asClient(),
        videoPaths.map((_, i) => `s3://bucket/video/${i}.mp4`),
        "s3://bucket/separate.mp4",
        { audioUri: "s3://bucket/audio.m4a", minPartBytes: 16 * 1024 },
      );
      writeFileSync(join(planDir, "meta", "encoder.json"), JSON.stringify({ separateAudio: true }));
      const separateLocal = join(dir, "separate-local.mp4");
      await assemble(planDir, videoPaths, audioPath, separateLocal);
      const separate = s3.objects.get("s3://bucket/separate.mp4")!;
      expect(separate.equals(readFileSync(separateLocal))).toBe(true);
      expect(frames(separateLocal)).toEqual(frames(referencePath));
      expect(pcm(separateLocal) === pcm(referencePath)).toBe(true);
    },
    60_000,
  );
});
