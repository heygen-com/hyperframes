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

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssembleResult, ChunkResult, PlanResult } from "@hyperframes/producer/distributed";
import type { AssembleEvent, LambdaEvent, PlanEvent, RenderChunkEvent } from "./events.js";
import { handler, unwrapEvent } from "./handler.js";

interface FakeS3Op {
  kind: "download" | "upload";
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

  // Methods called by the real S3 transport — minimal surface so the
  // handler's call sites don't need rewriting under test.
  async send(command: unknown): Promise<unknown> {
    const op = command as { input: { Bucket: string; Key: string } } & {
      constructor: { name: string };
    };
    const cmdName = op.constructor?.name ?? "";
    const uri = `s3://${op.input.Bucket}/${op.input.Key}`;
    if (cmdName === "GetObjectCommand") {
      const bytes = this.objects.get(uri) ?? Buffer.alloc(0);
      this.ops.push({ kind: "download", uri, bytes: bytes.length });
      // Mock the AWS SDK stream contract just enough for pipeline() to
      // pump bytes into a write stream.
      const { Readable } = await import("node:stream");
      return { Body: Readable.from([bytes]) };
    }
    if (cmdName === "PutObjectCommand") {
      // Buffer the body so we can record how many bytes were uploaded; the
      // handler's hot path streams from disk, but tests pin the count.
      const body = (command as { input: { Body: NodeJS.ReadableStream | Buffer } }).input.Body;
      let bytes = 0;
      if (Buffer.isBuffer(body)) {
        bytes = body.length;
      } else if (body && typeof (body as NodeJS.ReadableStream).pipe === "function") {
        for await (const chunk of body as NodeJS.ReadableStream) {
          bytes += (chunk as Buffer).length;
        }
      }
      this.ops.push({ kind: "upload", uri, bytes });
      this.objects.set(uri, Buffer.alloc(bytes));
      return {};
    }
    return {};
  }
}

const tmpDirs: string[] = [];

beforeEach(() => {
  // Each test gets its own tmp root so concurrent test runs don't share state.
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
  it("routes Action='plan' to the plan primitive", async () => {
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
    expect(renderChunkMock).not.toHaveBeenCalled();
    expect(assembleMock).not.toHaveBeenCalled();
    // Plan should have downloaded the project zip and uploaded the plan tar.
    expect(
      s3.ops.some((o) => o.kind === "download" && o.uri === "s3://bucket/project.tar.gz"),
    ).toBe(true);
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
    expect(renderChunkMock).toHaveBeenCalledTimes(1);
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
