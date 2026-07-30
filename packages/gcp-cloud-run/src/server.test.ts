/**
 * Handler dispatch + HTTP-shell unit tests.
 *
 * Asserts that:
 *   - `dispatch` routes Action="plan"/"renderChunk"/"assemble" to the
 *     matching OSS primitive and plumbs GCS download/upload around it.
 *   - It unwraps `{ Payload }` / `{ Input }` envelopes and rejects unknown
 *     actions.
 *   - The handler-boundary guards fire: plan-hash mismatch + bucket
 *     allowlist throw the typed, non-retryable errors.
 *   - `createApp` maps non-retryable errors → 400 and retryable → 500.
 *
 * The real OSS primitives are NOT exercised — they have their own coverage
 * in `packages/producer`. This file pins the adapter glue's contract.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  CURRENT_PLAN_PROTOCOL,
  PLAN_V2_INTEGRITY_UNRECOVERABLE,
  PlanVideosMetadataError,
  PlanV2IntegrityError,
  PlanProtocolUnsupportedError,
  type AssembleResult,
  type ChunkResult,
  type PlanResult,
  type PlanV2ArtifactPublisher,
  type PlanV2Manifest,
  publishPlanV2FromExecutionPlan,
} from "@hyperframes/producer/distributed";
import { recomputePlanHashFromPlanDir } from "../../producer/src/services/render/stages/freezePlan.js";
import { asStorage, FakeGcs } from "./__fixtures__/fakeGcs.js";
import type { AssembleEvent, CloudRunEvent, PlanEvent, RenderChunkEvent } from "./events.js";
import { createApp, dispatch, type HandlerDeps, unwrapEvent } from "./server.js";
import { tarDirectory } from "./gcsTransport.js";

const tmpDirs: string[] = [];
function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const PLAN_HASH = "abc123planhash";

/** Build a real project tarball, seed it into the fake, return its URI. */
async function seedProjectTar(gcs: FakeGcs, uri: string): Promise<void> {
  const src = mkTmp("hf-proj-");
  writeFileSync(join(src, "index.html"), "<html></html>");
  const tarPath = join(mkTmp("hf-proj-tar-"), "project.tar.gz");
  await tarDirectory(src, tarPath);
  gcs.seedFromFile(uri, tarPath);
}

/** Build a real plan tarball containing plan.json, seed it, return its URI. */
async function seedPlanTar(gcs: FakeGcs, uri: string, planHash: string): Promise<void> {
  const planDir = mkTmp("hf-plan-");
  writeFileSync(join(planDir, "plan.json"), JSON.stringify({ planHash }));
  const tarPath = join(mkTmp("hf-plan-tar-"), "plan.tar.gz");
  await tarDirectory(planDir, tarPath);
  gcs.seedFromFile(uri, tarPath);
}

function makeMinimalV1PlanDir(dir: string, withAudio: boolean): void {
  mkdirSync(join(dir, "meta"), { recursive: true });
  mkdirSync(join(dir, "compiled"), { recursive: true });
  writeFileSync(join(dir, "compiled", "index.html"), "<html>gcp v2 fixture</html>");
  const planJson = {
    planHash: "a".repeat(64),
    chunkCount: 1,
    totalFrames: 30,
    dimensions: { fpsNum: 30, fpsDen: 1, width: 640, height: 360, format: "mp4" },
    ffmpegVersion: "6.0",
    producerVersion: "test",
    fontSnapshotSha: "font-snapshot-test",
  };
  writeFileSync(join(dir, "plan.json"), JSON.stringify(planJson));
  writeFileSync(
    join(dir, "meta", "chunks.json"),
    JSON.stringify([{ index: 0, startFrame: 0, endFrame: 30 }]),
  );
  writeFileSync(join(dir, "meta", "encoder.json"), "{}");
  if (withAudio) writeFileSync(join(dir, "audio.aac"), "AAC");
  planJson.planHash = recomputePlanHashFromPlanDir(dir);
  writeFileSync(join(dir, "plan.json"), JSON.stringify(planJson));
}

const planResult: PlanResult = {
  planDir: "(set at call time)",
  planProtocol: CURRENT_PLAN_PROTOCOL,
  planHash: PLAN_HASH,
  chunkCount: 3,
  totalFrames: 90,
  fps: 30,
  width: 1920,
  height: 1080,
  format: "mp4",
  ffmpegVersion: "ffmpeg version 6.1.1",
  producerVersion: "0.6.79",
};

