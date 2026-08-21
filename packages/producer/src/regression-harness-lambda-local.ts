/**
 * Lambda-local render path for the regression harness.
 *
 * Drives the OSS `@hyperframes/aws-lambda` handler through the exact
 * sequence Step Functions invokes in production:
 *
 *     handler({ Action: "plan" })              → planDir tarball on S3
 *     handler({ Action: "renderChunk" }) × N   → chunk artifacts on S3
 *     handler({ Action: "assemble" })          → final mp4 / mov / png-seq
 *
 * The S3 client is a filesystem-backed fake: every `s3://test-bucket/<key>`
 * URI maps to `<tempRoot>/s3/<key>`. This means the harness exercises
 * the handler's event-parsing + tar / S3 layout + dispatch logic in
 * addition to the underlying producer primitives, catching regressions
 * (event JSON drift, S3 key conventions, plan-hash boundary checks)
 * that `distributed-simulated` mode wouldn't.
 *
 * `lambda-local` is **deliberately** not a Docker / RIE invocation —
 * that would gate the producer test suite on Docker-in-Docker support
 * which most CI runners lack. Real-ZIP-via-RIE tests live in
 * `packages/aws-lambda/scripts/` (`probe:beginframe`) and the
 * maintainer-run `smoke.sh`.
 */

import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { downloadS3ObjectToFile, tarDirectory, untarDirectory } from "@hyperframes/aws-lambda";
import { handler } from "@hyperframes/aws-lambda/handler";
import type {
  AssembleEvent,
  HandlerDeps,
  PlanEvent,
  PlanLambdaResult,
  RenderChunkEvent,
  RenderChunkLambdaResult,
  SerializableDistributedRenderConfig,
} from "@hyperframes/aws-lambda";

export type {
  LambdaLocalRenderResult,
  RunLambdaLocalInput,
} from "./regression-harness-lambda-local-types.js";
import type {
  LambdaLocalRenderResult,
  RunLambdaLocalInput,
} from "./regression-harness-lambda-local-types.js";

const FAKE_BUCKET = "harness-lambda-local";

/** S3 URI helpers — keep the URI shape identical to what SFN uses in production. */
function uri(key: string): string {
  return `s3://${FAKE_BUCKET}/${key}`;
}

/**
 * Run plan → renderChunk × N → assemble through the OSS handler with a
 * filesystem-backed fake S3. Output lands at `input.renderedOutputPath`.
 */
