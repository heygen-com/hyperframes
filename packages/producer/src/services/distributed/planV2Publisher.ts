import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { PlanV2IntegrityError } from "./planV2Errors.js";
import { assertPlanV2Sha256, planV2BlobPath } from "./planV2Layout.js";

export interface PlanV2PublishBlob {
  readonly sourcePath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface PlanV2ArtifactPublisher {
  /**
   * Durably publish one immutable digest before resolving. `sourcePath` is
   * planner-local and valid only for the lifetime of this call; remote
   * adapters must finish reading/uploading it before the promise resolves.
   */
  putBlob(blob: Readonly<PlanV2PublishBlob>): Promise<void>;
  /** Commit the manifest only after every referenced blob is durable. */
  commitManifest(manifestBytes: string): Promise<void>;
  /** Idempotent best-effort cleanup for an unpublished or partial plan. */
  abort(): Promise<void>;
}

function canFallbackToCopy(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  const code = error.code;
  return code === "EXDEV" || code === "EPERM" || code === "EACCES" || code === "ENOTSUP";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function manifestDigests(manifestBytes: string): readonly string[] {
  let value: unknown;
  try {
    value = JSON.parse(manifestBytes);
  } catch {
    throw new PlanV2IntegrityError("manifest publisher received invalid JSON");
  }
  if (!isRecord(value) || !Array.isArray(value.artifacts)) {
    throw new PlanV2IntegrityError("manifest publisher requires an artifacts array");
  }
  return value.artifacts.map((artifact, index) => {
    if (!isRecord(artifact)) {
      throw new PlanV2IntegrityError(`manifest artifacts[${index}] must be an object`);
    }
    return assertPlanV2Sha256(artifact.sha256, `manifest artifacts[${index}].sha256`);
  });
}

export interface LocalPlanV2ArtifactPublisherOptions {
  /** Test seam for exercising cross-device/restricted-filesystem fallback. */
  readonly linkFile?: typeof linkSync;
}

/**
 * Planner-local manifest-last publisher.
 *
 * Same-filesystem blobs are hard-linked from the frozen source plan, so the
 * staging tree and local CAS do not consume a second set of data blocks.
 * Cross-device and restricted filesystems fall back to an atomic copy. This
 * implementation is a compatibility adapter for local callers; distributed
 * nodes exchange remote manifest/CAS locators through their cloud adapters.
 */
export class LocalPlanV2ArtifactPublisher implements PlanV2ArtifactPublisher {
  readonly destinationDir: string;
  readonly temporaryDir: string;
  readonly #linkFile: typeof linkSync;
  #committed = false;

  constructor(destinationDir: string, options: Readonly<LocalPlanV2ArtifactPublisherOptions> = {}) {
    if (existsSync(destinationDir)) {
      throw new PlanV2IntegrityError(`output directory already exists: ${destinationDir}`);
    }
    this.destinationDir = destinationDir;
    this.#linkFile = options.linkFile ?? linkSync;
    mkdirSync(dirname(destinationDir), { recursive: true });
    this.temporaryDir = mkdtempSync(join(dirname(destinationDir), ".plan-v2-publish-"));
  }

  async putBlob(blob: Readonly<PlanV2PublishBlob>): Promise<void> {
    const digest = assertPlanV2Sha256(blob.sha256, "published blob sha256");
    const sourceSize = statSync(blob.sourcePath).size;
    if (sourceSize !== blob.sizeBytes) {
      throw new PlanV2IntegrityError(
        `published blob size changed for ${digest}: expected ${blob.sizeBytes}, got ${sourceSize}`,
      );
    }
    const destinationPath = planV2BlobPath(this.temporaryDir, digest);
    if (existsSync(destinationPath)) return;
    mkdirSync(dirname(destinationPath), { recursive: true });
    const stagingDir = mkdtempSync(join(dirname(destinationPath), ".plan-v2-blob-"));
    const temporaryPath = join(stagingDir, "blob");
    try {
      try {
        this.#linkFile(blob.sourcePath, temporaryPath);
      } catch (error) {
        if (!canFallbackToCopy(error)) throw error;
        copyFileSync(blob.sourcePath, temporaryPath);
      }
      renameSync(temporaryPath, destinationPath);
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  async commitManifest(manifestBytes: string): Promise<void> {
    for (const digest of new Set(manifestDigests(manifestBytes))) {
      if (!existsSync(planV2BlobPath(this.temporaryDir, digest))) {
        throw new PlanV2IntegrityError(
          `cannot commit manifest before referenced blob is durable: ${digest}`,
        );
      }
    }
    writeFileSync(join(this.temporaryDir, "plan.json"), manifestBytes, "utf-8");
    renameSync(this.temporaryDir, this.destinationDir);
    this.#committed = true;
  }

  async abort(): Promise<void> {
    if (!this.#committed) {
      rmSync(this.temporaryDir, { recursive: true, force: true });
    }
  }
}