function depsWith(
  gcs: FakeGcs,
  overrides: Partial<NonNullable<HandlerDeps["primitives"]>> = {},
): HandlerDeps {
  const plan = async (_projectDir: string, _config: unknown, planDir: string) => {
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, "plan.json"), JSON.stringify({ planHash: PLAN_HASH }));
    return planResult;
  };
  const renderChunk = async (_planDir: string, chunkIndex: number, outputBase: string) => {
    writeFileSync(outputBase, Buffer.from(`chunk-${chunkIndex}`));
    return {
      outputPath: outputBase,
      outputKind: "file",
      framesEncoded: 30,
      sha256: `sha-${chunkIndex}`,
      captureMode: "beginframe",
      durationMs: 0,
      planHashMs: 0,
      sessionBootMs: 0,
      captureStageMs: 0,
      encodeStageMs: 0,
      workers: 1,
      perfPath: `${outputBase}.perf.json`,
    } satisfies ChunkResult;
  };
  const assemble = async (
    _planDir: string,
    _chunkPaths: string[],
    _audio: string | null,
    finalOutput: string,
  ) => {
    writeFileSync(finalOutput, Buffer.from("final-output"));
    return { framesEncoded: 90, fileSize: 12 } satisfies AssembleResult;
  };
  return {
    storage: asStorage(gcs),
    skipChromeResolution: true,
    primitives: { plan, renderChunk, assemble, ...overrides } as NonNullable<
      HandlerDeps["primitives"]
    >,
  };
}

describe("unwrapEvent", () => {
  const plan: PlanEvent = {
    Action: "plan",
    ProjectGcsUri: "gs://b/p.tar.gz",
    PlanOutputGcsPrefix: "gs://b/out/",
    Config: { fps: 30, width: 1920, height: 1080, format: "mp4" } as PlanEvent["Config"],
  };

  it("returns a bare event unchanged", () => {
    expect(unwrapEvent(plan).Action).toBe("plan");
  });

  it("unwraps { Payload }", () => {
    expect(unwrapEvent({ Payload: plan } as CloudRunEvent).Action).toBe("plan");
  });

  it("unwraps nested { Input: { Payload } }", () => {
    expect(unwrapEvent({ Input: { Payload: plan } } as CloudRunEvent).Action).toBe("plan");
  });

  it("throws when no Action is found", () => {
    expect(() => unwrapEvent({ foo: "bar" } as unknown as CloudRunEvent)).toThrow(
      /no recognised Action/,
    );
  });
});

