// fallow-ignore-file code-duplication
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Storage } from "@google-cloud/storage";
import {
  PlanV2IntegrityError,
  type PlanV2ArtifactPublisher,
  type PlanV2PublishBlob,
} from "@hyperframes/producer/distributed";
import { parseGcsUri, uploadContentAddressedFileToGcs } from "./gcsTransport.js";

export interface GcsPlanV2ArtifactPublisherOptions {
  readonly storage: Storage;
  /** Validated render output prefix from which all v2 object keys are derived. */
  readonly planOutputGcsPrefix: string;
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
    throw new PlanV2IntegrityError("GCS publisher received invalid manifest JSON");
  }
  if (!isRecord(value) || !Array.isArray(value.artifacts)) {
    throw new PlanV2IntegrityError("GCS publisher manifest requires an artifacts array");
  }
  return new Set(
    value.artifacts.map((artifact, index) => {
      if (!isRecord(artifact)) {
        throw new PlanV2IntegrityError(`GCS publisher artifacts[${index}] must be an object`);
      }
      return assertSha256(artifact.sha256, `GCS publisher artifacts[${index}].sha256`);
    }),
  );
}

function trimTrailingSlash(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
}

/**
 * Manifest-last GCS implementation of the producer's plan-v2 publication seam.
 *
 * Every path remains private to the planner container. Remote workers receive
 * only the manifest URI and artifact prefix and materialize their own target.
 */
export class GcsPlanV2ArtifactPublisher implements PlanV2ArtifactPublisher {
  readonly artifactPrefix: string;
  readonly manifestUri: string;
  readonly #storage: Storage;
  readonly #temporaryRoot: string;
  readonly #publishedDigests = new Set<string>();
  #state: "open" | "committed" | "aborted" = "open";

  constructor(options: Readonly<GcsPlanV2ArtifactPublisherOptions>) {
    const outputPrefix = `${trimTrailingSlash(options.planOutputGcsPrefix)}/v2`;
    parseGcsUri(outputPrefix);
    this.#storage = options.storage;
    this.artifactPrefix = `${outputPrefix}/artifacts/sha256`;
    this.manifestUri = `${outputPrefix}/manifest.json`;
    this.#temporaryRoot = options.temporaryRoot ?? tmpdir();
    mkdirSync(this.#temporaryRoot, { recursive: true });
  }

  async putBlob(blob: Readonly<PlanV2PublishBlob>): Promise<void> {
    this.#assertOpen("publish a blob");
    const digest = assertSha256(blob.sha256, "GCS published blob sha256");
    const sourceSize = statSync(blob.sourcePath).size;
    if (sourceSize !== blob.sizeBytes) {
      throw new PlanV2IntegrityError(
        `GCS published blob size changed for ${digest}: expected ${blob.sizeBytes}, got ${sourceSize}`,
      );
    }
    const uri = `${this.artifactPrefix}/${digest.slice(0, 2)}/${digest}`;
    await uploadContentAddressedFileToGcs(this.#storage, blob.sourcePath, uri, digest);
    this.#publishedDigests.add(digest);
  }

  async commitManifest(manifestBytes: string): Promise<void> {
    this.#assertOpen("commit a manifest");
    for (const digest of manifestDigests(manifestBytes)) {
      if (!this.#publishedDigests.has(digest)) {
        throw new PlanV2IntegrityError(
          `cannot commit GCS manifest before referenced blob is durable: ${digest}`,
        );
      }
    }

    const manifestDigest = createHash("sha256").update(manifestBytes, "utf8").digest("hex");
    const stagingDir = mkdtempSync(join(this.#temporaryRoot, "hf-plan-v2-manifest-"));
    const manifestPath = join(stagingDir, "manifest.json");
    try {
      writeFileSync(manifestPath, manifestBytes, "utf8");
      await uploadContentAddressedFileToGcs(
        this.#storage,
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
    // Immutable CAS blobs may be shared with or reused by another retry.
    // Unreferenced blobs expire under the bucket's intermediate lifecycle.
  }

  #assertOpen(operation: string): void {
    if (this.#state !== "open") {
      throw new PlanV2IntegrityError(`cannot ${operation} after publisher is ${this.#state}`);
    }
  }
}
