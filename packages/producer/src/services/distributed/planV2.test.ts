import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { planFileSha256, recomputePlanHashFromPlanDir } from "../render/stages/freezePlan.js";
import { canonicalJsonStringify, sha256Hex } from "../render/stages/planHash.js";
import { chunkAudioSlicePath } from "./chunkAudio.js";
import { buildLocalExecutionPlan } from "./plan.js";
import { CURRENT_PLAN_PROTOCOL } from "./planProtocol.js";
import { FFMPEG_VERSION_MISMATCH, renderChunk, RenderChunkValidationError } from "./renderChunk.js";
import {
  createPlanV2FromV1,
  createPlanV2FromExecutionPlan,
  getPlanV2ExecutionPlanHash,
  listPlanV2ArtifactsForTarget,
  materializePlanV2Target,
  PLAN_V2_INTEGRITY_UNRECOVERABLE,
  PlanV2IntegrityError,
  publishPlanV2FromV1,
  publishPlanV2FromExecutionPlan,
  type PlanV2Manifest,
  planV2WithPublisher,
  readPlanV2Manifest,
  readValidatedPlanV2Materialization,
  validatePlanV2MaterializedTarget,
} from "./planV2.js";
import { planV2BlobPath } from "./planV2Layout.js";
import { LocalPlanV2ArtifactPublisher, type PlanV2ArtifactPublisher } from "./planV2Publisher.js";
import { buildPlanVideosJson, isPlanAudioArtifactPath, type PlanVideosJson } from "./shared.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempPath(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(root);
  return root;
}

function refreshV1PlanHash(planDir: string): void {
  const planPath = join(planDir, "plan.json");
  const planJson = JSON.parse(readFileSync(planPath, "utf-8")) as Record<string, unknown>;
  planJson.planHash = recomputePlanHashFromPlanDir(planDir);
  writeFileSync(planPath, JSON.stringify(planJson), "utf-8");
}

function createV1Plan(
  root: string,
  options?: {
    audio?: boolean;
    chunksCarryAudio?: boolean;
    video?: boolean;
    omitVideoMetadata?: boolean;
    fpsNum?: number;
    fpsDen?: number;
    videoColorSpace?: unknown;
    videoCodec?: string;
    videoId?: string;
    videoSrcPath?: string;
    framePattern?: string;
    videoStart?: number;
    videoEnd?: number;
    /** Ship this planDir-relative source instead of extracted frames. */
    deferredSource?: string;
  },
): string {
  const {
    audio = false,
    chunksCarryAudio = false,
    video = false,
    omitVideoMetadata = false,
    fpsNum = 30,
    fpsDen = 1,
    videoColorSpace = null,
    videoCodec = "h264",
    videoId = "hero",
    videoSrcPath = "/fixture/hero.mp4",
    framePattern = "frame_%05d.jpg",
    videoStart = 0,
    videoEnd = 1,
    deferredSource,
  } = options ?? {};
  const planDir = join(root, "v1");
  mkdirSync(join(planDir, "compiled"), { recursive: true });
  mkdirSync(join(planDir, "meta"), { recursive: true });
  writeFileSync(join(planDir, "compiled", "index.html"), "<html>v2 fixture</html>");
  writeFileSync(join(planDir, "compiled", "asset.txt"), "shared asset");
  writeFileSync(
    join(planDir, "meta", "chunks.json"),
    JSON.stringify([
      { index: 0, startFrame: 0, endFrame: 1 },
      { index: 1, startFrame: 1, endFrame: 2 },
    ]),
  );
  writeFileSync(
    join(planDir, "meta", "encoder.json"),
    chunksCarryAudio ? JSON.stringify({ chunksCarryAudio: true }) : "{}",
  );
  writeFileSync(join(planDir, "meta", "composition.json"), "{}");
  if (video) {
    const framesDir = join(planDir, "video-frames", "hero");
    mkdirSync(framesDir, { recursive: true });
    if (deferredSource === undefined) {
      writeFileSync(join(framesDir, "frame_00001.jpg"), "frame zero");
      writeFileSync(join(framesDir, "frame_00002.jpg"), "frame one");
      writeFileSync(join(framesDir, "frame_00003.jpg"), "never rendered");
    } else if (!deferredSource.startsWith("..")) {
      mkdirSync(dirname(join(planDir, deferredSource)), { recursive: true });
      writeFileSync(join(planDir, deferredSource), "source video");
    }
    writeFileSync(
      join(planDir, "meta", "videos.json"),
      JSON.stringify({
        videos: [
          {
            id: videoId,
            src: "hero.mp4",
            start: videoStart,
            end: videoEnd,
            mediaStart: 0,
            loop: false,
            hasAudio: false,
          },
        ],
        extracted: [
          {
            videoId,
            srcPath: videoSrcPath,
            framePattern,
            fps: 30,
            totalFrames: 3,
            metadata: {
              durationSeconds: 1,
              videoStreamDurationSeconds: 1,
              width: 16,
              height: 16,
              fps: 30,
              videoCodec,
              hasAudio: false,
              isVFR: false,
              hasAlpha: false,
              colorSpace: videoColorSpace,
            },
            ...(deferredSource === undefined
              ? {}
              : {
                  deferredRange: {
                    sourcePath: deferredSource,
                    startTime: 0,
                    durationSeconds: 0.1,
                    format: "jpg",
                  },
                }),
          },
        ],
      }),
    );
    if (omitVideoMetadata) {
      rmSync(join(planDir, "meta", "videos.json"));
    }
  }
  if (audio) writeFileSync(join(planDir, "audio.m4a"), "assemble-only-audio");
  writeFileSync(
    join(planDir, "plan.json"),
    JSON.stringify({
      protocol: CURRENT_PLAN_PROTOCOL,
      planHash: "1".repeat(64),
      chunkCount: 2,
      totalFrames: 2,
      hasAudio: audio,
      ffmpegVersion: "ffmpeg fixture",
      producerVersion: "0.0.0-test",
      fontSnapshotSha: "font-snapshot-fixture",
      dimensions: {
        fpsNum,
        fpsDen,
        width: 16,
        height: 16,
        format: "mp4",
      },
    }),
  );
  refreshV1PlanHash(planDir);
  return planDir;
}

const slicedAudioPaths = (chunkIndex: number) => [
  chunkAudioSlicePath(chunkIndex),
  "audio-chunks/frame.m4a",
  "audio-chunks/layout.json",
];

function chunkAudioPaths(manifest: Readonly<PlanV2Manifest>, chunkIndex: number): string[] {
  return listPlanV2ArtifactsForTarget(manifest, { role: "chunk", chunkIndex })
    .map((artifact) => artifact.path)
    .filter((path) => path.includes("audio"))
    .sort();
}