describe("dispatch", () => {
  it("routes plan, uploads the plan tarball", async () => {
    const gcs = new FakeGcs();
    await seedProjectTar(gcs, "gs://b/sites/x/project.tar.gz");
    const event: PlanEvent = {
      Action: "plan",
      ProjectGcsUri: "gs://b/sites/x/project.tar.gz",
      PlanOutputGcsPrefix: "gs://b/renders/r1/",
      Config: { fps: 30, width: 1920, height: 1080, format: "mp4" } as PlanEvent["Config"],
    };
    const res = await dispatch(event, depsWith(gcs));
    expect(res.Action).toBe("plan");
    if (res.Action !== "plan") throw new Error("unreachable");
    expect(res.PlanHash).toBe(PLAN_HASH);
    expect(res.ChunkCount).toBe(3);
    expect(res.PlanGcsUri).toBe("gs://b/renders/r1/plan.tar.gz");
    expect(gcs.objects.has("gs://b/renders/r1/plan.tar.gz")).toBe(true);
  });

  it("routes renderChunk and uploads the chunk", async () => {
    const gcs = new FakeGcs();
    await seedPlanTar(gcs, "gs://b/renders/r1/plan.tar.gz", PLAN_HASH);
    const event: RenderChunkEvent = {
      Action: "renderChunk",
      PlanGcsUri: "gs://b/renders/r1/plan.tar.gz",
      PlanHash: PLAN_HASH,
      ChunkIndex: 2,
      ChunkOutputGcsPrefix: "gs://b/renders/r1/",
      Format: "mp4",
    };
    const res = await dispatch(event, depsWith(gcs));
    if (res.Action !== "renderChunk") throw new Error("unreachable");
    expect(res.ChunkIndex).toBe(2);
    expect(res.CaptureMode).toBe("beginframe");
    expect(res.ChunkGcsUri).toBe("gs://b/renders/r1/chunks/0002.mp4");
    expect(gcs.objects.has("gs://b/renders/r1/chunks/0002.mp4")).toBe(true);
  });

  it("throws PLAN_HASH_MISMATCH when the event hash disagrees", async () => {
    const gcs = new FakeGcs();
    await seedPlanTar(gcs, "gs://b/renders/r1/plan.tar.gz", PLAN_HASH);
    const event: RenderChunkEvent = {
      Action: "renderChunk",
      PlanGcsUri: "gs://b/renders/r1/plan.tar.gz",
      PlanHash: "WRONG_HASH",
      ChunkIndex: 0,
      ChunkOutputGcsPrefix: "gs://b/renders/r1/",
      Format: "mp4",
    };
    await expect(dispatch(event, depsWith(gcs))).rejects.toThrow(/PLAN_HASH_MISMATCH/);
  });

  it("routes assemble and uploads the final output", async () => {
    const gcs = new FakeGcs();
    await seedPlanTar(gcs, "gs://b/renders/r1/plan.tar.gz", PLAN_HASH);
    gcs.seed("gs://b/renders/r1/chunks/0000.mp4", Buffer.from("c0"));
    gcs.seed("gs://b/renders/r1/chunks/0001.mp4", Buffer.from("c1"));
    const event: AssembleEvent = {
      Action: "assemble",
      PlanGcsUri: "gs://b/renders/r1/plan.tar.gz",
      ChunkGcsUris: ["gs://b/renders/r1/chunks/0000.mp4", "gs://b/renders/r1/chunks/0001.mp4"],
      AudioGcsUri: null,
      OutputGcsUri: "gs://b/renders/r1/output.mp4",
      Format: "mp4",
    };
    const res = await dispatch(event, depsWith(gcs));
    if (res.Action !== "assemble") throw new Error("unreachable");
    expect(res.FramesEncoded).toBe(90);
    expect(gcs.objects.has("gs://b/renders/r1/output.mp4")).toBe(true);
  });

  // This end-to-end adapter contract is intentionally one narrative test: it
  // verifies ordering and target isolation across all three handler roles.
  // fallow-ignore-next-line complexity
  it("runs v2 plan → target-scoped chunk → assemble with manifest-last CAS", async () => {
    const gcs = new FakeGcs();
    await seedProjectTar(gcs, "gs://b/sites/v2/project.tar.gz");
    const root = mkTmp("hf-v2-e2e-");
    const planV2WithPublisher = async (
      projectDir: string,
      _config: unknown,
      publisher: PlanV2ArtifactPublisher,
      options: Readonly<{ stagingParentDir?: string }>,
    ): Promise<PlanV2Manifest> => {
      const v1Dir = join(root, "v1");
      makeMinimalV1PlanDir(v1Dir, true);
      const manifest = await publishPlanV2FromExecutionPlan(v1Dir, publisher);
      expect(options.stagingParentDir).toBe(dirname(projectDir));
      expect(existsSync(join(dirname(projectDir), "plan-v2"))).toBe(false);
      return manifest;
    };
    const renderChunk = async (
      planDir: string,
      chunkIndex: number,
      outputBase: string,
    ): Promise<ChunkResult> => {
      expect(existsSync(join(planDir, "audio.aac"))).toBe(false);
      writeFileSync(outputBase, `chunk-${chunkIndex}`);
      return {
        outputPath: outputBase,
        outputKind: "file",
        framesEncoded: 30,
        sha256: "b".repeat(64),
        captureMode: "beginframe",
        durationMs: 0,
        planHashMs: 0,
        sessionBootMs: 0,
        captureStageMs: 0,
        encodeStageMs: 0,
        workers: 1,
        perfPath: `${outputBase}.perf.json`,
      };
    };
    const assemble = async (
      _planDir: string,
      _chunks: string[],
      audioPath: string | null,
      finalOutput: string,
    ): Promise<AssembleResult> => {
      expect(audioPath).not.toBeNull();
      expect(readFileSync(audioPath as string, "utf8")).toBe("AAC");
      writeFileSync(finalOutput, "v2-output");
      return { framesEncoded: 30, fileSize: 9 };
    };
    const deps = depsWith(gcs, { planV2WithPublisher, renderChunk, assemble });

    const planned = await dispatch(
      {
        Action: "plan",
        PlanProtocol: "v2",
        ProjectGcsUri: "gs://b/sites/v2/project.tar.gz",
        PlanOutputGcsPrefix: "gs://b/renders/v2/",
        Config: { fps: 30, width: 640, height: 360, format: "mp4" },
      },
      deps,
    );
    expect(planned).toMatchObject({
      PlanProtocol: "v2",
      PlanV2ManifestGcsUri: "gs://b/renders/v2/v2/manifest.json",
      PlanV2ArtifactGcsPrefix: "gs://b/renders/v2/v2/artifacts/sha256",
      AudioGcsUri: null,
    });
    expect("PlanGcsUri" in planned).toBe(false);
    const uploadUris = gcs.ops.filter((op) => op.kind === "upload").map((op) => op.uri);
    expect(uploadUris.at(-1)).toBe("gs://b/renders/v2/v2/manifest.json");
    expect(gcs.metadata.get(uploadUris.at(-1) ?? "")?.sha256).toMatch(/^[a-f0-9]{64}$/);
    await dispatch(
      {
        Action: "plan",
        PlanProtocol: "v2",
        ProjectGcsUri: "gs://b/sites/v2/project.tar.gz",
        PlanOutputGcsPrefix: "gs://b/renders/v2/",
        Config: { fps: 30, width: 640, height: 360, format: "mp4" },
      },
      deps,
    );
    expect(gcs.ops.filter((op) => op.kind === "upload").map((op) => op.uri)).toEqual(uploadUris);
    if (!("PlanProtocol" in planned) || planned.PlanProtocol !== "v2") {
      throw new Error("expected v2 plan result");
    }

    const beforeChunk = gcs.ops.length;
    const chunk = await dispatch(
      {
        Action: "renderChunk",
        PlanProtocol: "v2",
        PlanV2ManifestGcsUri: planned.PlanV2ManifestGcsUri,
        PlanV2ArtifactGcsPrefix: planned.PlanV2ArtifactGcsPrefix,
        PlanHash: planned.PlanHash,
        ChunkIndex: 0,
        ChunkOutputGcsPrefix: "gs://b/renders/v2/",
        Format: "mp4",
      },
      deps,
    );
    if (chunk.Action !== "renderChunk") throw new Error("expected chunk result");
    const audioDigest = createHash("sha256").update("AAC").digest("hex");
    const audioUri = `${planned.PlanV2ArtifactGcsPrefix}/${audioDigest.slice(0, 2)}/${audioDigest}`;
    expect(gcs.ops.slice(beforeChunk).some((operation) => operation.uri === audioUri)).toBe(false);

    await dispatch(
      {
        Action: "assemble",
        PlanProtocol: "v2",
        PlanV2ManifestGcsUri: planned.PlanV2ManifestGcsUri,
        PlanV2ArtifactGcsPrefix: planned.PlanV2ArtifactGcsPrefix,
        PlanHash: planned.PlanHash,
        ChunkGcsUris: [chunk.ChunkGcsUri],
        AudioGcsUri: null,
        OutputGcsUri: "gs://b/renders/v2/output.mp4",
        Format: "mp4",
      },
      deps,
    );
    expect(
      gcs.ops.some((operation) => operation.kind === "download" && operation.uri === audioUri),
    ).toBe(true);
  });

  it("rejects mixed v1/v2 locators at runtime", async () => {
    const event = {
      Action: "renderChunk",
      PlanProtocol: "v2",
      PlanGcsUri: "gs://b/renders/r1/plan.tar.gz",
      PlanV2ManifestGcsUri: "gs://b/renders/r1/v2/manifest.json",
      PlanV2ArtifactGcsPrefix: "gs://b/renders/r1/v2/artifacts/sha256",
      PlanHash: PLAN_HASH,
      ChunkIndex: 0,
      ChunkOutputGcsPrefix: "gs://b/renders/r1/",
      Format: "mp4",
    } as unknown as RenderChunkEvent;
    await expect(dispatch(event, depsWith(new FakeGcs()))).rejects.toMatchObject({
      name: "PLAN_PROTOCOL_UNSUPPORTED",
    });
  });

  it("rejects an unknown action", async () => {
    const gcs = new FakeGcs();
    await expect(
      dispatch({ Action: "nope" } as unknown as CloudRunEvent, depsWith(gcs)),
    ).rejects.toThrow(/no recognised Action/);
  });
});

