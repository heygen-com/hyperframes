import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";
import {
  PlanV2IntegrityError,
  type PlanV2ArtifactPublisher,
  type PlanV2PublishBlob,
} from "@hyperframes/producer/distributed";
import { CONTENT_STORE_PREFIX } from "./contentStore.js";
import {
  ensureContentStoreObject,
  formatS3Uri,
  parseS3Uri,
  putContentStoreFile,
  uploadContentAddressedFileToS3,
} from "./s3Transport.js";

export interface S3PlanV2ArtifactPublisherOptions {
  readonly s3: S3Client;
  /** Validated render output prefix from which all v2 object keys are derived. */
  readonly planOutputS3Prefix: string;
  /** Planner-local scratch parent for the small manifest upload file. */
  readonly temporaryRoot?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new PlanV2IntegrityError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function manifestDigests(manifestBytes: string): ReadonlySet<string> {
  let value: unknown;
  try {
    value = JSON.parse(manifestBytes);
  } catch {
    throw new PlanV2IntegrityError("S3 publisher received invalid manifest JSON");
  }
  if (!isRecord(value) || !Array.isArray(value.artifacts)) {
    throw new PlanV2IntegrityError("S3 publisher manifest requires an artifacts array");
  }
  return new Set(
    value.artifacts.map((artifact, index) => {
      if (!isRecord(artifact)) {
        throw new PlanV2IntegrityError(`S3 publisher artifacts[${index}] must be an object`);
      }
      return assertSha256(artifact.sha256, `S3 publisher artifacts[${index}].sha256`);
    }),
  );
}

function trimTrailingSlash(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
}

/**
 * Manifest-last S3 implementation of the producer's plan-v2 publication seam.
 *
 * Blobs stream from the planner's private frozen directory directly to S3.
 * Successfully uploaded or safely reused digests are tracked so a manifest
 * cannot become visible before all of its references are durable.
 */
export class S3PlanV2ArtifactPublisher implements PlanV2ArtifactPublisher {
  readonly artifactPrefix: string;
  readonly manifestUri: string;
  readonly #s3: S3Client;
  readonly #bucket: string;
  readonly #temporaryRoot: string;
  readonly #publishedDigests = new Set<string>();
  #state: "open" | "committed" | "aborted" = "open";

  constructor(options: Readonly<S3PlanV2ArtifactPublisherOptions>) {
    const outputPrefix = `${trimTrailingSlash(options.planOutputS3Prefix)}/v2`;
    const { bucket } = parseS3Uri(outputPrefix);
    this.#s3 = options.s3;
    this.#bucket = bucket;
    // Shared by every render, so a blob the SDK or an earlier render uploaded is reused, not re-sent.
    this.artifactPrefix = formatS3Uri({ bucket, key: CONTENT_STORE_PREFIX });
    this.manifestUri = `${outputPrefix}/manifest.json`;
    this.#temporaryRoot = options.temporaryRoot ?? tmpdir();
    mkdirSync(this.#temporaryRoot, { recursive: true });
  }

  async putBlob(blob: Readonly<PlanV2PublishBlob>): Promise<void> {
    this.#assertOpen("publish a blob");
    const digest = assertSha256(blob.sha256, "S3 published blob sha256");
    if (this.#publishedDigests.has(digest)) return;
    const sourceSize = statSync(blob.sourcePath).size;
    if (sourceSize !== blob.sizeBytes) {
      throw new PlanV2IntegrityError(
        `S3 published blob size changed for ${digest}: expected ${blob.sizeBytes}, got ${sourceSize}`,
      );
    }
    await putContentStoreFile(this.#s3, blob.sourcePath, this.#bucket, digest);
    this.#publishedDigests.add(digest);
  }

  async referenceStoredBlob(blob: Readonly<Omit<PlanV2PublishBlob, "sourcePath">>): Promise<void> {
    this.#assertOpen("reference a stored blob");
    const digest = assertSha256(blob.sha256, "S3 referenced blob sha256");
    await ensureContentStoreObject(this.#s3, this.#bucket, digest, blob.sizeBytes);
    this.#publishedDigests.add(digest);
  }

  async commitManifest(manifestBytes: string): Promise<void> {
    this.#assertOpen("commit a manifest");
    for (const digest of manifestDigests(manifestBytes)) {
      if (!this.#publishedDigests.has(digest)) {
        throw new PlanV2IntegrityError(
          `cannot commit S3 manifest before referenced blob is durable: ${digest}`,
        );
      }
    }

    const manifestDigest = createHash("sha256").update(manifestBytes, "utf8").digest("hex");
    const stagingDir = mkdtempSync(join(this.#temporaryRoot, "hf-plan-v2-manifest-"));
    const manifestPath = join(stagingDir, "manifest.json");
    try {
      writeFileSync(manifestPath, manifestBytes, "utf8");
      await uploadContentAddressedFileToS3(
        this.#s3,
        manifestPath,
        this.manifestUri,
        manifestDigest,
        "application/json",
      );
      this.#state = "committed";
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  async abort(): Promise<void> {
    if (this.#state === "open") this.#state = "aborted";
    // Remote CAS blobs are immutable and may already be reused by a retry or
    // another render. They expire under the shared content store's lifecycle.
  }

  #assertOpen(operation: string): void {
    if (this.#state !== "open") {
      throw new PlanV2IntegrityError(`cannot ${operation} after publisher is ${this.#state}`);
    }
  }
}