export async function runLambdaLocalRender(
  input: RunLambdaLocalInput,
): Promise<LambdaLocalRenderResult> {
  const protocol = input.protocol ?? "v1";
  const s3Root = join(input.tempRoot, "s3");
  mkdirSync(s3Root, { recursive: true });

  // STEP 0: stage the project as a tar.gz at the fake-S3 path the Plan
  // event will reference, mirroring what `deploySite` does in prod.
  const projectKey = `sites/harness/${Date.now()}/project.tar.gz`;
  const projectS3Path = join(s3Root, projectKey);
  mkdirSync(dirname(projectS3Path), { recursive: true });
  await tarDirectory(input.projectDir, projectS3Path);

  const fakeS3 = new FilesystemBackedFakeS3(s3Root);
  const deps: HandlerDeps = {
    s3: fakeS3 as unknown as HandlerDeps["s3"],
    // The handler resolves a Chrome path via `@sparticuz/chromium` by
    // default; that's the Lambda-specific binary. In Dockerfile.test
    // we want the producer's already-configured Chrome instead. The
    // skip flag tells the handler not to override PRODUCER_HEADLESS_SHELL_PATH.
    skipChromeResolution: true,
    tmpRoot: join(input.tempRoot, "lambda-tmp"),
  };
  const lambdaTmpRoot = join(input.tempRoot, "lambda-tmp");
  mkdirSync(lambdaTmpRoot, { recursive: true });
  let peakObservedMaterializedBytes = measureDirectoryBytes(lambdaTmpRoot);
  const observe = async <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const sample = (): void => {
      peakObservedMaterializedBytes = Math.max(
        peakObservedMaterializedBytes,
        measureDirectoryBytes(lambdaTmpRoot),
      );
    };
    sample();
    const timer = setInterval(sample, 2);
    timer.unref();
    try {
      return await operation();
    } finally {
      clearInterval(timer);
      sample();
    }
  };

  const config: SerializableDistributedRenderConfig = {
    fps: input.fps,
    width: input.width,
    height: input.height,
    format: input.format,
    ...(input.format === "mp4" && input.codec !== undefined ? { codec: input.codec } : {}),
    chunkSize: input.chunkSize,
    maxParallelChunks: input.maxParallelChunks,
    planDirSizeLimitBytes: input.planDirSizeLimitBytes,
    hdrMode: "force-sdr",
    // Forward `variables` through the event boundary so lambda-local mode
    // exercises the same variables-in-encoder.json path that real Lambda
    // executions take. Without this, a fixture's `renderConfig.variables`
    // would be silently dropped at the harness's serializer.
    variables: input.variables,
  };

  // STEP A: plan
  const planPrefix = `renders/harness/${Date.now()}/`;
  const planEvent: PlanEvent =
    protocol === "v2"
      ? {
          Action: "plan",
          PlanProtocol: "v2",
          ProjectS3Uri: uri(projectKey),
          PlanOutputS3Prefix: uri(planPrefix),
          Config: config,
        }
      : {
          Action: "plan",
          PlanProtocol: "v1",
          ProjectS3Uri: uri(projectKey),
          PlanOutputS3Prefix: uri(planPrefix),
          Config: config,
        };
  const planResponse = await observe(() => handler(planEvent, deps));
  if (planResponse.Action !== "plan") {
    throw new Error(`lambda-local: plan action returned ${planResponse.Action}`);
  }
  const planResult: PlanLambdaResult = planResponse;

  // STEP B: render every chunk through the handler.
  const chunkUris: string[] = [];
  const chunks: LambdaLocalRenderResult["chunks"] = [];
  for (let i = 0; i < planResult.ChunkCount; i++) {
    const shared = {
      Action: "renderChunk" as const,
      PlanHash: planResult.PlanHash,
      ChunkIndex: i,
      ChunkOutputS3Prefix: uri(planPrefix),
      Format: input.format,
    };
    const chunkEvent: RenderChunkEvent =
      protocol === "v2"
        ? {
            ...shared,
            PlanProtocol: "v2",
            PlanV2ManifestS3Uri: requireV2PlanResult(planResult).PlanV2ManifestS3Uri,
            PlanV2ArtifactS3Prefix: requireV2PlanResult(planResult).PlanV2ArtifactS3Prefix,
          }
        : {
            ...shared,
            PlanProtocol: "v1",
            PlanS3Uri: requireV1PlanResult(planResult).PlanS3Uri,
          };
    const chunkResponse = await observe(() => handler(chunkEvent, deps));
    if (chunkResponse.Action !== "renderChunk") {
      throw new Error(`lambda-local: renderChunk action returned ${chunkResponse.Action}`);
    }
    const chunkResult: RenderChunkLambdaResult = chunkResponse;
    chunkUris.push(chunkResult.ChunkS3Uri);
    chunks.push({
      index: i,
      path: fakeS3Path(s3Root, chunkResult.ChunkS3Uri),
      reportedSha256: chunkResult.Sha256,
    });
  }

  // STEP C: assemble
  const finalUri = uri(
    `${planPrefix}output${input.format === "png-sequence" ? ".tar.gz" : `.${input.format}`}`,
  );
  const assembleShared = {
    Action: "assemble" as const,
    ChunkS3Uris: chunkUris,
    AudioS3Uri: planResult.AudioS3Uri,
    OutputS3Uri: finalUri,
    Format: input.format,
  };
  const assembleEvent: AssembleEvent =
    protocol === "v2"
      ? {
          ...assembleShared,
          PlanProtocol: "v2",
          PlanV2ManifestS3Uri: requireV2PlanResult(planResult).PlanV2ManifestS3Uri,
          PlanV2ArtifactS3Prefix: requireV2PlanResult(planResult).PlanV2ArtifactS3Prefix,
          PlanHash: planResult.PlanHash,
        }
      : {
          ...assembleShared,
          PlanProtocol: "v1",
          PlanS3Uri: requireV1PlanResult(planResult).PlanS3Uri,
        };
  const assembleResponse = await observe(() => handler(assembleEvent, deps));
  if (assembleResponse.Action !== "assemble") {
    throw new Error(`lambda-local: assemble action returned ${assembleResponse.Action}`);
  }
  const transferBytes = fakeS3.transferBytes;

  // Copy the final output from fake-S3 land back out to the path the
  // harness expects. For png-sequence, untar into the dir.
  const finalKey = finalUri.slice(`s3://${FAKE_BUCKET}/`.length);
  if (input.format === "png-sequence") {
    const tarPath = join(s3Root, finalKey);
    mkdirSync(input.renderedOutputPath, { recursive: true });
    await untarDirectory(tarPath, input.renderedOutputPath);
  } else {
    await downloadS3ObjectToFile(
      fakeS3 as unknown as Parameters<typeof downloadS3ObjectToFile>[0],
      finalUri,
      input.renderedOutputPath,
    );
  }

  return {
    protocol,
    outputPath: input.renderedOutputPath,
    chunks,
    transferBytes,
    peakMaterializedBytes: peakObservedMaterializedBytes,
  };
}