describe("bucket allowlist guard", () => {
  it("throws GCS_URI_NOT_ALLOWED for an off-bucket URI", async () => {
    const gcs = new FakeGcs();
    const prev = process.env.HYPERFRAMES_RENDER_BUCKET;
    process.env.HYPERFRAMES_RENDER_BUCKET = "allowed-bucket";
    try {
      const event: RenderChunkEvent = {
        Action: "renderChunk",
        PlanGcsUri: "gs://evil-bucket/plan.tar.gz",
        PlanHash: PLAN_HASH,
        ChunkIndex: 0,
        ChunkOutputGcsPrefix: "gs://allowed-bucket/renders/r1/",
        Format: "mp4",
      };
      await expect(dispatch(event, depsWith(gcs))).rejects.toThrow(/GCS_URI_NOT_ALLOWED/);
    } finally {
      if (prev === undefined) delete process.env.HYPERFRAMES_RENDER_BUCKET;
      else process.env.HYPERFRAMES_RENDER_BUCKET = prev;
    }
  });

  it("checks both v2 manifest and artifact-prefix buckets", async () => {
    const prev = process.env.HYPERFRAMES_RENDER_BUCKET;
    process.env.HYPERFRAMES_RENDER_BUCKET = "allowed-bucket";
    try {
      const event: RenderChunkEvent = {
        Action: "renderChunk",
        PlanProtocol: "v2",
        PlanV2ManifestGcsUri: "gs://allowed-bucket/v2/manifest.json",
        PlanV2ArtifactGcsPrefix: "gs://evil-bucket/v2/artifacts/sha256",
        PlanHash: PLAN_HASH,
        ChunkIndex: 0,
        ChunkOutputGcsPrefix: "gs://allowed-bucket/renders/r1/",
        Format: "mp4",
      };
      await expect(dispatch(event, depsWith(new FakeGcs()))).rejects.toThrow(/GCS_URI_NOT_ALLOWED/);
    } finally {
      if (prev === undefined) delete process.env.HYPERFRAMES_RENDER_BUCKET;
      else process.env.HYPERFRAMES_RENDER_BUCKET = prev;
    }
  });

  it('treats HYPERFRAMES_RENDER_BUCKET="*" as an explicit opt-out (off-bucket allowed)', async () => {
    const gcs = new FakeGcs();
    await seedPlanTar(gcs, "gs://any-bucket/renders/r1/plan.tar.gz", PLAN_HASH);
    const prev = process.env.HYPERFRAMES_RENDER_BUCKET;
    process.env.HYPERFRAMES_RENDER_BUCKET = "*";
    try {
      const event: RenderChunkEvent = {
        Action: "renderChunk",
        PlanGcsUri: "gs://any-bucket/renders/r1/plan.tar.gz",
        PlanHash: PLAN_HASH,
        ChunkIndex: 0,
        ChunkOutputGcsPrefix: "gs://any-bucket/renders/r1/",
        Format: "mp4",
      };
      const res = await dispatch(event, depsWith(gcs));
      expect(res.Action).toBe("renderChunk");
    } finally {
      if (prev === undefined) delete process.env.HYPERFRAMES_RENDER_BUCKET;
      else process.env.HYPERFRAMES_RENDER_BUCKET = prev;
    }
  });
});

