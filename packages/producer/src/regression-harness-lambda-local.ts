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
  AssembleLambdaResult,
  HandlerDeps,
  PlanEvent,
  PlanLambdaResult,
  RenderChunkEvent,
  RenderChunkLambdaResult,
  SerializableDistributedRenderConfig,
} from "@hyperframes/aws-lambda";

export type { RunLambdaLocalInput } from "./regression-harness-lambda-local-types.js";
import type { RunLambdaLocalInput } from "./regression-harness-lambda-local-types.js";

const FAKE_BUCKET = "harness-lambda-local";

/** S3 URI helpers — keep the URI shape identical to what SFN uses in production. */
function uri(key: string): string {
  return `s3://${FAKE_BUCKET}/${key}`;
}

/**
 * Run plan → renderChunk × N → assemble through the OSS handler with a
 * filesystem-backed fake S3. Output lands at `input.renderedOutputPath`.
 */
export async function runLambdaLocalRender(input: RunLambdaLocalInput): Promise<void> {
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
  mkdirSync(deps.tmpRoot as string, { recursive: true });

  const config: SerializableDistributedRenderConfig = {
    fps: input.fps,
    width: input.width,
    height: input.height,
    format: input.format,
    ...(input.format === "mp4" && input.codec !== undefined ? { codec: input.codec } : {}),
    chunkSize: input.chunkSize,
    maxParallelChunks: input.maxParallelChunks,
    hdrMode: "force-sdr",
    // Forward `variables` through the event boundary so lambda-local mode
    // exercises the same variables-in-encoder.json path that real Lambda
    // executions take. Without this, a fixture's `renderConfig.variables`
    // would be silently dropped at the harness's serializer.
    variables: input.variables,
  };

  // STEP A: plan
  const planPrefix = `renders/harness/${Date.now()}/`;
  const planEvent: PlanEvent = {
    Action: "plan",
    ProjectS3Uri: uri(projectKey),
    PlanOutputS3Prefix: uri(planPrefix),
    Config: config,
  };
  const planResult = (await handler(planEvent, deps)) as PlanLambdaResult;

  // STEP B: render every chunk through the handler.
  const chunkUris: string[] = [];
  for (let i = 0; i < planResult.ChunkCount; i++) {
    const chunkEvent: RenderChunkEvent = {
      Action: "renderChunk",
      PlanS3Uri: planResult.PlanS3Uri,
      PlanHash: planResult.PlanHash,
      ChunkIndex: i,
      ChunkOutputS3Prefix: uri(planPrefix),
      Format: input.format,
    };
    const chunkResult = (await handler(chunkEvent, deps)) as RenderChunkLambdaResult;
    chunkUris.push(chunkResult.ChunkS3Uri);
  }

  // STEP C: assemble
  const finalUri = uri(
    `${planPrefix}output${input.format === "png-sequence" ? ".tar.gz" : `.${input.format}`}`,
  );
  const assembleEvent: AssembleEvent = {
    Action: "assemble",
    PlanS3Uri: planResult.PlanS3Uri,
    ChunkS3Uris: chunkUris,
    AudioS3Uri: planResult.AudioS3Uri,
    OutputS3Uri: finalUri,
    Format: input.format,
  };
  (await handler(assembleEvent, deps)) as AssembleLambdaResult;

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
}

/**
 * Minimum AWS-SDK-shaped fake S3 the handler's `send(GetObject)` and
 * `send(PutObject)` calls land in. Stores blobs on the local filesystem
 * under `root/<key>` so the harness can pre-stage inputs (tarball'd
 * project) and post-inspect outputs (per-chunk artifacts, final video)
 * without going through a real S3 endpoint.
 */
class FilesystemBackedFakeS3 {
  constructor(private readonly root: string) {}

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
      return { ETag: `"fake-${statSync(fsPath).size}"` };
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
      return { ContentLength: statSync(fsPath).size, LastModified: new Date() };
    }
    throw new Error(`FakeS3: unexpected command ${cmdName}`);
  }
}