describe("Plan v2 manifest", () => {
  it("is deterministic without changing the manifest or result wire shapes", () => {
    const root = tempPath("hf-plan-v2-determinism-");
    const v1 = createV1Plan(root, { audio: true });
    const first = createPlanV2FromExecutionPlan(v1, join(root, "v2-a"));
    const second = createPlanV2FromExecutionPlan(v1, join(root, "v2-b"));
    const serializedManifest = readFileSync(first.manifestPath, "utf-8");
    const manifest = JSON.parse(serializedManifest) as Record<string, unknown>;

    expect(first.planHash).toBe(second.planHash);
    expect(serializedManifest).toBe(readFileSync(second.manifestPath, "utf-8"));
    expect(first.planHash).not.toBe(first.sourcePlanV1Hash);
    expect(getPlanV2ExecutionPlanHash(first)).toBe(first.sourcePlanV1Hash);
    expect(first.planProtocol.schemaVersion).toBe(2);
    expect(first.limitations.videoDependencyMode).toBe("exact-rendered-frames");
    expect(Object.keys(first)).toEqual([
      "planDir",
      "manifestPath",
      "planProtocol",
      "planHash",
      "sourcePlanV1Hash",
      "chunkCount",
      "totalFrames",
      "fps",
      "width",
      "height",
      "format",
      "ffmpegVersion",
      "producerVersion",
      "limitations",
    ]);
    expect(Object.keys(manifest)).toEqual([
      "artifacts",
      "chunkCount",
      "ffmpegVersion",
      "format",
      "fps",
      "height",
      "limitations",
      "planHash",
      "producerVersion",
      "protocol",
      "sourcePlanV1Hash",
      "totalFrames",
      "width",
    ]);
    expect(Object.hasOwn(first, "executionPlanHash")).toBe(false);
    expect(Object.hasOwn(manifest, "executionPlanHash")).toBe(false);
  });

  it("keeps legacy conversion names as byte-identical compatibility aliases", async () => {
    const root = tempPath("hf-plan-v2-compat-aliases-");
    const executionPlanDir = createV1Plan(root, { audio: true });
    const canonical = createPlanV2FromExecutionPlan(executionPlanDir, join(root, "canonical"));
    const compatibility = createPlanV2FromV1(executionPlanDir, join(root, "compatibility"));
    const publisher = new LocalPlanV2ArtifactPublisher(join(root, "published"));
    const published = await publishPlanV2FromExecutionPlan(executionPlanDir, publisher);

    expect(readFileSync(canonical.manifestPath)).toEqual(readFileSync(compatibility.manifestPath));
    expect(getPlanV2ExecutionPlanHash(published)).toBe(getPlanV2ExecutionPlanHash(canonical));
    expect(published.sourcePlanV1Hash).toBe(canonical.sourcePlanV1Hash);
    expect(Object.hasOwn(published, "executionPlanHash")).toBe(false);
  });

  it("accepts and materializes the same bounded timing produced for v1", () => {
    const root = tempPath("hf-plan-v2-open-ended-video-");
    const v1 = createV1Plan(root, { video: true });
    const videosPath = join(v1, "meta", "videos.json");
    const fixture = JSON.parse(readFileSync(videosPath, "utf-8")) as PlanVideosJson;
    const bounded = buildPlanVideosJson({
      videos: [{ ...fixture.videos[0]!, end: Number.POSITIVE_INFINITY }],
      extracted: fixture.extracted,
      compositionEnd: 2,
    });
    writeFileSync(videosPath, JSON.stringify(bounded));
    refreshV1PlanHash(v1);

    const v2 = createPlanV2FromV1(v1, join(root, "v2"));
    const materialized = join(root, "chunk");
    materializePlanV2Target(v2.planDir, { role: "chunk", chunkIndex: 1 }, materialized);
    const materializedVideos = JSON.parse(
      readFileSync(join(materialized, "meta", "videos.json"), "utf-8"),
    ) as PlanVideosJson;

    expect(bounded.videos[0]?.end).toBe(2);
    expect(materializedVideos.videos).toEqual(bounded.videos);
  });

  it("rejects a stale v1 source hash before content-addressing its bytes", () => {
    const root = tempPath("hf-plan-v2-source-hash-");
    const v1 = createV1Plan(root);
    writeFileSync(join(v1, "compiled", "index.html"), "<html>tampered after freeze</html>");
    const destination = join(root, "v2");

    let caught: unknown;
    try {
      createPlanV2FromV1(v1, destination);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PlanV2IntegrityError);
    expect(caught).toHaveProperty("name", "PlanV2IntegrityError");
    expect(caught).toHaveProperty("code", PLAN_V2_INTEGRITY_UNRECOVERABLE);
    expect(caught).toHaveProperty(
      "message",
      expect.stringMatching(/execution plan content fingerprint does not match/),
    );
    expect(existsSync(destination)).toBe(false);
  });

  it("rejects symlinks instead of silently omitting them from the manifest", () => {
    if (process.platform === "win32") return;
    const root = tempPath("hf-plan-v2-symlink-");
    const v1 = createV1Plan(root);
    symlinkSync(join(v1, "compiled", "asset.txt"), join(v1, "compiled", "linked-asset.txt"));
    refreshV1PlanHash(v1);

    expect(() => createPlanV2FromV1(v1, join(root, "v2"))).toThrow(
      /symlinks and special files are not allowed/,
    );
  });

  it("rejects zero-based extracted-frame filenames before dependency selection", () => {
    const root = tempPath("hf-plan-v2-zero-based-frame-");
    const v1 = createV1Plan(root, { video: true });
    writeFileSync(join(v1, "video-frames", "hero", "frame_00000.jpg"), "zero based");
    refreshV1PlanHash(v1);

    expect(() => createPlanV2FromV1(v1, join(root, "v2"))).toThrow(
      /must use a 1-based safe integer/,
    );
  });

  it("omits the extraction-cache completion sentinel from exact frame dependencies", () => {
    const root = tempPath("hf-plan-v2-extraction-sentinel-");
    const v1 = createV1Plan(root, { video: true });
    writeFileSync(join(v1, "video-frames", "hero", ".hf-complete"), "");
    refreshV1PlanHash(v1);

    const result = createPlanV2FromV1(v1, join(root, "v2"));
    const manifest = readPlanV2Manifest(result.planDir);

    expect(result.limitations.videoDependencyMode).toBe("exact-rendered-frames");
    expect(manifest.artifacts.some((artifact) => artifact.path.endsWith("/.hf-complete"))).toBe(
      false,
    );
    expect(manifest.artifacts.some((artifact) => artifact.path.endsWith("/frame_00001.jpg"))).toBe(
      true,
    );
  });

  it("omits the extraction-cache completion sentinel from the full-source fallback", () => {
    const root = tempPath("hf-plan-v2-full-source-extraction-sentinel-");
    const v1 = createV1Plan(root, { video: true, omitVideoMetadata: true });
    writeFileSync(join(v1, "video-frames", "hero", ".hf-complete"), "");
    refreshV1PlanHash(v1);

    const result = createPlanV2FromV1(v1, join(root, "v2"));
    const manifest = readPlanV2Manifest(result.planDir);

    expect(result.limitations.videoDependencyMode).toBe("full-source-pack");
    expect(manifest.artifacts.some((artifact) => artifact.path.endsWith("/.hf-complete"))).toBe(
      false,
    );
    expect(manifest.artifacts.some((artifact) => artifact.path.endsWith("/frame_00003.jpg"))).toBe(
      true,
    );
  });

  it("keeps non-canonical completion-marker paths over-included in full-source mode", () => {
    const root = tempPath("hf-plan-v2-nested-extraction-sentinel-");
    const v1 = createV1Plan(root, { video: true, omitVideoMetadata: true });
    const nestedDir = join(v1, "video-frames", "hero", "nested");
    mkdirSync(nestedDir);
    writeFileSync(join(nestedDir, ".hf-complete"), "unknown future artifact");
    refreshV1PlanHash(v1);

    const result = createPlanV2FromV1(v1, join(root, "v2"));
    const manifest = readPlanV2Manifest(result.planDir);
    const nestedMarker = manifest.artifacts.find(
      (artifact) => artifact.path === "video-frames/hero/nested/.hf-complete",
    );

    expect(result.limitations.videoDependencyMode).toBe("full-source-pack");
    expect(nestedMarker).toEqual(expect.objectContaining({ chunks: "all", assembler: false }));
  });

  for (const omitVideoMetadata of [false, true]) {
    const dependencyMode = omitVideoMetadata ? "full-source" : "exact-dependency";
    for (const malformedSentinel of ["non-empty file", "directory", "symlink"]) {
      it(`rejects a ${malformedSentinel} extraction sentinel in ${dependencyMode} mode`, () => {
        if (malformedSentinel === "symlink" && process.platform === "win32") return;
        const root = tempPath(
          `hf-plan-v2-malformed-extraction-sentinel-${dependencyMode}-${malformedSentinel}-`,
        );
        const v1 = createV1Plan(root, { video: true, omitVideoMetadata });
        const sentinelPath = join(v1, "video-frames", "hero", ".hf-complete");
        if (malformedSentinel === "symlink") {
          symlinkSync(join(v1, "compiled", "asset.txt"), sentinelPath);
        } else if (malformedSentinel === "directory") {
          mkdirSync(sentinelPath);
          writeFileSync(join(sentinelPath, "unexpected"), "not cache metadata");
        } else {
          writeFileSync(sentinelPath, "not cache metadata");
        }
        refreshV1PlanHash(v1);

        expect(() => createPlanV2FromV1(v1, join(root, "v2"))).toThrow(
          ".hf-complete must be a zero-byte regular file",
        );
      });
    }
  }

  it("selects audio only for the assembler", () => {
    const root = tempPath("hf-plan-v2-targets-");
    const result = createPlanV2FromV1(createV1Plan(root, { audio: true }), join(root, "v2"));
    const manifest = readPlanV2Manifest(result.planDir);
    const chunk = listPlanV2ArtifactsForTarget(manifest, { role: "chunk", chunkIndex: 0 });
    const assembler = listPlanV2ArtifactsForTarget(manifest, { role: "assembler" });

    expect(chunk.some((artifact) => artifact.path === "audio.m4a")).toBe(false);
    expect(chunk.some((artifact) => artifact.path === "compiled/index.html")).toBe(true);
    expect(assembler.some((artifact) => artifact.path === "audio.m4a")).toBe(true);
    expect(assembler.some((artifact) => artifact.path === "compiled/index.html")).toBe(false);
  });

  it("sends audio to every chunk and not the assembler when mp4 chunks carry their audio", () => {
    const root = tempPath("hf-plan-v2-chunk-audio-targets-");
    const v1 = createV1Plan(root, { audio: true, chunksCarryAudio: true });
    const manifest = readPlanV2Manifest(createPlanV2FromV1(v1, join(root, "v2")).planDir);
    for (const chunkIndex of [0, 1]) {
      const chunk = listPlanV2ArtifactsForTarget(manifest, { role: "chunk", chunkIndex });
      expect(chunk.some((artifact) => artifact.path === "audio.m4a")).toBe(true);
    }
    const assembler = listPlanV2ArtifactsForTarget(manifest, { role: "assembler" });
    expect(assembler.some((artifact) => artifact.path === "audio.m4a")).toBe(false);
  });

  it("sends each chunk only its own audio slice when the plan cut one per chunk", () => {
    const root = tempPath("hf-plan-v2-chunk-audio-slices-");
    const v1 = createV1Plan(root, { audio: true, chunksCarryAudio: true });
    mkdirSync(join(v1, "audio-chunks"));
    writeFileSync(join(v1, "audio-chunks", "frame.m4a"), "moov");
    writeFileSync(join(v1, "audio-chunks", "layout.json"), "{}");
    for (const chunkIndex of [0, 1]) {
      writeFileSync(join(v1, chunkAudioSlicePath(chunkIndex)), `slice ${chunkIndex}`);
    }
    refreshV1PlanHash(v1);
    const manifest = readPlanV2Manifest(createPlanV2FromV1(v1, join(root, "v2")).planDir);
    for (const chunkIndex of [0, 1]) {
      expect(chunkAudioPaths(manifest, chunkIndex)).toEqual(slicedAudioPaths(chunkIndex));
    }
    const assembler = listPlanV2ArtifactsForTarget(manifest, { role: "assembler" });
    expect(assembler.some((artifact) => artifact.path.includes("audio"))).toBe(false);
  });

  it("uses the runtime frame lookup to select exact video frames per chunk", () => {
    const root = tempPath("hf-plan-v2-video-reachability-");
    const result = createPlanV2FromV1(createV1Plan(root, { video: true }), join(root, "v2"));
    const manifest = readPlanV2Manifest(result.planDir);
    const chunk0 = listPlanV2ArtifactsForTarget(manifest, { role: "chunk", chunkIndex: 0 });
    const chunk1 = listPlanV2ArtifactsForTarget(manifest, { role: "chunk", chunkIndex: 1 });

    expect(manifest.limitations.videoDependencyMode).toBe("exact-rendered-frames");
    expect(chunk0.some((artifact) => artifact.path.endsWith("frame_00001.jpg"))).toBe(true);
    expect(chunk0.some((artifact) => artifact.path.endsWith("frame_00002.jpg"))).toBe(false);
    expect(chunk1.some((artifact) => artifact.path.endsWith("frame_00002.jpg"))).toBe(true);
    expect(manifest.artifacts.some((artifact) => artifact.path.endsWith("frame_00003.jpg"))).toBe(
      false,
    );
  });

  it("ships a deferred video's source only to the chunks that show it", () => {
    const root = tempPath("hf-plan-v2-deferred-source-");
    const v1 = createV1Plan(root, {
      video: true,
      videoStart: 1 / 30,
      deferredSource: "video-sources/0.mp4",
    });
    const manifest = readPlanV2Manifest(createPlanV2FromV1(v1, join(root, "v2")).planDir);
    const chunk0 = listPlanV2ArtifactsForTarget(manifest, { role: "chunk", chunkIndex: 0 });
    const chunk1 = listPlanV2ArtifactsForTarget(manifest, { role: "chunk", chunkIndex: 1 });
    const assembler = listPlanV2ArtifactsForTarget(manifest, { role: "assembler" });

    expect(manifest.limitations.videoDependencyMode).toBe("source-extract");
    expect(chunk0.some((artifact) => artifact.path === "video-sources/0.mp4")).toBe(false);
    expect(chunk1.some((artifact) => artifact.path === "video-sources/0.mp4")).toBe(true);
    expect(assembler.some((artifact) => artifact.path === "video-sources/0.mp4")).toBe(false);
    expect(manifest.artifacts.some((artifact) => artifact.path.startsWith("video-frames/"))).toBe(
      false,
    );
  });

  it("ships each compiled/ video source only to the chunks that show it", () => {
    const root = tempPath("hf-plan-v2-deferred-compiled-source-");
    const v1 = createV1Plan(root, {
      video: true,
      videoStart: 1 / 30,
      deferredSource: "compiled/hero.mp4",
    });
    // A second clip shown in both chunks, also shipped from compiled/.
    const videosPath = join(v1, "meta", "videos.json");
    const videos = JSON.parse(readFileSync(videosPath, "utf-8")) as PlanVideosJson;
    const hero = videos.extracted[0]!;
    videos.videos.push({ ...videos.videos[0]!, id: "long", src: "long.mp4", start: 0 });
    videos.extracted.push({
      ...hero,
      videoId: "long",
      deferredRange: { ...hero.deferredRange!, sourcePath: "compiled/long.mp4" },
    });
    writeFileSync(videosPath, JSON.stringify(videos));
    writeFileSync(join(v1, "compiled", "long.mp4"), "long source video");
    refreshV1PlanHash(v1);
    const manifest = readPlanV2Manifest(createPlanV2FromV1(v1, join(root, "v2")).planDir);
    const chunksOf = (path: string) =>
      manifest.artifacts.find((artifact) => artifact.path === path)?.chunks;

    expect(manifest.limitations.videoDependencyMode).toBe("source-extract");
    expect(chunksOf("compiled/hero.mp4")).toEqual([1]);
    expect(chunksOf("compiled/long.mp4")).toEqual([0, 1]);
    expect(chunksOf("compiled/index.html")).toBe("all");
    expect(chunksOf("compiled/asset.txt")).toBe("all");

    const chunk0Dir = join(root, "chunk-0");
    materializePlanV2Target(join(root, "v2"), { role: "chunk", chunkIndex: 0 }, chunk0Dir);
    expect(existsSync(join(chunk0Dir, "compiled", "hero.mp4"))).toBe(false);
    expect(existsSync(join(chunk0Dir, "compiled", "long.mp4"))).toBe(true);
    expect(validatePlanV2MaterializedTarget(chunk0Dir, { role: "chunk", chunkIndex: 0 })).not.toBe(
      null,
    );

    // A source read by URL is neither verified locally nor copied, and is recorded for the chunk.
    const longDigest = manifest.artifacts.find((a) => a.path === "compiled/long.mp4")!.sha256;
    rmSync(planV2BlobPath(join(root, "v2"), longDigest));
    const remoteSources = { "compiled/long.mp4": "https://example.test/long.mp4" };
    const byUrlDir = join(root, "chunk-0-by-url");
    const chunk0 = { role: "chunk", chunkIndex: 0 } as const;
    materializePlanV2Target(join(root, "v2"), chunk0, byUrlDir, { remoteSources });
    expect(existsSync(join(byUrlDir, "compiled", "long.mp4"))).toBe(false);
    expect(readValidatedPlanV2Materialization(byUrlDir, chunk0)?.remoteSources).toEqual(
      remoteSources,
    );
    expect(() =>
      materializePlanV2Target(join(root, "v2"), chunk0, join(root, "chunk-0-stray"), {
        remoteSources: { "compiled/index.html": "https://example.test/index.html" },
      }),
    ).toThrow(/not a selected deferred video/);
  });

  it("rejects a deferred video source outside the plan directory", () => {
    const root = tempPath("hf-plan-v2-deferred-escape-");
    const v1 = createV1Plan(root, { video: true, deferredSource: "../outside.mp4" });
    expect(() => createPlanV2FromV1(v1, join(root, "v2"))).toThrow(PlanV2IntegrityError);
  });

  it("gives a chunk the frames of a video starting a hair after its frame, as export shows it", () => {
    const root = tempPath("hf-plan-v2-snapped-start-");
    const v1 = createV1Plan(root, { video: true, videoStart: 1 / 30 + 1e-6, videoEnd: 1 });
    const manifest = readPlanV2Manifest(createPlanV2FromV1(v1, join(root, "v2")).planDir);
    const chunk1 = listPlanV2ArtifactsForTarget(manifest, { role: "chunk", chunkIndex: 1 });

    expect(chunk1.some((artifact) => artifact.path === "video-frames/hero/frame_00001.jpg")).toBe(
      true,
    );
  });

  it("materializes empty video directories for chunks where the video is inactive", () => {
    const root = tempPath("hf-plan-v2-inactive-video-directory-");
    const v1 = createV1Plan(root, {
      video: true,
      videoStart: 1 / 30,
      videoEnd: 1,
    });
    const result = createPlanV2FromV1(v1, join(root, "v2"));
    const manifest = readPlanV2Manifest(result.planDir);
    const chunk0Artifacts = listPlanV2ArtifactsForTarget(manifest, {
      role: "chunk",
      chunkIndex: 0,
    });
    const chunk1Artifacts = listPlanV2ArtifactsForTarget(manifest, {
      role: "chunk",
      chunkIndex: 1,
    });
    const chunk0Dir = join(root, "chunk-0");
    const chunk1Dir = join(root, "chunk-1");

    expect(chunk0Artifacts.some((artifact) => artifact.path.startsWith("video-frames/hero/"))).toBe(
      false,
    );
    expect(
      chunk1Artifacts.some((artifact) => artifact.path === "video-frames/hero/frame_00001.jpg"),
    ).toBe(true);

    materializePlanV2Target(result.planDir, { role: "chunk", chunkIndex: 0 }, chunk0Dir);
    materializePlanV2Target(result.planDir, { role: "chunk", chunkIndex: 1 }, chunk1Dir);

    expect(existsSync(join(chunk0Dir, "video-frames", "hero"))).toBe(true);
    expect(readdirSync(join(chunk0Dir, "video-frames", "hero"))).toEqual([]);
    expect(existsSync(join(chunk1Dir, "video-frames", "hero", "frame_00001.jpg"))).toBe(true);
  });

  const partialColorSpaceCases = [
    {
      name: "matrix-only",
      colorSpace: { colorTransfer: "", colorPrimaries: "", colorSpace: "bt709" },
    },
    {
      name: "transfer-only",
      colorSpace: { colorTransfer: "bt709", colorPrimaries: "", colorSpace: "" },
    },
    {
      name: "primaries-only",
      colorSpace: { colorTransfer: "", colorPrimaries: "bt709", colorSpace: "" },
    },
  ];

  for (const testCase of partialColorSpaceCases) {
    it(`preserves ${testCase.name} video color metadata`, () => {
      const root = tempPath(`hf-plan-v2-${testCase.name}-color-`);
      const result = createPlanV2FromV1(
        createV1Plan(root, { video: true, videoColorSpace: testCase.colorSpace }),
        join(root, "v2"),
      );
      const materializedDir = join(root, "materialized");
      materializePlanV2Target(result.planDir, { role: "chunk", chunkIndex: 0 }, materializedDir);

      expect(
        JSON.parse(readFileSync(join(materializedDir, "meta", "videos.json"), "utf-8")),
      ).toEqual(
        expect.objectContaining({
          extracted: [
            expect.objectContaining({
              metadata: expect.objectContaining({ colorSpace: testCase.colorSpace }),
            }),
          ],
        }),
      );
    });
  }

  it("preserves null video color metadata", () => {
    const root = tempPath("hf-plan-v2-null-color-");
    expect(() =>
      createPlanV2FromV1(
        createV1Plan(root, { video: true, videoColorSpace: null }),
        join(root, "v2"),
      ),
    ).not.toThrow();
  });

  const colorComponents = ["colorTransfer", "colorPrimaries", "colorSpace"];
  const invalidColorValues: Array<{ name: string; value: unknown }> = [
    { name: "missing", value: undefined },
    { name: "null", value: null },
    { name: "number", value: 709 },
    { name: "object", value: { name: "bt709" } },
  ];

  for (const component of colorComponents) {
    for (const invalid of invalidColorValues) {
      it(`rejects a ${invalid.name} ${component} color component`, () => {
        const root = tempPath(`hf-plan-v2-invalid-${component}-${invalid.name}-`);
        const colorSpace: Record<string, unknown> = {
          colorTransfer: "bt709",
          colorPrimaries: "bt709",
          colorSpace: "bt709",
        };
        colorSpace[component] = invalid.value;
        const v1 = createV1Plan(root, { video: true, videoColorSpace: colorSpace });

        expect(() => createPlanV2FromV1(v1, join(root, "v2"))).toThrow(
          `metadata.colorSpace.${component} must be a string`,
        );
      });
    }
  }

  const unrelatedEmptyStringCases = [
    {
      name: "video codec",
      options: { videoCodec: "" },
      field: "metadata.videoCodec",
    },
    {
      name: "video identifier",
      options: { videoId: "" },
      field: "videos[0].id",
    },
    {
      name: "video source path",
      options: { videoSrcPath: "" },
      field: "srcPath",
    },
    {
      name: "frame pattern",
      options: { framePattern: "" },
      field: "framePattern",
    },
  ];

  for (const testCase of unrelatedEmptyStringCases) {
    it(`continues to reject an empty ${testCase.name}`, () => {
      const root = tempPath(`hf-plan-v2-empty-${testCase.name.replaceAll(" ", "-")}-`);
      const v1 = createV1Plan(root, { video: true, ...testCase.options });

      expect(() => createPlanV2FromV1(v1, join(root, "v2"))).toThrow(
        `${testCase.field} must be a non-empty string`,
      );
    });
  }

  it("rejects an extracted video identifier that escapes the video-frame root", () => {
    const root = tempPath("hf-plan-v2-unsafe-video-id-");
    const v1 = createV1Plan(root, { video: true, videoId: "../escape" });

    expect(() => createPlanV2FromV1(v1, join(root, "v2"))).toThrow(
      'unsafe extracted video id: "../escape"',
    );
  });

  it("falls back to the full source frame pack when video metadata is absent", () => {
    const root = tempPath("hf-plan-v2-video-fallback-");
    const result = createPlanV2FromV1(
      createV1Plan(root, { video: true, omitVideoMetadata: true }),
      join(root, "v2"),
    );
    const manifest = readPlanV2Manifest(result.planDir);
    const chunk0 = listPlanV2ArtifactsForTarget(manifest, { role: "chunk", chunkIndex: 0 });
    const chunk1 = listPlanV2ArtifactsForTarget(manifest, { role: "chunk", chunkIndex: 1 });

    expect(result.limitations.videoDependencyMode).toBe("full-source-pack");
    expect(manifest.limitations.videoDependencyMode).toBe("full-source-pack");
    for (const frameName of ["frame_00001.jpg", "frame_00002.jpg", "frame_00003.jpg"]) {
      expect(chunk0.some((artifact) => artifact.path.endsWith(frameName))).toBe(true);
      expect(chunk1.some((artifact) => artifact.path.endsWith(frameName))).toBe(true);
    }
  });

  it("rejects malformed v1 video and chunk metadata at the JSON boundary", () => {
    const videosRoot = tempPath("hf-plan-v2-malformed-videos-");
    const videosPlan = createV1Plan(videosRoot, { video: true });
    const videosPath = join(videosPlan, "meta", "videos.json");
    const videosJson = JSON.parse(readFileSync(videosPath, "utf-8")) as {
      videos: Array<Record<string, unknown>>;
    };
    delete videosJson.videos[0]?.hasAudio;
    writeFileSync(videosPath, JSON.stringify(videosJson), "utf-8");
    refreshV1PlanHash(videosPlan);
    expect(() => createPlanV2FromV1(videosPlan, join(videosRoot, "v2"))).toThrow(
      /videos\[0\]\.hasAudio must be boolean/,
    );

    const chunksRoot = tempPath("hf-plan-v2-malformed-chunks-");
    const chunksPlan = createV1Plan(chunksRoot, { video: true });
    writeFileSync(
      join(chunksPlan, "meta", "chunks.json"),
      JSON.stringify([{ index: 0, startFrame: 1, endFrame: 1 }]),
      "utf-8",
    );
    refreshV1PlanHash(chunksPlan);
    expect(() => createPlanV2FromV1(chunksPlan, join(chunksRoot, "v2"))).toThrow(
      /endFrame must be greater than startFrame/,
    );
  });

  it("rejects a fractional v1 fps contract that v2 cannot represent", () => {
    const root = tempPath("hf-plan-v2-fps-den-");
    const v1 = createV1Plan(root, { fpsDen: 1001 });
    expect(() => createPlanV2FromV1(v1, join(root, "v2"))).toThrow("dimensions.fpsDen must be 1");
  });

  it("carries 25 fps through the manifest it writes and reads back", () => {
    const root = tempPath("hf-plan-v2-fps-25-");
    const v1 = createV1Plan(root, { fpsNum: 25 });
    const manifest = readPlanV2Manifest(createPlanV2FromV1(v1, join(root, "v2")).planDir);
    expect(manifest.fps).toBe(25);
  });

  it("rejects an fps outside the distributed set", () => {
    const root = tempPath("hf-plan-v2-fps-50-");
    const v1 = createV1Plan(root, { fpsNum: 50 });
    expect(() => createPlanV2FromV1(v1, join(root, "v2"))).toThrow(
      "dimensions.fpsNum must be one of 24, 25, 30, 60",
    );
  });

  it("materializes and revalidates strict chunk and assembler subsets", () => {
    const root = tempPath("hf-plan-v2-materialize-");
    const result = createPlanV2FromV1(createV1Plan(root, { audio: true }), join(root, "v2"));
    const chunkDir = join(root, "chunk");
    const assemblerDir = join(root, "assembler");
    const chunk = materializePlanV2Target(
      result.planDir,
      { role: "chunk", chunkIndex: 1 },
      chunkDir,
    );
    const assembler = materializePlanV2Target(result.planDir, { role: "assembler" }, assemblerDir);

    expect(existsSync(join(chunkDir, "audio.m4a"))).toBe(false);
    expect(
      validatePlanV2MaterializedTarget(chunkDir, { role: "chunk", chunkIndex: 1 })?.planHash,
    ).toBe(result.planHash);
    expect(assembler.audioPath).toBe(join(assemblerDir, "audio.m4a"));
    expect(validatePlanV2MaterializedTarget(assemblerDir, { role: "assembler" })?.planHash).toBe(
      result.planHash,
    );
    expect(chunk.sourcePlanV1Hash).toBe(result.sourcePlanV1Hash);
    expect(Object.keys(chunk)).toEqual([
      "planDir",
      "target",
      "planHash",
      "sourcePlanV1Hash",
      "artifactCount",
      "sizeBytes",
      "audioPath",
    ]);
    expect(Object.hasOwn(chunk, "executionPlanHash")).toBe(false);
  });

  it("uses v2 subset integrity instead of the whole-v1 plan hash", async () => {
    const root = tempPath("hf-plan-v2-subset-hash-");
    const result = createPlanV2FromV1(createV1Plan(root, { audio: true }), join(root, "v2"));
    const chunkDir = join(root, "chunk");
    materializePlanV2Target(result.planDir, { role: "chunk", chunkIndex: 0 }, chunkDir);

    let caught: unknown;
    try {
      await renderChunk(chunkDir, 0, join(root, "unused-output.mp4"));
    } catch (error) {
      caught = error;
    }
    // Reaching the ffmpeg probe proves the missing assembler-only audio did
    // not trigger the v1 aggregate hash gate. Full CI installs no ffmpeg for
    // the unit lane, while developer/render environments reach the deliberate
    // version mismatch; both are valid stops before Chrome.
    if (caught instanceof RenderChunkValidationError) {
      expect(caught.code).toBe(FFMPEG_VERSION_MISMATCH);
    } else {
      expect(caught).toBeInstanceOf(Error);
      expect(caught).toHaveProperty("code", "ENOENT");
    }
  });

  it("rejects missing and corrupted blobs before publishing a destination", () => {
    const root = tempPath("hf-plan-v2-corrupt-");
    const result = createPlanV2FromV1(createV1Plan(root), join(root, "v2"));
    const manifest = readPlanV2Manifest(result.planDir);
    const artifact = listPlanV2ArtifactsForTarget(manifest, {
      role: "chunk",
      chunkIndex: 0,
    })[0]!;
    const blob = join(
      result.planDir,
      "artifacts",
      "sha256",
      artifact.sha256.slice(0, 2),
      artifact.sha256,
    );
    writeFileSync(blob, "corrupt");
    const destination = join(root, "never-published");

    expect(() =>
      materializePlanV2Target(result.planDir, { role: "chunk", chunkIndex: 0 }, destination),
    ).toThrow(/artifact (size|hash) mismatch/);
    expect(existsSync(destination)).toBe(false);
  });

  it("rejects manifest and post-materialization tampering", () => {
    const root = tempPath("hf-plan-v2-tamper-");
    const result = createPlanV2FromV1(createV1Plan(root), join(root, "v2"));
    const chunkDir = join(root, "chunk");
    materializePlanV2Target(result.planDir, { role: "chunk", chunkIndex: 0 }, chunkDir);
    writeFileSync(join(chunkDir, "compiled", "index.html"), "tampered");
    let materializedError: unknown;
    try {
      validatePlanV2MaterializedTarget(chunkDir, { role: "chunk", chunkIndex: 0 });
    } catch (error) {
      materializedError = error;
    }
    expect(materializedError).toBeInstanceOf(PlanV2IntegrityError);
    expect(materializedError).toHaveProperty("code", PLAN_V2_INTEGRITY_UNRECOVERABLE);
    expect(materializedError).toHaveProperty(
      "message",
      expect.stringMatching(/materialized artifact (hash mismatch|missing or truncated)/),
    );

    const manifestPath = result.manifestPath;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
    manifest.totalFrames = 999;
    writeFileSync(manifestPath, canonicalJsonStringify(manifest));
    expect(() => readPlanV2Manifest(result.planDir)).toThrow("manifest integrity hash mismatch");
  });

  it("rejects a missing content-addressed artifact", () => {
    const root = tempPath("hf-plan-v2-missing-");
    const result = createPlanV2FromV1(createV1Plan(root), join(root, "v2"));
    const manifest = readPlanV2Manifest(result.planDir);
    const artifact = manifest.artifacts[0]!;
    const blob = join(
      result.planDir,
      "artifacts",
      "sha256",
      artifact.sha256.slice(0, 2),
      artifact.sha256,
    );
    rmSync(blob);
    expect(() =>
      materializePlanV2Target(
        result.planDir,
        { role: "chunk", chunkIndex: 0 },
        join(root, "destination"),
      ),
    ).toThrow("missing content-addressed artifact");
  });
});

