// fallow-ignore-file code-duplication complexity
/**
 * Handler dispatch unit tests.
 *
 * Asserts that:
 *   - The handler routes Action="plan" / "renderChunk" / "assemble" to the
 *     matching OSS primitive.
 *   - It unwraps Step Functions `{ Payload }` and `{ Input }` envelopes.
 *   - It rejects unknown actions with a clear message.
 *   - It plumbs S3 download/upload calls in the correct order.
 *
 * The real OSS primitives are NOT exercised here — they live in
 * `@hyperframes/producer/distributed` and have their own coverage in
 * `packages/producer`. The Lambda handler is thin glue; this file pins
 * the glue's contract.
 */

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import {
  CURRENT_PLAN_PROTOCOL,
  PLAN_V2_MATERIALIZATION_MARKER,
  PlanVideosMetadataError,
  type AssembleResult,
  type ChunkResult,
  type DistributedRenderConfig,
  type PlanResult,
  type PlanV2ArtifactPublisher,
  type PlanV2Manifest,
  type PlanV2WithPublisherOptions,
  publishPlanV2FromExecutionPlan,
} from "@hyperframes/producer/distributed";
import { resolveMaxParallelChunks } from "../../producer/src/services/distributed/plan.js";
import { recomputePlanHashFromPlanDir } from "../../producer/src/services/render/stages/freezePlan.js";
import type {
  AssembleEvent,
  LambdaEvent,
  PlanEvent,
  RenderChunkEvent,
  StitchPartsEvent,
} from "./events.js";
import { handler as handleEvent, stitchHelper, unwrapEvent } from "./handler.js";
import { S3PlanV2ArtifactPublisher } from "./s3PlanV2Publisher.js";

interface FakeS3Op {
  kind: "download" | "upload" | "copy";
  uri: string;
  bytes?: number;
}

/**
 * In-memory S3 stand-in. Records every operation so test assertions can
 * pin the exact sequence of downloads and uploads, plus fakes the GetObject
 * stream so {@link downloadS3ObjectToFile} writes the expected bytes.
 */
class FakeS3Client {
  ops: FakeS3Op[] = [];
  // Map S3 URIs → byte buffers the fake serves.
  objects = new Map<string, Buffer>();
  metadata = new Map<string, Record<string, string>>();
  checksums = new Map<string, string>();

  // Methods called by the real S3 transport — minimal surface so the
  // handler's call sites don't need rewriting under test.
  // This fake intentionally implements the complete S3 command matrix inline so
  // handler tests exercise realistic state transitions without AWS.
  // fallow-ignore-next-line complexity
  async send(command: unknown): Promise<unknown> {
    const op = command as { input: { Bucket: string; Key: string } } & {
      constructor: { name: string };
    };
    const cmdName = op.constructor?.name ?? "";
    const uri = `s3://${op.input.Bucket}/${op.input.Key}`;
    if (cmdName === "GetObjectCommand") {
      const bytes = this.sliceRange(
        this.objects.get(uri) ?? Buffer.alloc(0),
        (command as { input: { Range?: string } }).input.Range,
      );
      this.ops.push({ kind: "download", uri, bytes: bytes.length });
      // Mock the AWS SDK stream contract just enough for pipeline() to
      // pump bytes into a write stream.
      const { Readable } = await import("node:stream");
      return {
        Body: Object.assign(Readable.from([bytes]), {
          transformToByteArray: async () => new Uint8Array(bytes),
        }),
      };
    }
    if (cmdName === "HeadObjectCommand") {
      const bytes = this.objects.get(uri);
      if (!bytes) {
        const error = new Error("not found") as Error & {
          $metadata: { httpStatusCode: number };
        };
        error.name = "NotFound";
        error.$metadata = { httpStatusCode: 404 };
        throw error;
      }
      return {
        ContentLength: bytes.length,
        Metadata: this.metadata.get(uri),
        ChecksumSHA256: this.checksums.get(uri),
      };
    }
    if (cmdName === "PutObjectCommand") {
      // Buffer the body so we can record how many bytes were uploaded; the
      // handler's hot path streams from disk, but tests pin the count.
      const body = (command as { input: { Body: NodeJS.ReadableStream | Buffer } }).input.Body;
      const chunks: Buffer[] = [];
      if (Buffer.isBuffer(body)) {
        chunks.push(body);
      } else if (body && typeof (body as NodeJS.ReadableStream).pipe === "function") {
        for await (const chunk of body as NodeJS.ReadableStream) {
          chunks.push(Buffer.from(chunk as Buffer));
        }
      }
      const bytes = Buffer.concat(chunks);
      this.ops.push({ kind: "upload", uri, bytes: bytes.length });
      this.objects.set(uri, bytes);
      const metadata = (command as { input: { Metadata?: Record<string, string> } }).input.Metadata;
      if (metadata) this.metadata.set(uri, metadata);
      const checksum = (command as { input: { ChecksumSHA256?: string } }).input.ChecksumSHA256;
      if (checksum) this.checksums.set(uri, checksum);
      return {};
    }
    if (cmdName === "CreateMultipartUploadCommand") return { UploadId: "upload-1" };
    if (cmdName === "UploadPartCommand") {
      const input = (command as { input: { Body: Buffer; PartNumber: number } }).input;
      this.parts.set(input.PartNumber, input.Body);
      return { ETag: `"part-${input.PartNumber}"` };
    }
    if (cmdName === "UploadPartCopyCommand") {
      const input = (
        command as { input: { CopySource: string; CopySourceRange?: string; PartNumber: number } }
      ).input;
      const source = `s3://${decodeURI(input.CopySource)}`;
      this.ops.push({ kind: "copy", uri: source });
      const bytes = this.objects.get(source) ?? Buffer.alloc(0);
      this.parts.set(input.PartNumber, this.sliceRange(bytes, input.CopySourceRange));
      return { CopyPartResult: { ETag: `"part-${input.PartNumber}"` } };
    }
    if (cmdName === "CompleteMultipartUploadCommand") {
      const parts = (command as { input: { MultipartUpload: { Parts: { PartNumber: number }[] } } })
        .input.MultipartUpload.Parts;
      this.objects.set(uri, Buffer.concat(parts.map((part) => this.parts.get(part.PartNumber)!)));
      return {};
    }
    return {};
  }

  parts = new Map<number, Buffer>();

  private sliceRange(bytes: Buffer, range?: string): Buffer {
    const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? "");
    return match ? bytes.subarray(Number(match[1]), Number(match[2]) + 1) : bytes;
  }
}

// Without a configured concurrency, plan asks the account; tests get a refusal and the fallback.
const accountUnreadable = {
  send: async () => {
    throw new Error("unit tests do not read the AWS account");
  },
} as unknown as LambdaClient;
const handler: typeof handleEvent = (event, deps) =>
  handleEvent(event, { lambda: accountUnreadable, ...deps });
/** A real client (so it can pre-sign offline) whose requests go to the fake. */
function presigningClient(fake: FakeS3Client): S3Client {
  const client = new S3Client({
    region: "us-east-2",
    credentials: { accessKeyId: "AKIDTEST", secretAccessKey: "test-secret" },
  });
  client.send = fake.send.bind(fake) as S3Client["send"];
  return client;
}

const tmpDirs: string[] = [];

// The handler's default clients sign with the machine's credentials; a test reaching one fails.
let realAwsClients: ReturnType<typeof spyOn>[] = [];
beforeEach(() => {
  realAwsClients = [LambdaClient.prototype, S3Client.prototype].map((proto) =>
    spyOn(proto, "send").mockImplementation(async () => {
      throw new Error("a unit test reached a real AWS client");
    }),
  );
});

afterEach(() => {
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  }
  tmpDirs.length = 0;
  const realSends = realAwsClients.flatMap((spy) =>
    spy.mock.calls.map((call) => (call[0] as object).constructor.name),
  );
  for (const spy of realAwsClients) spy.mockRestore();
  expect(realSends).toEqual([]);
});

function makeTmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-lambda-test-"));
  tmpDirs.push(dir);
  return dir;
}

describe("unwrapEvent", () => {
  it("returns a bare event unchanged", () => {
    const event: PlanEvent = {
      Action: "plan",
      ProjectS3Uri: "s3://bucket/project.tar.gz",
      PlanOutputS3Prefix: "s3://bucket/renders/abc/",
      Config: { fps: 30, width: 1920, height: 1080, format: "mp4" },
    };
    expect(unwrapEvent(event).Action).toBe("plan");
  });

  it("unwraps a Step Functions { Payload } envelope", () => {
    const inner: RenderChunkEvent = {
      Action: "renderChunk",
      PlanProtocol: "v1",
      PlanS3Uri: "s3://bucket/plan.tar.gz",
      PlanHash: "deadbeef",
      ChunkIndex: 3,
      ChunkOutputS3Prefix: "s3://bucket/renders/abc/",
      Format: "mp4",
    };
    const wrapped: LambdaEvent = { Payload: inner };
    expect(unwrapEvent(wrapped).Action).toBe("renderChunk");
  });

  it("unwraps multiple levels of envelopes", () => {
    const inner: AssembleEvent = {
      Action: "assemble",
      PlanProtocol: "v1",
      PlanS3Uri: "s3://bucket/plan.tar.gz",
      ChunkS3Uris: ["s3://bucket/chunks/0001.mp4"],
      AudioS3Uri: null,
      OutputS3Uri: "s3://bucket/output.mp4",
      Format: "mp4",
    };
    const doubly: LambdaEvent = { Payload: { Input: inner } };
    expect(unwrapEvent(doubly).Action).toBe("assemble");
  });

  it("throws on unknown action", () => {
    expect(() => unwrapEvent({ Action: "doSomething" } as unknown as LambdaEvent)).toThrow(
      /no recognised Action/,
    );
  });
});