function fakeS3Path(s3Root: string, s3Uri: string): string {
  const prefix = `s3://${FAKE_BUCKET}/`;
  if (!s3Uri.startsWith(prefix)) {
    throw new Error(`lambda-local: unexpected fake S3 URI ${s3Uri}`);
  }
  return join(s3Root, s3Uri.slice(prefix.length));
}

function requireV1PlanResult(
  result: PlanLambdaResult,
): Extract<PlanLambdaResult, { PlanS3Uri: string }> {
  if (!("PlanS3Uri" in result)) {
    throw new Error("lambda-local: v1 plan returned v2 locators");
  }
  return result;
}

function requireV2PlanResult(
  result: PlanLambdaResult,
): Extract<PlanLambdaResult, { PlanProtocol: "v2" }> {
  if (!("PlanProtocol" in result) || result.PlanProtocol !== "v2") {
    throw new Error("lambda-local: v2 plan did not return explicit v2 locators");
  }
  return result;
}

// The recursive walk is the measurement itself; extracting its two filesystem
// branches would make this small test-harness utility harder to audit.
// fallow-ignore-next-line complexity
function measureDirectoryBytes(path: string): number {
  if (!existsSync(path)) return 0;
  let bytes = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      bytes += measureDirectoryBytes(child);
    } else if (entry.isFile()) {
      bytes += statSync(child).size;
    }
  }
  return bytes;
}

/**
 * Minimum AWS-SDK-shaped fake S3 the handler's `send(GetObject)` and
 * `send(PutObject)` calls land in. Stores blobs on the local filesystem
 * under `root/<key>` so the harness can pre-stage inputs (tarball'd
 * project) and post-inspect outputs (per-chunk artifacts, final video)
 * without going through a real S3 endpoint.
 */
class FilesystemBackedFakeS3 {
  private downloadedBytes = 0;
  private uploadedBytes = 0;
  private readonly metadata = new Map<string, Record<string, string>>();

  constructor(private readonly root: string) {}

  get transferBytes(): { downloaded: number; uploaded: number } {
    return {
      downloaded: this.downloadedBytes,
      uploaded: this.uploadedBytes,
    };
  }

  async send(command: unknown): Promise<unknown> {
    const cmdName = (command as { constructor: { name: string } }).constructor.name;
    const input = (command as { input: { Bucket: string; Key: string; Body?: unknown } }).input;
    const fsPath = join(this.root, input.Key);

    if (cmdName === "GetObjectCommand") {
      if (!existsSync(fsPath)) {
        const err = new Error(
          `FakeS3: GetObject for missing key ${input.Bucket}/${input.Key}`,
        ) as Error & {
          $metadata: { httpStatusCode: number };
        };
        err.$metadata = { httpStatusCode: 404 };
        throw err;
      }
      const bytes = readFileSync(fsPath);
      this.downloadedBytes += bytes.length;
      return { Body: Readable.from([bytes]) };
    }
    if (cmdName === "PutObjectCommand") {
      mkdirSync(dirname(fsPath), { recursive: true });
      const body = input.Body;
      if (body instanceof Buffer || typeof body === "string") {
        writeFileSync(fsPath, body);
      } else if (body && typeof (body as NodeJS.ReadableStream).pipe === "function") {
        await pipeline(body as NodeJS.ReadableStream, createWriteStream(fsPath));
      } else {
        throw new Error(`FakeS3: PutObject body shape not supported (${typeof body})`);
      }
      const size = statSync(fsPath).size;
      this.uploadedBytes += size;
      const metadata = (command as { input: { Metadata?: Record<string, string> } }).input.Metadata;
      if (metadata) this.metadata.set(input.Key, metadata);
      return { ETag: `"fake-${size}"` };
    }
    if (cmdName === "HeadObjectCommand") {
      if (!existsSync(fsPath)) {
        const err = new Error(
          `FakeS3: HeadObject for missing key ${input.Bucket}/${input.Key}`,
        ) as Error & {
          $metadata: { httpStatusCode: number };
        };
        err.$metadata = { httpStatusCode: 404 };
        throw err;
      }
      return {
        ContentLength: statSync(fsPath).size,
        LastModified: new Date(),
        Metadata: this.metadata.get(input.Key),
      };
    }
    throw new Error(`FakeS3: unexpected command ${cmdName}`);
  }
}