describe("Plan v2 artifact publisher", () => {
  it("publishes the manifest last and hard-links local immutable blobs", async () => {
    const root = tempPath("hf-plan-v2-publisher-");
    const v1 = createV1Plan(root, { audio: true });
    const destination = join(root, "v2");
    const publisher = new LocalPlanV2ArtifactPublisher(destination);
    const manifest = await publishPlanV2FromExecutionPlan(v1, publisher);
    const artifact = manifest.artifacts.find(
      (candidate) => candidate.path === "compiled/asset.txt",
    );
    if (artifact === undefined) throw new Error("test fixture is missing compiled/asset.txt");
    const sourceStat = statSync(join(v1, artifact.path));
    const blobStat = statSync(
      join(destination, "artifacts", "sha256", artifact.sha256.slice(0, 2), artifact.sha256),
    );

    expect(readPlanV2Manifest(destination)).toEqual(manifest);
    expect({ dev: blobStat.dev, ino: blobStat.ino }).toEqual({
      dev: sourceStat.dev,
      ino: sourceStat.ino,
    });
  });

  it("falls back to an atomic copy when hard-linking is unavailable", async () => {
    const root = tempPath("hf-plan-v2-publisher-copy-");
    const v1 = createV1Plan(root);
    const destination = join(root, "v2");
    const publisher = new LocalPlanV2ArtifactPublisher(destination, {
      linkFile() {
        throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
      },
    });
    const manifest = await publishPlanV2FromV1(v1, publisher);
    const artifact = manifest.artifacts.find(
      (candidate) => candidate.path === "compiled/asset.txt",
    );
    if (artifact === undefined) throw new Error("test fixture is missing compiled/asset.txt");
    const sourcePath = join(v1, artifact.path);
    const blobPath = join(
      destination,
      "artifacts",
      "sha256",
      artifact.sha256.slice(0, 2),
      artifact.sha256,
    );

    expect(readFileSync(blobPath)).toEqual(readFileSync(sourcePath));
    expect({ dev: statSync(blobPath).dev, ino: statSync(blobPath).ino }).not.toEqual({
      dev: statSync(sourcePath).dev,
      ino: statSync(sourcePath).ino,
    });
  });

  it("produces byte-identical local CAS output through both publication paths", async () => {
    const root = tempPath("hf-plan-v2-publisher-parity-");
    const v1 = createV1Plan(root, { audio: true });
    const directDir = join(root, "direct");
    const publishedDir = join(root, "published");
    createPlanV2FromV1(v1, directDir);
    const publisher = new LocalPlanV2ArtifactPublisher(publishedDir);
    const manifest = await publishPlanV2FromV1(v1, publisher);

    expect(readFileSync(join(publishedDir, "plan.json"))).toEqual(
      readFileSync(join(directDir, "plan.json")),
    );
    for (const artifact of manifest.artifacts) {
      const suffix = join("artifacts", "sha256", artifact.sha256.slice(0, 2), artifact.sha256);
      expect(readFileSync(join(publishedDir, suffix))).toEqual(
        readFileSync(join(directDir, suffix)),
      );
    }
  });

  it("supports a remote publisher contract with no shared destination filesystem", async () => {
    const root = tempPath("hf-plan-v2-remote-publisher-");
    const v1 = createV1Plan(root, { audio: true });
    const blobs = new Map<string, Buffer>();
    let committedManifest: string | undefined;
    const publisher: PlanV2ArtifactPublisher = {
      async putBlob(blob) {
        blobs.set(blob.sha256, readFileSync(blob.sourcePath));
      },
      async commitManifest(manifestBytes) {
        committedManifest = manifestBytes;
      },
      async abort() {},
    };

    const manifest = await publishPlanV2FromV1(v1, publisher);
    expect(committedManifest).toBe(canonicalJsonStringify(manifest));
    expect(blobs.size).toBe(new Set(manifest.artifacts.map((artifact) => artifact.sha256)).size);
    for (const artifact of manifest.artifacts) {
      expect(blobs.get(artifact.sha256)?.byteLength).toBe(artifact.sizeBytes);
    }
  });

  it("rejects malformed digests before constructing a local CAS path", async () => {
    const root = tempPath("hf-plan-v2-publisher-digest-");
    const sourcePath = join(root, "source");
    writeFileSync(sourcePath, "bytes");
    const publisher = new LocalPlanV2ArtifactPublisher(join(root, "v2"));

    await expect(
      publisher.putBlob({ sourcePath, sha256: "../escape", sizeBytes: 5 }),
    ).rejects.toThrow("must be a lowercase sha256 digest");
    await publisher.abort();
  });

  it("refuses to commit a manifest until every referenced blob is durable", async () => {
    const root = tempPath("hf-plan-v2-publisher-incomplete-");
    const publisher = new LocalPlanV2ArtifactPublisher(join(root, "v2"));
    const digest = "a".repeat(64);

    await expect(
      publisher.commitManifest(JSON.stringify({ artifacts: [{ sha256: digest }] })),
    ).rejects.toThrow("cannot commit manifest before referenced blob is durable");
    await publisher.abort();
  });

  it("keeps publishing the other blobs while one upload is slow", async () => {
    const root = tempPath("hf-plan-v2-publisher-slow-");
    const v1 = createV1Plan(root);
    for (let i = 0; i < 40; i++)
      writeFileSync(join(v1, "compiled", `frame-${i}.txt`), `frame ${i}`);
    refreshV1PlanHash(v1);
    const manifest = await publishPlanV2FromV1(v1, {
      async commitManifest() {},
      async abort() {},
      putBlob: (() => {
        let started = 0;
        let releaseSlow: (byOthers: boolean) => void = () => {};
        const slow = new Promise<boolean>((resolve) => (releaseSlow = resolve));
        setTimeout(() => releaseSlow(false), 2_000);
        return async () => {
          started += 1;
          if (started === 1) {
            expect(await slow).toBe(true);
            return;
          }
          if (started === 41) releaseSlow(true);
        };
      })(),
    });
    expect(manifest.artifacts.length).toBeGreaterThan(40);
  });

  it("aborts without committing a manifest when a blob publish fails", async () => {
    const root = tempPath("hf-plan-v2-publisher-failure-");
    const calls: string[] = [];
    const publisher: PlanV2ArtifactPublisher = {
      async putBlob(blob) {
        calls.push(`blob:${blob.sha256}`);
        throw new Error("injected blob failure");
      },
      async commitManifest() {
        calls.push("manifest");
      },
      async abort() {
        calls.push("abort");
      },
    };

    await expect(publishPlanV2FromV1(createV1Plan(root), publisher)).rejects.toThrow(
      "injected blob failure",
    );
    expect(calls.at(-1)).toBe("abort");
    expect(calls).not.toContain("manifest");
  });
});