describe("handler dispatch", () => {
  it("answers a warm event without touching S3 or the project", async () => {
    const s3 = new FakeS3Client();
    expect(
      await handleEvent(
        { Action: "warm" },
        { s3: s3 as unknown as import("@aws-sdk/client-s3").S3Client, skipChromeResolution: true },
      ),
    ).toEqual({
      Action: "warm",
    });
    expect(s3.ops).toEqual([]);
  });

  it("preserves explicit v1 plan compatibility", async () => {
    const tmpRoot = makeTmpRoot();
    const s3 = new FakeS3Client();
    // Seed a fake project tarball so the untar step has something to chew on.
    s3.objects.set("s3://bucket/project.tar.gz", await makeMinimalProjectTar());

    const planMock = mock(
      async (_projectDir: string, _config: unknown, planDir: string): Promise<PlanResult> => {
        // Simulate plan() writing a minimal planDir.
        mkdirSync(planDir, { recursive: true });
        writeFileSync(join(planDir, "plan.json"), JSON.stringify({ planHash: "fakehash" }));
        mkdirSync(join(planDir, "meta"), { recursive: true });
        writeFileSync(join(planDir, "meta", "chunks.json"), "[]");
        return {
          planDir,
          planProtocol: CURRENT_PLAN_PROTOCOL,
          planHash: "fakehash",
          chunkCount: 4,
          totalFrames: 720,
          fps: 30 as const,
          width: 1920,
          height: 1080,
          format: "mp4" as const,
          ffmpegVersion: "6.0",
          producerVersion: "0.0.0-test",
        };
      },
    );
    const renderChunkMock = mock(async () => {
      throw new Error("should not be called");
    });
    const assembleMock = mock(async () => {
      throw new Error("should not be called");
    });

    const event: PlanEvent = {
      Action: "plan",
      PlanProtocol: "v1",
      ProjectS3Uri: "s3://bucket/project.tar.gz",
      PlanOutputS3Prefix: "s3://bucket/renders/abc/",
      Config: { fps: 30, width: 1920, height: 1080, format: "mp4" },
    };

    const result = await handler(event, {
      s3: s3 as unknown as import("@aws-sdk/client-s3").S3Client,
      primitives: {
        plan: planMock as unknown as typeof import("@hyperframes/producer/distributed").plan,
        renderChunk:
          renderChunkMock as unknown as typeof import("@hyperframes/producer/distributed").renderChunk,
        assemble:
          assembleMock as unknown as typeof import("@hyperframes/producer/distributed").assemble,
      },
      tmpRoot,
      skipChromeResolution: true,
    });

    expect(result.Action).toBe("plan");
    if (result.Action !== "plan") throw new Error("unreachable");
    expect(result.PlanHash).toBe("fakehash");
    expect(result.ChunkCount).toBe(4);
    expect(planMock).toHaveBeenCalledTimes(1);
    expect((planMock.mock.calls[0] as unknown[])[3]).toEqual({ chunksCarryAudio: true });
    expect(renderChunkMock).not.toHaveBeenCalled();
    expect(assembleMock).not.toHaveBeenCalled();
    // Plan should have downloaded the project zip and uploaded the plan tar.
    expect(
      s3.ops.some((o) => o.kind === "download" && o.uri === "s3://bucket/project.tar.gz"),
    ).toBe(true);
  });

  it("plans against the function's own timeout unless the config pins one", async () => {
    const seen: Array<number | undefined> = [];
    for (const pinned of [undefined, 300]) {
      const tmpRoot = makeTmpRoot();
      const s3 = new FakeS3Client();
      s3.objects.set("s3://bucket/project.tar.gz", await makeMinimalProjectTar());
      await handler(
        {
          Action: "plan",
          PlanProtocol: "v1",
          ProjectS3Uri: "s3://bucket/project.tar.gz",
          PlanOutputS3Prefix: "s3://bucket/renders/timeout/",
          Config: { fps: 30, width: 640, height: 360, format: "mp4", workerTimeoutSeconds: pinned },
        },
        {
          s3: s3 as unknown as import("@aws-sdk/client-s3").S3Client,
          primitives: {
            plan: mock(async (_dir: string, config: { workerTimeoutSeconds?: number }) => {
              seen.push(config.workerTimeoutSeconds);
              throw new Error("stop after config");
            }) as unknown as typeof import("@hyperframes/producer/distributed").plan,
            renderChunk: mock(async () => {
              throw new Error("unused");
            }) as unknown as typeof import("@hyperframes/producer/distributed").renderChunk,
            assemble: mock(async () => {
              throw new Error("unused");
            }) as unknown as typeof import("@hyperframes/producer/distributed").assemble,
          },
          tmpRoot,
          skipChromeResolution: true,
          getRemainingTimeInMillis: () => 899_987,
        },
      ).catch(() => undefined);
    }
    expect(seen).toEqual([900, 300]);
  });

  describe("chunk concurrency when the render does not set one", () => {
    const THIRTY_MIN_FRAMES = 54_000;
    const MP_1080P = (1920 * 1080) / 1_000_000;

    function fakeLambda(reply: () => Promise<unknown>) {
      const send = mock(reply);
      return { send, client: { send } as unknown as import("@aws-sdk/client-lambda").LambdaClient };
    }

    async function planThirtyMinutes(lambda: { client: unknown }, workerConcurrency?: number) {
      const tmpRoot = makeTmpRoot();
      const s3 = new FakeS3Client();
      s3.objects.set("s3://bucket/project.tar.gz", await makeMinimalProjectTar());
      const warnings: string[] = [];
      const log = { warn: (m: string) => warnings.push(m), error() {}, info() {}, debug() {} };
      let planned: DistributedRenderConfig | undefined;
      const result = await handler(
        {
          Action: "plan",
          PlanProtocol: "v1",
          ProjectS3Uri: "s3://bucket/project.tar.gz",
          PlanOutputS3Prefix: "s3://bucket/renders/conc/",
          Config: { fps: 30, width: 1920, height: 1080, format: "mp4", workerConcurrency },
        },
        {
          s3: s3 as unknown as import("@aws-sdk/client-s3").S3Client,
          lambda: lambda.client as import("@aws-sdk/client-lambda").LambdaClient,
          primitives: {
            plan: mock(async (_dir: string, config: DistributedRenderConfig, planDir: string) => {
              planned = config;
              mkdirSync(planDir, { recursive: true });
              writeFileSync(join(planDir, "plan.json"), "{}");
              return {
                planDir,
                planProtocol: CURRENT_PLAN_PROTOCOL,
                planHash: "h",
                // The real sizing rule, so the cap and the chunk count are tested together.
                chunkCount: resolveMaxParallelChunks(config, THIRTY_MIN_FRAMES, MP_1080P, log),
                totalFrames: THIRTY_MIN_FRAMES,
                fps: 30 as const,
                width: 1920,
                height: 1080,
                format: "mp4" as const,
                ffmpegVersion: "6.0",
                producerVersion: "0.0.0-test",
              };
            }) as unknown as typeof import("@hyperframes/producer/distributed").plan,
            renderChunk: mock(async () => {
              throw new Error("unused");
            }) as unknown as typeof import("@hyperframes/producer/distributed").renderChunk,
            assemble: mock(async () => {
              throw new Error("unused");
            }) as unknown as typeof import("@hyperframes/producer/distributed").assemble,
          },
          tmpRoot,
          skipChromeResolution: true,
          getRemainingTimeInMillis: () => 900_000,
        },
      );
      if (result.Action !== "plan") throw new Error("unreachable");
      return { result, planned, warnings };
    }

    it("runs every chunk at once when the account has room", async () => {
      const lambda = fakeLambda(async () => ({
        AccountLimit: { UnreservedConcurrentExecutions: 1000 },
      }));
      const { result, planned, warnings } = await planThirtyMinutes(lambda);
      expect(planned?.workerConcurrency).toBe(900);
      expect(result.ChunkCount).toBe(204);
      expect(result.MaxChunkConcurrency).toBe(result.ChunkCount);
      expect(warnings).toEqual([]);
    });

    it("caps at 90% of a small account and says the render runs in waves", async () => {
      const lambda = fakeLambda(async () => ({
        AccountLimit: { UnreservedConcurrentExecutions: 10 },
      }));
      const { result, warnings } = await planThirtyMinutes(lambda);
      expect(result.MaxChunkConcurrency).toBe(9);
      expect(result.ChunkCount).toBe(21);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("in 3 waves");
      expect(warnings[0]).toContain("--concurrency 21");
    });

    it("falls back to 16 at once and logs why when the account cannot be read", async () => {
      const lambda = fakeLambda(async () => {
        const denied = new Error("not authorized to perform: lambda:GetAccountSettings");
        denied.name = "AccessDeniedException";
        throw denied;
      });
      const logged = spyOn(console, "log").mockImplementation(() => undefined);
      try {
        const { result, planned } = await planThirtyMinutes(lambda);
        expect(planned?.workerConcurrency).toBe(16);
        expect(result.MaxChunkConcurrency).toBe(16);
        const lines = logged.mock.calls.map((call) => String(call[0]));
        const fallback = lines.find((line) => line.includes('"source":"fallback"'));
        expect(fallback).toContain('"level":"WARN"');
        expect(fallback).toContain("AccessDeniedException");
        expect(fallback).toContain("planning for 16 chunks at once");
      } finally {
        logged.mockRestore();
      }
    });

    it("keeps an explicit concurrency, then the reserved one, without asking the account", async () => {
      const lambda = fakeLambda(async () => ({
        AccountLimit: { UnreservedConcurrentExecutions: 1000 },
      }));
      const explicit = await planThirtyMinutes(lambda, 64);
      expect(explicit.planned?.workerConcurrency).toBe(64);
      expect(explicit.result.MaxChunkConcurrency).toBe(64);
      process.env.HYPERFRAMES_LAMBDA_RESERVED_CONCURRENCY = "32";
      try {
        const reserved = await planThirtyMinutes(lambda);
        expect(reserved.result.MaxChunkConcurrency).toBe(32);
      } finally {
        delete process.env.HYPERFRAMES_LAMBDA_RESERVED_CONCURRENCY;
      }
      expect(lambda.send).not.toHaveBeenCalled();
    });
  });

  it("normalizes producer workflow codes to Step Functions error names", async () => {
    for (const code of [
      "PLAN_TOO_LARGE",
      "PLAN_PROTOCOL_UNSUPPORTED",
      "PLAN_V2_INTEGRITY_UNRECOVERABLE",
      "FONT_FETCH_FAILED",
      "FONT_FETCH_UNAVAILABLE",
      "VIDEO_SOURCE_UNRENDERABLE",
      "VIDEO_EXTRACTION_FAILED",
      "INVALID_VIDEO_METADATA",
      "FORMAT_NOT_SUPPORTED_IN_DISTRIBUTED",
      "CHUNK_EXCEEDS_WORKER_TIMEOUT",
    ] as const) {
      const tmpRoot = makeTmpRoot();
      const s3 = new FakeS3Client();
      s3.objects.set("s3://bucket/project.tar.gz", await makeMinimalProjectTar());
      const terminal =
        code === "INVALID_VIDEO_METADATA"
          ? new PlanVideosMetadataError("test invalid plan video metadata")
          : Object.assign(new Error(`terminal: ${code}`), {
              code,
              name: "ProducerError",
            });

      await expect(
        handler(
          {
            Action: "plan",
            PlanProtocol: "v1",
            ProjectS3Uri: "s3://bucket/project.tar.gz",
            PlanOutputS3Prefix: "s3://bucket/renders/terminal/",
            Config: { fps: 30, width: 640, height: 360, format: "mp4" },
          },
          {
            s3: s3 as unknown as import("@aws-sdk/client-s3").S3Client,
            primitives: {
              plan: mock(async () => {
                throw terminal;
              }) as unknown as typeof import("@hyperframes/producer/distributed").plan,
              renderChunk: mock(async () => {
                throw new Error("unused");
              }) as unknown as typeof import("@hyperframes/producer/distributed").renderChunk,
              assemble: mock(async () => {
                throw new Error("unused");
              }) as unknown as typeof import("@hyperframes/producer/distributed").assemble,
            },
            tmpRoot,
            skipChromeResolution: true,
          },
        ),
      ).rejects.toMatchObject({ name: code });
    }
  });

  it("plan honors a pre-set PRODUCER_HEADLESS_SHELL_PATH instead of re-resolving Chrome", async () => {
    // Mirrors the renderChunk env-var guard — when a caller (e.g. SAM-local
    // RIE smoke) seeds the path, handlePlan must not overwrite it.
    const tmpRoot = makeTmpRoot();
    const s3 = new FakeS3Client();
    s3.objects.set("s3://bucket/project.tar.gz", await makeMinimalProjectTar());

    const planMock = mock(
      async (_projectDir: string, _config: unknown, planDir: string): Promise<PlanResult> => {
        mkdirSync(planDir, { recursive: true });
        writeFileSync(join(planDir, "plan.json"), JSON.stringify({ planHash: "fakehash" }));
        mkdirSync(join(planDir, "meta"), { recursive: true });
        writeFileSync(join(planDir, "meta", "chunks.json"), "[]");
        return {
          planDir,
          planProtocol: CURRENT_PLAN_PROTOCOL,
          planHash: "fakehash",
          chunkCount: 1,
          totalFrames: 30,
          fps: 30 as const,
          width: 1920,
          height: 1080,
          format: "mp4" as const,
          ffmpegVersion: "6.0",
          producerVersion: "0.0.0-test",
        };
      },
    );
    const renderChunkMock = mock(async () => {
      throw new Error("should not be called");
    });
    const assembleMock = mock(async () => {
      throw new Error("should not be called");
    });

    const event: PlanEvent = {
      Action: "plan",
      PlanProtocol: "v1",
      ProjectS3Uri: "s3://bucket/project.tar.gz",
      PlanOutputS3Prefix: "s3://bucket/renders/abc/",
      Config: { fps: 30, width: 1920, height: 1080, format: "mp4" },
    };

    const sentinel = "/tmp/test-chrome-sentinel";
    const prev = process.env.PRODUCER_HEADLESS_SHELL_PATH;
    process.env.PRODUCER_HEADLESS_SHELL_PATH = sentinel;
    try {
      // Note: no skipChromeResolution flag — the guard must short-circuit
      // because PRODUCER_HEADLESS_SHELL_PATH is already set.
      await handler(event, {
        s3: s3 as unknown as import("@aws-sdk/client-s3").S3Client,
        primitives: {
          plan: planMock as unknown as typeof import("@hyperframes/producer/distributed").plan,
          renderChunk:
            renderChunkMock as unknown as typeof import("@hyperframes/producer/distributed").renderChunk,
          assemble:
            assembleMock as unknown as typeof import("@hyperframes/producer/distributed").assemble,
        },
        tmpRoot,
      });
      expect(process.env.PRODUCER_HEADLESS_SHELL_PATH).toBe(sentinel);
      expect(planMock).toHaveBeenCalledTimes(1);
    } finally {
      if (prev === undefined) {
        delete process.env.PRODUCER_HEADLESS_SHELL_PATH;
      } else {
        process.env.PRODUCER_HEADLESS_SHELL_PATH = prev;
      }
    }
  });

  it("routes Action='renderChunk' to the renderChunk primitive", async () => {
    const tmpRoot = makeTmpRoot();
    const s3 = new FakeS3Client();
    // Seed a planDir tarball with a minimal structure renderChunk would
    // observe; the test mock doesn't read it, but the handler untar step does.
    s3.objects.set("s3://bucket/plan.tar.gz", await makeMinimalPlanTar());

    const renderChunkMock = mock(
      async (
        _planDir: string,
        _chunkIndex: number,
        outputChunkPath: string,
      ): Promise<ChunkResult> => {
        // Write a fake chunk file so the upload step has bytes to send.
        writeFileSync(outputChunkPath, Buffer.from("FAKE-MP4-CHUNK"));
        return {
          outputPath: outputChunkPath,
          outputKind: "file",
          framesEncoded: 240,
          sha256: "0".repeat(64),
          durationMs: 12345,
          planHashMs: 1,
          sessionBootMs: 2,
          captureStageMs: 3,
          encodeStageMs: 4,
          workers: 1,
          captureMode: "beginframe",
          perfPath: outputChunkPath + ".perf.json",
        };
      },
    );

    const planMock = mock(async () => {
      throw new Error("should not be called");
    });
    const assembleMock = mock(async () => {
      throw new Error("should not be called");
    });

    const event: RenderChunkEvent = {
      Action: "renderChunk",
      PlanProtocol: "v1",
      PlanS3Uri: "s3://bucket/plan.tar.gz",
      PlanHash: "fakehash",
      ChunkIndex: 2,
      ChunkOutputS3Prefix: "s3://bucket/renders/abc/",
      Format: "mp4",
    };

    const result = await handler(event, {
      s3: s3 as unknown as import("@aws-sdk/client-s3").S3Client,
      primitives: {
        plan: planMock as unknown as typeof import("@hyperframes/producer/distributed").plan,
        renderChunk:
          renderChunkMock as unknown as typeof import("@hyperframes/producer/distributed").renderChunk,
        assemble:
          assembleMock as unknown as typeof import("@hyperframes/producer/distributed").assemble,
      },
      tmpRoot,
      skipChromeResolution: true,
    });

    expect(result.Action).toBe("renderChunk");
    if (result.Action !== "renderChunk") throw new Error("unreachable");
    expect(result.ChunkIndex).toBe(2);
    expect(result.Sha256).toBe("0".repeat(64));
    expect(result.FramesEncoded).toBe(240);
    expect(result.CaptureMode).toBe("beginframe");
    expect(renderChunkMock).toHaveBeenCalledTimes(1);
  });

  it("gives a chunk as many capture browsers as the function's memory can host", async () => {
    const tmpRoot = makeTmpRoot();
    const s3 = new FakeS3Client();
    s3.objects.set("s3://bucket/plan.tar.gz", await makeMinimalPlanTar());
    const renderChunkMock = mock(
      async (
        _planDir: string,
        _chunkIndex: number,
        outputChunkPath: string,
      ): Promise<ChunkResult> => {
        writeFileSync(outputChunkPath, Buffer.from("FAKE-MP4-CHUNK"));
        return {
          outputPath: outputChunkPath,
          outputKind: "file",
          framesEncoded: 121,
          sha256: "0".repeat(64),
          durationMs: 1,
          planHashMs: 1,
          sessionBootMs: 1,
          captureStageMs: 1,
          encodeStageMs: 1,
          workers: 5,
          captureMode: "beginframe",
          perfPath: outputChunkPath + ".perf.json",
        };
      },
    );
    const notCalled = mock(async () => {
      throw new Error("should not be called");
    });
    const renderOnce = () =>
      handler(
        {
          Action: "renderChunk",
          PlanProtocol: "v1",
          PlanS3Uri: "s3://bucket/plan.tar.gz",
          PlanHash: "fakehash",
          ChunkIndex: 0,
          ChunkOutputS3Prefix: "s3://bucket/renders/abc/",
          Format: "mp4",
        },
        {
          s3: s3 as unknown as import("@aws-sdk/client-s3").S3Client,
          primitives: {
            plan: notCalled as unknown as typeof import("@hyperframes/producer/distributed").plan,
            renderChunk:
              renderChunkMock as unknown as typeof import("@hyperframes/producer/distributed").renderChunk,
            assemble:
              notCalled as unknown as typeof import("@hyperframes/producer/distributed").assemble,
          },
          tmpRoot,
          skipChromeResolution: true,
        },
      );
    const saved = process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE;
    const logged: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((line: string) => {
      logged.push(line);
    });
    try {
      delete process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE;
      await renderOnce();
      process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE = "10240";
      await renderOnce();
    } finally {
      if (saved === undefined) delete process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE;
      else process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE = saved;
      logSpy.mockRestore();
    }
    const options = renderChunkMock.mock.calls.map((call) => (call as unknown[])[3]);
    expect(options).toEqual([
      { maxCaptureWorkers: undefined, interleaveCapture: true },
      {
        maxCaptureWorkers: Math.max(1, Math.min(5, availableParallelism() - 1)),
        interleaveCapture: true,
      },
    ]);
    const captures = logged
      .filter((line) => line.includes('"chunk_capture"'))
      .map((line) => JSON.parse(line));
    const capture = {
      event: "chunk_capture",
      chunkIndex: 0,
      workers: 5,
      captureMode: "beginframe",
      setupMs: expect.any(Number),
      chromeMs: expect.any(Number),
      planHashMs: 1,
      sessionBootMs: 1,
      captureStageMs: 1,
      encodeStageMs: 1,
      durationMs: 1,
    };
    expect(captures).toEqual([capture, capture]);
  });

  it("rejects renderChunk when event.PlanHash diverges from plan.json", async () => {
    const tmpRoot = makeTmpRoot();
    const s3 = new FakeS3Client();
    // The fixture's plan.json has planHash="fakehash"; the event below
    // claims something else, so the handler must throw PLAN_HASH_MISMATCH
    // before invoking the primitive.
    s3.objects.set("s3://bucket/plan.tar.gz", await makeMinimalPlanTar());

    const renderChunkMock = mock(async () => {
      throw new Error("primitive should not be called on a hash mismatch");
    });
    const planMock = mock(async () => {
      throw new Error("should not be called");
    });
    const assembleMock = mock(async () => {
      throw new Error("should not be called");
    });

    const event: RenderChunkEvent = {
      Action: "renderChunk",
      PlanProtocol: "v1",
      PlanS3Uri: "s3://bucket/plan.tar.gz",
      PlanHash: "not-the-real-hash",
      ChunkIndex: 0,
      ChunkOutputS3Prefix: "s3://bucket/renders/abc/",
      Format: "mp4",
    };

    let caught: unknown;
    try {
      await handler(event, {
        s3: s3 as unknown as import("@aws-sdk/client-s3").S3Client,
        primitives: {
          plan: planMock as unknown as typeof import("@hyperframes/producer/distributed").plan,
          renderChunk:
            renderChunkMock as unknown as typeof import("@hyperframes/producer/distributed").renderChunk,
          assemble:
            assembleMock as unknown as typeof import("@hyperframes/producer/distributed").assemble,
        },
        tmpRoot,
        skipChromeResolution: true,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe("PLAN_HASH_MISMATCH");
    expect((caught as Error).message).toMatch(/not-the-real-hash/);
    expect(renderChunkMock).not.toHaveBeenCalled();
  });

  it("routes Action='assemble' to the assemble primitive", async () => {
    const tmpRoot = makeTmpRoot();
    const s3 = new FakeS3Client();
    s3.objects.set("s3://bucket/plan.tar.gz", await makeMinimalPlanTar());
    s3.objects.set("s3://bucket/chunks/0001.mp4", Buffer.from("CHUNK-1"));
    s3.objects.set("s3://bucket/chunks/0002.mp4", Buffer.from("CHUNK-2"));

    const assembleMock = mock(
      async (
        _planDir: string,
        _chunkPaths: readonly string[],
        _audioPath: string | null,
        outputPath: string,
      ): Promise<AssembleResult> => {
        writeFileSync(outputPath, Buffer.from("FAKE-FINAL-MP4"));
        return {
          outputPath,
          durationMs: 7777,
          framesEncoded: 480,
          fileSize: 14,
        };
      },
    );

    const event: AssembleEvent = {
      Action: "assemble",
      PlanProtocol: "v1",
      PlanS3Uri: "s3://bucket/plan.tar.gz",
      ChunkS3Uris: ["s3://bucket/chunks/0001.mp4", "s3://bucket/chunks/0002.mp4"],
      AudioS3Uri: null,
      OutputS3Uri: "s3://bucket/renders/abc/output.mp4",
      Format: "mp4",
    };

    const result = await handler(event, {
      s3: s3 as unknown as import("@aws-sdk/client-s3").S3Client,
      primitives: {
        plan: mock(async () => {
          throw new Error("should not be called");
        }) as unknown as typeof import("@hyperframes/producer/distributed").plan,
        renderChunk: mock(async () => {
          throw new Error("should not be called");
        }) as unknown as typeof import("@hyperframes/producer/distributed").renderChunk,
        assemble:
          assembleMock as unknown as typeof import("@hyperframes/producer/distributed").assemble,
      },
      tmpRoot,
      skipChromeResolution: true,
    });

    expect(result.Action).toBe("assemble");
    if (result.Action !== "assemble") throw new Error("unreachable");
    expect(result.OutputS3Uri).toBe("s3://bucket/renders/abc/output.mp4");
    expect(result.FramesEncoded).toBe(480);
    expect(assembleMock).toHaveBeenCalledTimes(1);
  });

  it("defaults omitted plan protocol to v2 across plan → chunk → assemble", async () => {
    const tmpRoot = makeTmpRoot();
    const s3 = new FakeS3Client();
    s3.objects.set("s3://bucket/project.tar.gz", await makeMinimalProjectTar());

    const planV2WithPublisherMock = mock(
      async (
        projectDir: string,
        _config: unknown,
        publisher: PlanV2ArtifactPublisher,
        options: Readonly<{ stagingParentDir?: string }>,
      ): Promise<PlanV2Manifest> => {
        const v1Dir = join(tmpRoot, `v1-${Date.now()}`);
        makeMinimalV1PlanDir(v1Dir, true);
        const manifest = await publishPlanV2FromExecutionPlan(v1Dir, publisher);
        expect(options.stagingParentDir).toBe(dirname(projectDir));
        expect(existsSync(join(dirname(projectDir), "plan-v2"))).toBe(false);
        return manifest;
      },
    );
    const renderChunkMock = mock(
      async (planDir: string, _chunkIndex: number, outputPath: string): Promise<ChunkResult> => {
        expect(existsSync(join(planDir, "audio.m4a"))).toBe(false);
        writeFileSync(outputPath, "V2-CHUNK");
        return {
          outputPath,
          outputKind: "file",
          framesEncoded: 30,
          sha256: "b".repeat(64),
          durationMs: 1,
          planHashMs: 0,
          sessionBootMs: 0,
          captureStageMs: 1,
          encodeStageMs: 0,
          workers: 1,
          captureMode: "beginframe",
          perfPath: `${outputPath}.perf.json`,
        };
      },
    );
    const assembleMock = mock(
      async (
        _planDir: string,
        _chunks: readonly string[],
        audioPath: string | null,
        outputPath: string,
      ): Promise<AssembleResult> => {
        expect(audioPath).not.toBeNull();
        expect(readFileSync(audioPath as string, "utf-8")).toBe("AAC");
        writeFileSync(outputPath, "V2-OUTPUT");
        return { outputPath, durationMs: 1, framesEncoded: 30, fileSize: 9 };
      },
    );
    const deps = {
      s3: s3 as unknown as import("@aws-sdk/client-s3").S3Client,
      primitives: {
        plan: mock(async () => {
          throw new Error("v1 plan should not be called");
        }) as unknown as typeof import("@hyperframes/producer/distributed").plan,
        planV2WithPublisher:
          planV2WithPublisherMock as unknown as typeof import("@hyperframes/producer/distributed").planV2WithPublisher,
        renderChunk:
          renderChunkMock as unknown as typeof import("@hyperframes/producer/distributed").renderChunk,
        assemble:
          assembleMock as unknown as typeof import("@hyperframes/producer/distributed").assemble,
      },
      tmpRoot,
      skipChromeResolution: true,
    };

    const logged: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((line: string) => {
      logged.push(line);
    });
    const planned = await handler(
      {
        Action: "plan",
        ProjectS3Uri: "s3://bucket/project.tar.gz",
        PlanOutputS3Prefix: "s3://bucket/renders/v2/",
        Config: { fps: 30, width: 640, height: 360, format: "mp4" },
      },
      deps,
    ).finally(() => logSpy.mockRestore());
    const stageLines = logged
      .filter((line) => line.includes('"plan_stage"'))
      .map((line) => JSON.parse(line) as { stage?: string; ms?: unknown });
    expect(stageLines.map((line) => line.stage)).toEqual(["download", "untar"]);
    expect(stageLines.every((line) => typeof line.ms === "number")).toBe(true);
    expect(planned).toMatchObject({
      PlanProtocol: "v2",
      PlanV2ManifestS3Uri: "s3://bucket/renders/v2/v2/manifest.json",
      PlanV2ArtifactS3Prefix: "s3://bucket/cas/sha256",
    });
    expect("PlanS3Uri" in planned).toBe(false);
    if (!("PlanProtocol" in planned) || planned.PlanProtocol !== "v2") {
      throw new Error("expected v2 plan result");
    }
    const planUploads = s3.ops.filter((operation) => operation.kind === "upload");
    expect(planUploads.at(-1)?.uri).toBe(planned.PlanV2ManifestS3Uri);
    expect(
      planUploads
        .slice(0, -1)
        .every((operation) => operation.uri.startsWith(`${planned.PlanV2ArtifactS3Prefix}/`)),
    ).toBe(true);

    const beforeChunk = s3.ops.length;
    const chunk = await handler(
      {
        Action: "renderChunk",
        PlanV2ManifestS3Uri: planned.PlanV2ManifestS3Uri,
        PlanV2ArtifactS3Prefix: planned.PlanV2ArtifactS3Prefix,
        PlanHash: planned.PlanHash,
        ChunkIndex: 0,
        ChunkOutputS3Prefix: "s3://bucket/renders/v2/",
        Format: "mp4",
      },
      deps,
    );
    if (chunk.Action !== "renderChunk") throw new Error("expected chunk result");
    expect(chunk.CaptureMode).toBe("beginframe");
    const audioDigest = createHash("sha256").update("AAC").digest("hex");
    const audioUri = `${planned.PlanV2ArtifactS3Prefix}/${audioDigest.slice(0, 2)}/${audioDigest}`;
    expect(s3.ops.slice(beforeChunk).some((operation) => operation.uri === audioUri)).toBe(false);

    await handler(
      {
        Action: "assemble",
        PlanV2ManifestS3Uri: planned.PlanV2ManifestS3Uri,
        PlanV2ArtifactS3Prefix: planned.PlanV2ArtifactS3Prefix,
        PlanHash: planned.PlanHash,
        ChunkS3Uris: [chunk.ChunkS3Uri],
        AudioS3Uri: null,
        OutputS3Uri: "s3://bucket/renders/v2/output.mp4",
        Format: "mp4",
      },
      deps,
    );
    expect(
      s3.ops.some((operation) => operation.kind === "download" && operation.uri === audioUri),
    ).toBe(true);
  });

  it("hands a chunk its deferred video as a pre-signed URL and downloads the rest", async () => {
    const tmpRoot = makeTmpRoot();
    const fake = new FakeS3Client();
    const s3 = presigningClient(fake);
    const v1Dir = join(tmpRoot, "v1");
    makeMinimalV1PlanDir(v1Dir, true, { withDeferredVideo: true });
    const publisher = new S3PlanV2ArtifactPublisher({
      s3,
      planOutputS3Prefix: "s3://bucket/renders/deferred/",
      temporaryRoot: tmpRoot,
    });
    const manifest = await publishPlanV2FromExecutionPlan(v1Dir, publisher);
    const video = manifest.artifacts.find((artifact) => artifact.path === "compiled/clip.mp4")!;
    expect(video.chunks).toEqual([0]);
    const blobUri = (digest: string) =>
      `${publisher.artifactPrefix}/${digest.slice(0, 2)}/${digest}`;

    let marker: { remoteSources?: Record<string, string> } = {};
    const renderChunkMock = mock(
      async (planDir: string, _chunkIndex: number, outputPath: string): Promise<ChunkResult> => {
        expect(existsSync(join(planDir, "compiled", "clip.mp4"))).toBe(false);
        marker = JSON.parse(readFileSync(join(planDir, PLAN_V2_MATERIALIZATION_MARKER), "utf-8"));
        writeFileSync(outputPath, "CHUNK");
        return {
          outputPath,
          outputKind: "file",
          framesEncoded: 30,
          sha256: "c".repeat(64),
          durationMs: 1,
          planHashMs: 0,
          sessionBootMs: 0,
          captureStageMs: 1,
          encodeStageMs: 0,
          workers: 1,
          captureMode: "beginframe",
          perfPath: `${outputPath}.perf.json`,
        };
      },
    );
    const beforeChunk = fake.ops.length;
    await handler(
      {
        Action: "renderChunk",
        PlanV2ManifestS3Uri: publisher.manifestUri,
        PlanV2ArtifactS3Prefix: publisher.artifactPrefix,
        PlanHash: manifest.planHash,
        ChunkIndex: 0,
        ChunkOutputS3Prefix: "s3://bucket/renders/deferred/",
        Format: "mp4",
      },
      {
        s3,
        primitives: {
          plan: mock() as unknown as typeof import("@hyperframes/producer/distributed").plan,
          renderChunk:
            renderChunkMock as unknown as typeof import("@hyperframes/producer/distributed").renderChunk,
          assemble:
            mock() as unknown as typeof import("@hyperframes/producer/distributed").assemble,
        },
        tmpRoot,
        skipChromeResolution: true,
      },
    );

    const downloads = fake.ops
      .slice(beforeChunk)
      .filter((operation) => operation.kind === "download")
      .map((operation) => operation.uri);
    const expectedDownloads = manifest.artifacts
      .filter((artifact) => artifact.chunks === "all")
      .map((artifact) => blobUri(artifact.sha256));
    expect(new Set(downloads)).toEqual(new Set([publisher.manifestUri, ...expectedDownloads]));
    const url = new URL(marker.remoteSources?.["compiled/clip.mp4"] ?? "");
    expect(url.protocol).toBe("https:");
    expect(url.pathname).toEndWith(`/${video.sha256}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
  });

  async function planStitched(
    chunkCount: number,
    separateAudio = false,
    workerConcurrency?: number,
    format: "mp4" | "webm" | "mov" = "mp4",
  ) {
    const tmpRoot = makeTmpRoot();
    const s3 = new FakeS3Client();
    s3.objects.set("s3://bucket/project.tar.gz", await makeMinimalProjectTar());
    const assembleMock = mock(
      async (_p: string, _c: readonly string[], _a: string | null, outputPath: string) => {
        writeFileSync(outputPath, "LOCAL-JOIN");
        return { outputPath, durationMs: 1, framesEncoded: 30 * chunkCount, fileSize: 10 };
      },
    );
    const planV2WithPublisherMock = mock(
      async (_dir: string, _config: unknown, publisher: PlanV2ArtifactPublisher) => {
        const v1Dir = join(tmpRoot, "v1");
        makeMinimalV1PlanDir(v1Dir, !separateAudio, {
          chunkCount,
          chunksCarryAudio: !separateAudio && format === "mp4",
          separateAudio,
          format,
        });
        return publishPlanV2FromExecutionPlan(v1Dir, publisher);
      },
    );
    const deps = {
      s3: s3 as unknown as import("@aws-sdk/client-s3").S3Client,
      primitives: {
        planV2WithPublisher:
          planV2WithPublisherMock as unknown as typeof import("@hyperframes/producer/distributed").planV2WithPublisher,
        assemble:
          assembleMock as unknown as typeof import("@hyperframes/producer/distributed").assemble,
      },
      tmpRoot,
      skipChromeResolution: true,
    };
    const planned = await handler(
      {
        Action: "plan",
        ProjectS3Uri: "s3://bucket/project.tar.gz",
        PlanOutputS3Prefix: "s3://bucket/renders/f/",
        Config: { fps: 30, width: 640, height: 360, format, workerConcurrency },
      },
      deps,
    );
    if (!("PlanProtocol" in planned) || planned.PlanProtocol !== "v2")
      throw new Error("expected v2");
    const assemble = (chunkS3Uris: string[], audioS3Uri: string | null = null) =>
      handler(
        {
          Action: "assemble",
          PlanV2ManifestS3Uri: planned.PlanV2ManifestS3Uri,
          PlanV2ArtifactS3Prefix: planned.PlanV2ArtifactS3Prefix,
          PlanHash: planned.PlanHash,
          ChunkS3Uris: chunkS3Uris,
          AudioS3Uri: audioS3Uri,
          OutputS3Uri: `s3://bucket/renders/f/output.${format}`,
          Format: format,
        },
        deps,
      );
    return { s3, assembleMock, assemble, planV2WithPublisherMock, planned };
  }

  it("keeps a worker free for the audio task, and keeps the audio in a plan with one worker", async () => {
    const planOptions = (run: Awaited<ReturnType<typeof planStitched>>) =>
      (run.planV2WithPublisherMock.mock.calls[0] as unknown[])[3];
    const four = await planStitched(8, true, 4);
    expect(planOptions(four)).toMatchObject({ deferAudio: true });
    expect([four.planned.SeparateAudio, four.planned.MaxChunkConcurrency]).toEqual([true, 3]);
    const one = await planStitched(8, false, 1);
    expect(planOptions(one)).toMatchObject({ deferAudio: false });
    expect([one.planned.SeparateAudio, one.planned.MaxChunkConcurrency]).toEqual([false, 1]);
    for (const [reserved, separate, chunks] of [
      ["2", true, 1],
      ["1", false, 1],
    ] as const) {
      process.env.HYPERFRAMES_LAMBDA_RESERVED_CONCURRENCY = reserved;
      try {
        const run = await planStitched(8, separate, undefined);
        expect(planOptions(run)).toMatchObject({ deferAudio: separate });
        expect([run.planned.SeparateAudio, run.planned.MaxChunkConcurrency]).toEqual([
          separate,
          chunks,
        ]);
      } finally {
        delete process.env.HYPERFRAMES_LAMBDA_RESERVED_CONCURRENCY;
      }
    }
  });

  it.skipIf(spawnSync("ffmpeg", ["-version"]).status !== 0)(
    "stitches mp4 chunks inside S3 instead of joining them locally",
    async () => {
      const { s3, assembleMock, assemble } = await planStitched(2);
      const chunks = [0, 1].map((index) => {
        const path = join(makeTmpRoot(), "chunk.mp4");
        const lavfi = ["testsrc2=size=64x48:rate=30:duration=1", "sine=duration=1"];
        const muxed = spawnSync("ffmpeg", [
          ...["-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", lavfi[0]!],
          ...["-f", "lavfi", "-i", lavfi[1]!, "-c:v", "libx264", "-bf", "0", "-c:a", "aac"],
          ...["-shortest", "-y", path],
        ]);
        if (muxed.status !== 0) throw new Error(String(muxed.stderr));
        const uri = `s3://bucket/renders/f/chunks/000${index}.mp4`;
        s3.objects.set(uri, readFileSync(path));
        return uri;
      });
      const result = await assemble(chunks);
      const output = s3.objects.get("s3://bucket/renders/f/output.mp4")!;
      expect(output.toString("latin1", 4, 8)).toBe("ftyp");
      expect(
        output.toString("latin1", output.readUInt32BE(0) + 4, output.readUInt32BE(0) + 8),
      ).toBe("moov");
      expect(result).toMatchObject({ FramesEncoded: 60, FileSize: output.length });
      expect(assembleMock).not.toHaveBeenCalled();
    },
  );

  it.skipIf(spawnSync("ffmpeg", ["-version"]).status !== 0)(
    "stitches the audio task's track in when the plan left its audio out",
    async () => {
      const { s3, assemble, planV2WithPublisherMock } = await planStitched(2, true);
      expect((planV2WithPublisherMock.mock.calls[0] as unknown[])[3]).toMatchObject({
        chunksCarryAudio: true,
        deferAudio: true,
      });
      const ffmpeg = (args: string[], path: string) => {
        const run = spawnSync("ffmpeg", ["-nostdin", "-loglevel", "error", ...args, "-y", path]);
        if (run.status !== 0) throw new Error(String(run.stderr));
        return readFileSync(path);
      };
      const chunks = [0, 1].map((index) => {
        const uri = `s3://bucket/renders/f/chunks/000${index}.mp4`;
        const lavfi = ["-f", "lavfi", "-i", "testsrc2=size=64x48:rate=30:duration=1"];
        s3.objects.set(
          uri,
          ffmpeg([...lavfi, "-c:v", "libx264", "-bf", "0"], join(makeTmpRoot(), "chunk.mp4")),
        );
        return uri;
      });
      const audioUri = "s3://bucket/renders/f/audio/audio.m4a";
      s3.objects.set(
        audioUri,
        ffmpeg(
          ["-f", "lavfi", "-i", "sine=duration=2", "-c:a", "aac"],
          join(makeTmpRoot(), "a.m4a"),
        ),
      );
      await assemble(chunks, audioUri);
      const outputPath = join(makeTmpRoot(), "out.mp4");
      writeFileSync(outputPath, s3.objects.get("s3://bucket/renders/f/output.mp4")!);
      const probe = spawnSync(
        "ffprobe",
        ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", "--", outputPath],
        { encoding: "utf-8" },
      );
      expect(probe.stdout.trim().split("\n").sort()).toEqual(["audio", "video"]);
    },
  );

  it.each(["webm", "mov"] as const)(
    "joins %s chunks with the audio task's track when the plan left its audio out",
    async (format) => {
      const { s3, assembleMock, assemble, planned } = await planStitched(2, true, 4, format);
      expect(planned.SeparateAudio).toBe(true);
      const audioUri = "s3://bucket/renders/f/audio/audio.m4a";
      s3.objects.set(audioUri, Buffer.from("AAC-FROM-AUDIO-TASK"));
      let audio: string | null = null;
      assembleMock.mockImplementationOnce(async (_p, _c, audioPath, outputPath) => {
        audio = audioPath && readFileSync(audioPath, "utf-8");
        writeFileSync(outputPath, "LOCAL-JOIN");
        return { outputPath, durationMs: 1, framesEncoded: 60, fileSize: 10 };
      });
      const chunks = [0, 1].map((index) => {
        const uri = `s3://bucket/renders/f/chunks/000${index}.${format}`;
        s3.objects.set(uri, Buffer.from("CHUNK"));
        return uri;
      });
      await assemble(chunks, audioUri);
      expect(assembleMock).toHaveBeenCalledTimes(1);
      expect(audio).toBe("AAC-FROM-AUDIO-TASK");
    },
  );

  it("refuses an audio URI for a v2 plan that ships its own audio", async () => {
    const { assemble } = await planStitched(1);
    await expect(
      assemble(["s3://bucket/renders/f/chunks/0000.mp4"], "s3://bucket/renders/f/audio/audio.m4a"),
    ).rejects.toMatchObject({ name: "PLAN_PROTOCOL_UNSUPPORTED" });
  });

  it("rejects unknown plan protocol values", async () => {
    const tmpRoot = makeTmpRoot();
    const s3 = new FakeS3Client();

    await expect(
      handler(
        {
          Action: "plan",
          PlanProtocol: "v3",
          ProjectS3Uri: "s3://bucket/project.tar.gz",
          PlanOutputS3Prefix: "s3://bucket/renders/invalid/",
          Config: { fps: 30, width: 640, height: 360, format: "mp4" },
        } as unknown as LambdaEvent,
        {
          s3: s3 as unknown as import("@aws-sdk/client-s3").S3Client,
          tmpRoot,
          skipChromeResolution: true,
        },
      ),
    ).rejects.toMatchObject({ name: "PLAN_PROTOCOL_UNSUPPORTED" });
    expect(s3.ops).toHaveLength(0);
  });

  it("rejects mixed v1/v2 plan locators at runtime", async () => {
    const tmpRoot = makeTmpRoot();
    const s3 = new FakeS3Client();

    await expect(
      handler(
        {
          Action: "renderChunk",
          PlanS3Uri: "s3://bucket/plan.tar.gz",
          PlanHash: "fakehash",
          ChunkIndex: 0,
          ChunkOutputS3Prefix: "s3://bucket/renders/mixed/",
          Format: "mp4",
        } as unknown as LambdaEvent,
        {
          s3: s3 as unknown as import("@aws-sdk/client-s3").S3Client,
          tmpRoot,
          skipChromeResolution: true,
        },
      ),
    ).rejects.toMatchObject({
      name: "PLAN_PROTOCOL_UNSUPPORTED",
      message: expect.stringContaining("mixed or missing plan locators"),
    });
    expect(s3.ops).toHaveLength(0);
  });

  it("rejects unknown actions", async () => {
    const tmpRoot = makeTmpRoot();
    await expect(
      handler({ Action: "doSomething" } as unknown as LambdaEvent, {
        s3: new FakeS3Client() as unknown as import("@aws-sdk/client-s3").S3Client,
        tmpRoot,
        skipChromeResolution: true,
      }),
    ).rejects.toThrow(/no recognised Action/);
  });
});

describe("handler — audio", () => {
  async function runAudio(config: Record<string, unknown>) {
    const tmpRoot = makeTmpRoot();
    const s3 = new FakeS3Client();
    s3.objects.set("s3://bucket/project.tar.gz", await makeMinimalProjectTar());
    const buildPlanAudio = mock(
      async (_project: string, _config: unknown, _work: string, outputPath: string) => {
        writeFileSync(outputPath, "AAC");
        return { hasAudio: true };
      },
    );
    const result = await handler(
      {
        Action: "audio",
        ProjectS3Uri: "s3://bucket/project.tar.gz",
        PlanOutputS3Prefix: "s3://bucket/renders/f/",
        Config: { fps: 30, width: 640, height: 360, format: "mp4", ...config },
      } as LambdaEvent,
      {
        s3: s3 as unknown as import("@aws-sdk/client-s3").S3Client,
        primitives: { buildPlanAudio } as unknown as NonNullable<
          Parameters<typeof handler>[1]
        >["primitives"],
        tmpRoot,
        skipChromeResolution: true,
      },
    );
    return { result, s3, buildPlanAudio };
  }

  it("mixes a plan's deferred audio and uploads it beside the plan", async () => {
    const { result, s3, buildPlanAudio } = await runAudio({});
    expect(result).toMatchObject({
      Action: "audio",
      HasAudio: true,
      AudioS3Uri: "s3://bucket/renders/f/audio/audio.m4a",
    });
    expect(s3.objects.get("s3://bucket/renders/f/audio/audio.m4a")?.toString()).toBe("AAC");
    expect(buildPlanAudio).toHaveBeenCalledTimes(1);
  });

  it.each(["webm", "mov"])(
    "mixes %s audio too, so one function makes every audio byte",
    async (format) => {
      const { result, buildPlanAudio } = await runAudio({ format });
      expect(result).toMatchObject({ Action: "audio", HasAudio: true });
      expect(buildPlanAudio).toHaveBeenCalledTimes(1);
    },
  );

  it.each([{ cfr: true }, { format: "png-sequence" }])(
    "leaves the audio to the plan for %o",
    async (config) => {
      const { result, s3, buildPlanAudio } = await runAudio(config);
      expect(result).toMatchObject({ Action: "audio", HasAudio: false, AudioS3Uri: null });
      expect(buildPlanAudio).not.toHaveBeenCalled();
      expect(s3.ops).toHaveLength(0);
    },
  );
});

/** A real client (so it can pre-sign offline) whose requests go to the fake. */
function presigningClient(fake: FakeS3Client): import("@aws-sdk/client-s3").S3Client {
  const client = new S3Client({
    region: "us-east-2",
    credentials: { accessKeyId: "AKIDTEST", secretAccessKey: "test-secret" },
  });
  client.send = fake.send.bind(fake) as S3Client["send"];
  return client;
}

describe("handler — plan from a deployed site", () => {
  function storeSiteFile(s3: FakeS3Client, bytes: string): string {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const uri = `s3://bucket/cas/sha256/${sha256.slice(0, 2)}/${sha256}`;
    s3.objects.set(uri, Buffer.from(bytes));
    s3.metadata.set(uri, { sha256 });
    return sha256;
  }

  function planEvent(): PlanEvent {
    return {
      Action: "plan",
      ProjectS3Uri: "s3://bucket/sites/site1/files.json",
      PlanOutputS3Prefix: "s3://bucket/renders/r1/",
      Config: { fps: 30, width: 640, height: 360, format: "mp4" },
    };
  }

  it("plans a site's video in place: never downloads, never uploads its bytes", async () => {
    const s3 = new FakeS3Client();
    const html = storeSiteFile(s3, "<html></html>");
    const media = storeSiteFile(s3, "VIDEO-BYTES");
    s3.objects.set(
      "s3://bucket/sites/site1/files.json",
      Buffer.from(
        JSON.stringify({
          files: [
            { path: "assets/bg.mp4", sha256: media, sizeBytes: 11 },
            { path: "index.html", sha256: html, sizeBytes: 13 },
          ],
        }),
      ),
    );
    const planV2WithPublisher = mock(
      async (
        projectDir: string,
        _config: unknown,
        publisher: PlanV2ArtifactPublisher,
        options: PlanV2WithPublisherOptions,
      ) => {
        expect(readFileSync(join(projectDir, "index.html"), "utf-8")).toBe("<html></html>");
        expect(existsSync(join(projectDir, "assets", "bg.mp4"))).toBe(false);
        const remote = options.remoteFiles?.["assets/bg.mp4"];
        expect(remote).toMatchObject({ sha256: media, sizeBytes: 11 });
        expect(remote?.url).toContain(`/cas/sha256/${media.slice(0, 2)}/${media}?`);
        expect(remote?.url).toContain("X-Amz-Signature=");
        await publisher.referenceStoredBlob!({ sha256: media, sizeBytes: 11 });
        const manifest = {
          planHash: "c".repeat(64),
          chunkCount: 1,
          totalFrames: 30,
          fps: 30,
          width: 640,
          height: 360,
          format: "mp4",
          ffmpegVersion: "test",
          producerVersion: "test",
          artifacts: [{ path: "compiled/assets/bg.mp4", sha256: media, sizeBytes: 11 }],
        };
        await publisher.commitManifest(JSON.stringify(manifest));
        return manifest as unknown as PlanV2Manifest;
      },
    );

    const result = await handler(planEvent(), {
      s3: presigningClient(s3),
      primitives: {
        plan: mock() as unknown as typeof import("@hyperframes/producer/distributed").plan,
        planV2WithPublisher:
          planV2WithPublisher as unknown as typeof import("@hyperframes/producer/distributed").planV2WithPublisher,
        renderChunk:
          mock() as unknown as typeof import("@hyperframes/producer/distributed").renderChunk,
        assemble: mock() as unknown as typeof import("@hyperframes/producer/distributed").assemble,
      },
      tmpRoot: makeTmpRoot(),
      skipChromeResolution: true,
    });

    expect(result).toMatchObject({ PlanV2ArtifactS3Prefix: "s3://bucket/cas/sha256" });
    expect(planV2WithPublisher).toHaveBeenCalledTimes(1);
    expect(s3.ops.filter((op) => op.kind === "upload").map((op) => op.uri)).toEqual([
      "s3://bucket/renders/r1/v2/manifest.json",
    ]);
    expect(s3.ops.some((op) => op.uri.endsWith(".tar.gz"))).toBe(false);
    const mediaKey = `s3://bucket/cas/sha256/${media.slice(0, 2)}/${media}`;
    expect(s3.ops.filter((op) => op.uri === mediaKey && op.kind === "download")).toEqual([]);
  });

  it("refuses a site manifest path that escapes the project", async () => {
    const s3 = new FakeS3Client();
    const sha256 = storeSiteFile(s3, "x");
    s3.objects.set(
      "s3://bucket/sites/site1/files.json",
      Buffer.from(JSON.stringify({ files: [{ path: "../escape", sha256, sizeBytes: 1 }] })),
    );
    const planV2WithPublisher = mock();
    await expect(
      handler(planEvent(), {
        s3: s3 as unknown as import("@aws-sdk/client-s3").S3Client,
        primitives: {
          plan: mock() as unknown as typeof import("@hyperframes/producer/distributed").plan,
          planV2WithPublisher:
            planV2WithPublisher as unknown as typeof import("@hyperframes/producer/distributed").planV2WithPublisher,
          renderChunk:
            mock() as unknown as typeof import("@hyperframes/producer/distributed").renderChunk,
          assemble:
            mock() as unknown as typeof import("@hyperframes/producer/distributed").assemble,
        },
        tmpRoot: makeTmpRoot(),
        skipChromeResolution: true,
      }),
    ).rejects.toMatchObject({ name: "SITE_MANIFEST_INVALID" });
    expect(planV2WithPublisher).not.toHaveBeenCalled();
  });
});

describe("handler — S3 URI allowlist (security: F-004)", () => {
  let prevBucket: string | undefined;

  beforeEach(() => {
    prevBucket = process.env.HYPERFRAMES_RENDER_BUCKET;
  });

  afterEach(() => {
    if (prevBucket === undefined) {
      delete process.env.HYPERFRAMES_RENDER_BUCKET;
    } else {
      process.env.HYPERFRAMES_RENDER_BUCKET = prevBucket;
    }
  });

  it("rejects a plan event whose ProjectS3Uri is outside the allowed bucket", async () => {
    process.env.HYPERFRAMES_RENDER_BUCKET = "good-bucket";
    const tmpRoot = makeTmpRoot();
    const s3 = new FakeS3Client();

    const event: PlanEvent = {
      Action: "plan",
      ProjectS3Uri: "s3://evil-bucket/project.tar.gz",
      PlanOutputS3Prefix: "s3://good-bucket/renders/abc/",
      Config: { fps: 30, width: 1920, height: 1080, format: "mp4" },
    };
    const deps = {
      s3: s3 as unknown as import("@aws-sdk/client-s3").S3Client,
      tmpRoot,
      skipChromeResolution: true,
    };

    await expect(handler(event, deps)).rejects.toMatchObject({
      name: "S3_URI_NOT_ALLOWED",
      message: expect.stringContaining("evil-bucket"),
    });
    expect(s3.ops).toHaveLength(0);
  });

  it("rejects an assemble event with a cross-bucket chunk URI", async () => {
    process.env.HYPERFRAMES_RENDER_BUCKET = "good-bucket";
    const tmpRoot = makeTmpRoot();
    const s3 = new FakeS3Client();

    const event: AssembleEvent = {
      Action: "assemble",
      PlanProtocol: "v1",
      PlanS3Uri: "s3://good-bucket/plan.tar.gz",
      ChunkS3Uris: ["s3://good-bucket/chunks/0001.mp4", "s3://evil-bucket/chunks/0002.mp4"],
      AudioS3Uri: null,
      OutputS3Uri: "s3://good-bucket/renders/abc/output.mp4",
      Format: "mp4",
    };
    const deps = {
      s3: s3 as unknown as import("@aws-sdk/client-s3").S3Client,
      tmpRoot,
      skipChromeResolution: true,
    };

    await expect(handler(event, deps)).rejects.toMatchObject({ name: "S3_URI_NOT_ALLOWED" });
    expect(s3.ops).toHaveLength(0);
  });

  it("rejects a stitchParts range outside the allowed bucket", async () => {
    process.env.HYPERFRAMES_RENDER_BUCKET = "good-bucket";
    const s3 = new FakeS3Client();
    const event: StitchPartsEvent = {
      Action: "stitchParts",
      Bucket: "good-bucket",
      Key: "renders/abc/output.mp4",
      UploadId: "upload-1",
      Parts: [{ partNumber: 2, ranges: [{ uri: "s3://evil-bucket/secret", start: 0, end: 4 }] }],
    };
    await expect(
      handler(event, { s3: s3 as unknown as S3Client, skipChromeResolution: true }),
    ).rejects.toMatchObject({ name: "S3_URI_NOT_ALLOWED" });
    expect(s3.ops).toHaveLength(0);
  });
});

describe("handler — stitch helpers", () => {
  const event = (uri: string): StitchPartsEvent => ({
    Action: "stitchParts",
    Bucket: "bucket",
    Key: "renders/abc/output.mp4",
    UploadId: "upload-1",
    Parts: [
      { partNumber: 3, ranges: [{ uri, start: 1, end: 4 }] },
      {
        partNumber: 4,
        ranges: [
          { uri, start: 0, end: 2 },
          { uri, start: 4, end: 6 },
        ],
      },
    ],
  });

  it("builds the parts a stitchParts call names and returns their ETags in order", async () => {
    const s3 = new FakeS3Client();
    s3.objects.set("s3://bucket/chunks/0.mp4", Buffer.from("abcdef"));
    const result = await handler(event("s3://bucket/chunks/0.mp4"), {
      s3: s3 as unknown as S3Client,
      skipChromeResolution: true,
    });
    expect(result).toEqual({ Action: "stitchParts", ETags: ['"part-3"', '"part-4"'] });
    expect([s3.parts.get(3)?.toString(), s3.parts.get(4)?.toString()]).toEqual(["bcd", "abef"]);
  });

  it("the stitch helper invokes the function the stack names and fails with its error", async () => {
    const prev = process.env.HYPERFRAMES_STITCH_FUNCTION;
    const prevReserved = process.env.HYPERFRAMES_LAMBDA_RESERVED_CONCURRENCY;
    delete process.env.HYPERFRAMES_STITCH_FUNCTION;
    expect(stitchHelper()).toBeUndefined();
    process.env.HYPERFRAMES_STITCH_FUNCTION = "proj-video";
    try {
      // A reservation of 8 leaves 7 slots once this assemble holds one.
      process.env.HYPERFRAMES_LAMBDA_RESERVED_CONCURRENCY = "8";
      expect(stitchHelper()!.maxInvocations).toBe(7);
      process.env.HYPERFRAMES_LAMBDA_RESERVED_CONCURRENCY = "-1";
      expect(stitchHelper()!.maxInvocations).toBe(Infinity);
      const s3 = new FakeS3Client();
      s3.objects.set("s3://bucket/chunks/0.mp4", Buffer.from("abcdef"));
      const invoked: string[] = [];
      const lambda = {
        send: async (command: { input: { FunctionName: string; Payload: string } }) => {
          invoked.push(command.input.FunctionName);
          const sent = JSON.parse(command.input.Payload) as StitchPartsEvent;
          if (sent.Parts[0]!.ranges[0]!.uri.endsWith("missing")) {
            const payload = JSON.stringify({ errorMessage: "NoSuchKey", errorType: "NoSuchKey" });
            return { FunctionError: "Unhandled", Payload: new TextEncoder().encode(payload) };
          }
          const out = await handler(sent, { s3: s3 as unknown as S3Client });
          return { Payload: new TextEncoder().encode(JSON.stringify(out)) };
        },
      } as unknown as LambdaClient;
      const { send } = stitchHelper(lambda)!;
      const target = { Bucket: "bucket", Key: "renders/abc/output.mp4", UploadId: "upload-1" };
      expect(await send(target, event("s3://bucket/chunks/0.mp4").Parts)).toEqual([
        '"part-3"',
        '"part-4"',
      ]);
      await expect(send(target, event("s3://bucket/missing").Parts)).rejects.toMatchObject({
        name: "NoSuchKey",
        message: expect.stringContaining("stitchParts on proj-video failed: NoSuchKey"),
      });
      expect(invoked).toEqual(["proj-video", "proj-video"]);
    } finally {
      if (prev === undefined) delete process.env.HYPERFRAMES_STITCH_FUNCTION;
      else process.env.HYPERFRAMES_STITCH_FUNCTION = prev;
      if (prevReserved === undefined) delete process.env.HYPERFRAMES_LAMBDA_RESERVED_CONCURRENCY;
      else process.env.HYPERFRAMES_LAMBDA_RESERVED_CONCURRENCY = prevReserved;
    }
  });
});

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Build the smallest valid `.tar.gz` the handler's untar step accepts: a
 * single file inside an archive. Uses the npm `tar` package (same as
 * `s3Transport.ts`) so the fixture builder runs cross-platform — Windows
 * doesn't ship GNU tar in `/usr/bin/tar`, and bare Alpine containers
 * don't ship `tar` at all. Keeps the test runnable everywhere the rest
 * of the suite runs.
 */
async function makeMinimalProjectTar(): Promise<Buffer> {
  const tar = await import("tar");
  const { mkdtempSync: mk, readFileSync, rmSync: rm, writeFileSync: wf } = await import("node:fs");
  const dir = mk(join(tmpdir(), "hf-lambda-mktar-"));
  try {
    wf(join(dir, "index.html"), "<!doctype html><title>test</title>");
    const tarPath = join(dir, "out.tar.gz");
    await tar.create({ gzip: true, file: tarPath, cwd: dir }, ["index.html"]);
    return readFileSync(tarPath);
  } finally {
    rm(dir, { recursive: true, force: true });
  }
}

/**
 * Build a minimal `.tar.gz` for a tiny planDir containing `plan.json` +
 * `meta/chunks.json`. Used by renderChunk/assemble tests where the handler
 * untars but the mock primitive doesn't inspect contents.
 */
async function makeMinimalPlanTar(): Promise<Buffer> {
  const tar = await import("tar");
  const {
    mkdtempSync: mk,
    mkdirSync: md,
    readFileSync: rf,
    writeFileSync: wf,
  } = await import("node:fs");
  const dir = mk(join(tmpdir(), "hf-lambda-test-plan-"));
  tmpDirs.push(dir);
  md(join(dir, "meta"), { recursive: true });
  wf(join(dir, "plan.json"), JSON.stringify({ planHash: "fakehash" }));
  wf(join(dir, "meta", "chunks.json"), "[]");
  const tarPath = join(dir, "out.tar.gz");
  await tar.create({ gzip: true, file: tarPath, cwd: dir }, ["plan.json", "meta"]);
  return rf(tarPath);
}

function makeMinimalV1PlanDir(
  dir: string,
  withAudio: boolean,
  options: {
    chunkCount?: number;
    chunksCarryAudio?: boolean;
    separateAudio?: boolean;
    withDeferredVideo?: boolean;
    format?: string;
  } = {},
): void {
  const chunkCount = options.chunkCount ?? 1;
  mkdirSync(join(dir, "meta"), { recursive: true });
  mkdirSync(join(dir, "compiled"), { recursive: true });
  writeFileSync(join(dir, "compiled", "index.html"), "<html>aws v2 fixture</html>");
  const planJson = {
    planHash: "a".repeat(64),
    chunkCount,
    totalFrames: 30 * chunkCount,
    dimensions: {
      fpsNum: 30,
      fpsDen: 1,
      width: 640,
      height: 360,
      format: options.format ?? "mp4",
    },
    ffmpegVersion: "6.0",
    producerVersion: "test",
    fontSnapshotSha: "font-snapshot-test",
  };
  writeFileSync(join(dir, "plan.json"), JSON.stringify(planJson));
  writeFileSync(
    join(dir, "meta", "chunks.json"),
    JSON.stringify(
      Array.from({ length: chunkCount }, (_, index) => ({
        index,
        startFrame: index * 30,
        endFrame: (index + 1) * 30,
      })),
    ),
  );
  writeFileSync(
    join(dir, "meta", "encoder.json"),
    JSON.stringify({
      ...(options.chunksCarryAudio ? { chunksCarryAudio: true } : {}),
      ...(options.separateAudio ? { separateAudio: true } : {}),
    }),
  );
  if (withAudio) writeFileSync(join(dir, "audio.m4a"), "AAC");
  if (options.withDeferredVideo) writeDeferredVideo(dir);
  planJson.planHash = recomputePlanHashFromPlanDir(dir);
  writeFileSync(join(dir, "plan.json"), JSON.stringify(planJson));
}

/** One clip the chunk extracts from `compiled/clip.mp4` itself. */
function writeDeferredVideo(dir: string): void {
  writeFileSync(join(dir, "compiled", "clip.mp4"), "VIDEO-BYTES");
  const metadata = {
    durationSeconds: 1,
    videoStreamDurationSeconds: 1,
    width: 640,
    height: 360,
    fps: 30,
    videoCodec: "h264",
    hasAudio: false,
    isVFR: false,
    hasAlpha: false,
    colorSpace: null,
  };
  const videos = {
    videos: [
      {
        id: "clip",
        src: "clip.mp4",
        start: 0,
        end: 1,
        mediaStart: 0,
        loop: false,
        hasAudio: false,
      },
    ],
    extracted: [
      {
        videoId: "clip",
        srcPath: "/planner/clip.mp4",
        framePattern: "frame_%05d.jpg",
        fps: 30,
        totalFrames: 30,
        metadata,
        deferredRange: {
          sourcePath: "compiled/clip.mp4",
          startTime: 0,
          durationSeconds: 1,
          format: "jpg",
        },
      },
    ],
  };
  writeFileSync(join(dir, "meta", "videos.json"), JSON.stringify(videos));
}