describe("createApp HTTP mapping", () => {
  it("returns 200 with the result body on success", async () => {
    const gcs = new FakeGcs();
    await seedPlanTar(gcs, "gs://b/renders/r1/plan.tar.gz", PLAN_HASH);
    const app = createApp(depsWith(gcs));
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        Action: "renderChunk",
        PlanGcsUri: "gs://b/renders/r1/plan.tar.gz",
        PlanHash: PLAN_HASH,
        ChunkIndex: 0,
        ChunkOutputGcsPrefix: "gs://b/renders/r1/",
        Format: "mp4",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { Action: string };
    expect(body.Action).toBe("renderChunk");
  });

  it("returns 400 for a non-retryable error (plan-hash mismatch)", async () => {
    const gcs = new FakeGcs();
    await seedPlanTar(gcs, "gs://b/renders/r1/plan.tar.gz", PLAN_HASH);
    const app = createApp(depsWith(gcs));
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        Action: "renderChunk",
        PlanGcsUri: "gs://b/renders/r1/plan.tar.gz",
        PlanHash: "WRONG",
        ChunkIndex: 0,
        ChunkOutputGcsPrefix: "gs://b/renders/r1/",
        Format: "mp4",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("PLAN_HASH_MISMATCH");
  });

  it("returns 400 for an unsupported plan protocol", async () => {
    const gcs = new FakeGcs();
    await seedPlanTar(gcs, "gs://b/renders/r1/plan.tar.gz", PLAN_HASH);
    const app = createApp(
      depsWith(gcs, {
        renderChunk: async () => {
          throw new PlanProtocolUnsupportedError("unsupported test protocol");
        },
      }),
    );
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        Action: "renderChunk",
        PlanGcsUri: "gs://b/renders/r1/plan.tar.gz",
        PlanHash: PLAN_HASH,
        ChunkIndex: 0,
        ChunkOutputGcsPrefix: "gs://b/renders/r1/",
        Format: "mp4",
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("PLAN_PROTOCOL_UNSUPPORTED");
  });

  it("returns 400 for plan v2 integrity error names and code aliases", async () => {
    for (const error of [
      new PlanV2IntegrityError("corrupt test artifact"),
      Object.assign(new Error("corrupt test artifact"), {
        name: PLAN_V2_INTEGRITY_UNRECOVERABLE,
      }),
      Object.assign(new Error("corrupt test artifact"), {
        code: PLAN_V2_INTEGRITY_UNRECOVERABLE,
      }),
    ]) {
      const gcs = new FakeGcs();
      await seedPlanTar(gcs, "gs://b/renders/r1/plan.tar.gz", PLAN_HASH);
      const app = createApp(
        depsWith(gcs, {
          renderChunk: async () => {
            throw error;
          },
        }),
      );
      const res = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          Action: "renderChunk",
          PlanGcsUri: "gs://b/renders/r1/plan.tar.gz",
          PlanHash: PLAN_HASH,
          ChunkIndex: 0,
          ChunkOutputGcsPrefix: "gs://b/renders/r1/",
          Format: "mp4",
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe(PLAN_V2_INTEGRITY_UNRECOVERABLE);
    }
  });

  it.each([
    ["VIDEO_SOURCE_UNRENDERABLE", 400],
    ["VIDEO_EXTRACTION_FAILED", 500],
    ["FONT_FETCH_FAILED", 400],
    ["FONT_FETCH_UNAVAILABLE", 500],
  ] as const)("routes producer code %s with HTTP %s", async (code, expectedStatus) => {
    const gcs = new FakeGcs();
    await seedPlanTar(gcs, "gs://b/renders/r1/plan.tar.gz", PLAN_HASH);
    const app = createApp(
      depsWith(gcs, {
        renderChunk: async () => {
          throw Object.assign(new Error(`test ${code}`), {
            name: "ProducerError",
            code,
          });
        },
      }),
    );
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        Action: "renderChunk",
        PlanGcsUri: "gs://b/renders/r1/plan.tar.gz",
        PlanHash: PLAN_HASH,
        ChunkIndex: 0,
        ChunkOutputGcsPrefix: "gs://b/renders/r1/",
        Format: "mp4",
      }),
    });

    expect(res.status).toBe(expectedStatus);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(code);
  });

  it("routes the real plan metadata error as non-retryable", async () => {
    const gcs = new FakeGcs();
    await seedProjectTar(gcs, "gs://b/sites/invalid-video-metadata/project.tar.gz");
    const app = createApp(
      depsWith(gcs, {
        plan: async () => {
          throw new PlanVideosMetadataError("test invalid plan video metadata");
        },
      }),
    );
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        Action: "plan",
        ProjectGcsUri: "gs://b/sites/invalid-video-metadata/project.tar.gz",
        PlanOutputGcsPrefix: "gs://b/renders/invalid-video-metadata/",
        Config: { fps: 30, width: 640, height: 360, format: "mp4" },
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("INVALID_VIDEO_METADATA");
  });

  it("returns 500 for a retryable/unknown error", async () => {
    const gcs = new FakeGcs(); // plan tar NOT seeded → download fails (retryable)
    const app = createApp(depsWith(gcs));
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        Action: "renderChunk",
        PlanGcsUri: "gs://b/renders/r1/missing.tar.gz",
        PlanHash: PLAN_HASH,
        ChunkIndex: 0,
        ChunkOutputGcsPrefix: "gs://b/renders/r1/",
        Format: "mp4",
      }),
    });
    expect(res.status).toBe(500);
  });

  it("returns 400 when the body is not JSON", async () => {
    const gcs = new FakeGcs();
    const app = createApp(depsWith(gcs));
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json{",
    });
    expect(res.status).toBe(400);
  });

  it("healthz returns ok", async () => {
    const app = createApp(depsWith(new FakeGcs()));
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
  });
});