describe("Plan v2 planning", () => {
  const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;

  it("reuses a digest taken earlier in the plan instead of rehashing the file", () => {
    const planDir = createV1Plan(tempPath("hf-plan-v2-digests-"));
    const asset = join(planDir, "compiled", "asset.txt");
    const digests = new Map([[asset, "f".repeat(64)]]);

    expect(planFileSha256(asset, digests)).toBe("f".repeat(64));
    expect(recomputePlanHashFromPlanDir(planDir, digests)).not.toBe(
      recomputePlanHashFromPlanDir(planDir),
    );
  });

  it.skipIf(!HAS_FFMPEG)(
    "publishes the compiled tree while the audio mixes, with the serial manifest",
    async () => {
      const root = tempPath("hf-plan-v2-overlap-");
      const projectDir = join(root, "project");
      const stagingParentDir = join(root, "staging");
      mkdirSync(projectDir);
      mkdirSync(stagingParentDir);
      const silence = spawnSync("ffmpeg", [
        ...["-nostdin", "-v", "error", "-f", "lavfi"],
        ...["-i", "anullsrc=channel_layout=mono:sample_rate=44100", "-t", "1"],
        ...["-c:a", "pcm_s16le", join(projectDir, "silence.wav")],
      ]);
      expect(silence.status).toBe(0);
      writeFileSync(join(projectDir, "poster.bin"), Buffer.alloc(1 << 20, 7));
      writeFileSync(
        join(projectDir, "index.html"),
        `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <div data-composition-id="root" data-width="320" data-height="240" data-duration="1">
    <audio data-composition-audio src="silence.wav"></audio><p>overlap fixture</p>
  </div></body></html>`,
      );
      const config = { fps: 30 as const, width: 320, height: 240, format: "mp4" as const };

      const stages: string[] = [];
      const puts: Array<{ sha256: string; duringAudio: boolean }> = [];
      const local = new LocalPlanV2ArtifactPublisher(join(root, "overlapped"));
      const manifest = await planV2WithPublisher(
        projectDir,
        {
          ...config,
          logger: {
            info: (message, meta) => {
              if (message === "[plan] stage") stages.push(String(meta?.stage));
            },
            debug() {},
            warn() {},
            error() {},
          },
        },
        {
          async putBlob(blob) {
            const staging = readdirSync(stagingParentDir).find((name) =>
              name.startsWith(".execution-plan-"),
            );
            const workDir = join(stagingParentDir, String(staging), ".plan-work");
            if (!puts.some((put) => put.sha256 === blob.sha256)) {
              puts.push({ sha256: blob.sha256, duringAudio: existsSync(workDir) });
            }
            await local.putBlob(blob);
          },
          commitManifest: (bytes) => local.commitManifest(bytes),
          abort: () => local.abort(),
        },
        { stagingParentDir },
      );

      const serialDir = join(root, "serial-plan");
      mkdirSync(serialDir);
      await buildLocalExecutionPlan(projectDir, config, serialDir, {
        executionPlanSizeLimitBytes: Number.MAX_SAFE_INTEGER,
        deferVideoExtraction: true,
      });
      const serial = await publishPlanV2FromExecutionPlan(
        serialDir,
        new LocalPlanV2ArtifactPublisher(join(root, "serial")),
      );
      expect(canonicalJsonStringify(manifest)).toBe(canonicalJsonStringify(serial));
      expect(manifest.artifacts.some((artifact) => isPlanAudioArtifactPath(artifact.path))).toBe(
        true,
      );

      const compiled = new Set(
        manifest.artifacts
          .filter((artifact) => artifact.path.startsWith("compiled/"))
          .map((artifact) => artifact.sha256),
      );
      const compiledPuts = puts.filter((put) => compiled.has(put.sha256));
      expect(compiled.size).toBeGreaterThan(1);
      expect(compiledPuts).toHaveLength(compiled.size);
      expect(compiledPuts.every((put) => put.duringAudio)).toBe(true);
      const referenced = new Set(manifest.artifacts.map((artifact) => artifact.sha256));
      expect(puts.every((put) => referenced.has(put.sha256))).toBe(true);
      expect(stages).toEqual(
        expect.arrayContaining([
          ...["copy", "compile", "probe", "extract", "audio", "prehash", "prepublish"],
          ...["freeze", "publication", "upload", "manifest"],
        ]),
      );
    },
    60_000,
  );

  it.skipIf(!HAS_FFMPEG)(
    "cuts the audio into one slice per chunk when chunks carry their audio",
    async () => {
      const root = tempPath("hf-plan-v2-audio-slices-");
      const projectDir = join(root, "project");
      mkdirSync(projectDir);
      // 2.1 s is not a whole number of 1024-sample AAC frames.
      const tone = spawnSync("ffmpeg", [
        ...["-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000"],
        ...["-t", "2.1", "-c:a", "pcm_s16le", join(projectDir, "tone.wav")],
      ]);
      expect(tone.status).toBe(0);
      writeFileSync(
        join(projectDir, "index.html"),
        `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <div data-composition-id="root" data-width="320" data-height="240" data-duration="2.1">
    <audio id="tone" src="tone.wav" data-start="0" data-duration="2.1"></audio><p>slices</p>
  </div></body></html>`,
      );
      const manifest = await planV2WithPublisher(
        projectDir,
        { fps: 30, width: 320, height: 240, format: "mp4", chunkSize: 30 },
        new LocalPlanV2ArtifactPublisher(join(root, "v2")),
        { stagingParentDir: root, chunksCarryAudio: true },
      );
      expect(manifest.chunkCount).toBe(3);
      for (const chunkIndex of [0, 1, 2]) {
        expect(chunkAudioPaths(manifest, chunkIndex)).toEqual(slicedAudioPaths(chunkIndex));
      }
    },
    60_000,
  );
});

describe("Plan v2 hash schema", () => {
  it("does not reuse a raw artifact digest as its manifest hash", () => {
    const root = tempPath("hf-plan-v2-hash-");
    const result = createPlanV2FromV1(createV1Plan(root), join(root, "v2"));
    const manifest = readPlanV2Manifest(result.planDir);
    expect(manifest.artifacts.some((artifact) => artifact.sha256 === result.planHash)).toBe(false);
    expect(sha256Hex(readFileSync(result.manifestPath))).not.toBe(result.planHash);
  });
});
