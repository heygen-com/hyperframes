/**
 * Push a prebuilt single-platform OCI image layout into ECR through the ECR API alone,
 * so deploying the container-image function needs neither Docker nor registry HTTP calls.
 */

import { open, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  BatchCheckLayerAvailabilityCommand,
  CompleteLayerUploadCommand,
  CreateRepositoryCommand,
  DescribeRepositoriesCommand,
  ECRClient,
  InitiateLayerUploadCommand,
  ListTagsForResourceCommand,
  PutImageCommand,
  type Repository,
  type Tag,
  UploadLayerPartCommand,
} from "@aws-sdk/client-ecr";
import { sha256File } from "../s3Transport.js";

const MANIFEST_MEDIA_TYPES = new Set([
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
]);
// ECR's BatchCheckLayerAvailability accepts at most 100 digests per call.
const CHECK_BATCH_SIZE = 100;

interface Descriptor {
  mediaType: string;
  digest: string;
  size: number;
}

/** Options for {@link ensureEcrRepository}. */
export interface EnsureEcrRepositoryOptions {
  ecr?: ECRClient;
  region?: string;
  repositoryName: string;
  /** Set on create. An existing repository is adopted only if it already carries every one. */
  tags?: Tag[];
}

/** Create the repository, or adopt an existing one that carries `tags`. */
export async function ensureEcrRepository(
  opts: EnsureEcrRepositoryOptions,
): Promise<{ repositoryUri: string }> {
  const { repositoryName, tags } = opts;
  const ecr = opts.ecr ?? new ECRClient({ region: opts.region });
  try {
    const created = await ecr.send(new CreateRepositoryCommand({ repositoryName, tags }));
    return { repositoryUri: repositoryUriOf(created.repository, repositoryName) };
  } catch (error) {
    if ((error as Error).name !== "RepositoryAlreadyExistsException") throw error;
  }
  const found = await ecr.send(
    new DescribeRepositoriesCommand({ repositoryNames: [repositoryName] }),
  );
  const repository = found.repositories?.[0];
  if (tags?.length) {
    const listed = await ecr.send(
      new ListTagsForResourceCommand({ resourceArn: repository?.repositoryArn }),
    );
    const has = new Map((listed.tags ?? []).map((tag) => [tag.Key, tag.Value]));
    const missing = tags.filter((tag) => has.get(tag.Key) !== tag.Value);
    if (missing.length > 0) {
      const wanted = missing.map((tag) => `${tag.Key}=${tag.Value}`).join(", ");
      throw new Error(
        `[ensureEcrRepository] ${repositoryName} already exists without ${wanted}; refusing to adopt a repository this caller did not create`,
      );
    }
  }
  return { repositoryUri: repositoryUriOf(repository, repositoryName) };
}

function repositoryUriOf(repository: Repository | undefined, repositoryName: string): string {
  if (!repository?.repositoryUri) {
    throw new Error(`[ensureEcrRepository] ECR returned no repositoryUri for ${repositoryName}`);
  }
  return repository.repositoryUri;
}

/** Options for {@link pushImageToEcr}. */
export interface PushImageToEcrOptions {
  ecr?: ECRClient;
  region?: string;
  /** OCI image layout directory: `index.json` plus `blobs/sha256/<hex>`. */
  layoutDir: string;
  repositoryName: string;
  /** From {@link ensureEcrRepository}. */
  repositoryUri: string;
  tag: string;
  log?: (message: string) => void;
}

/** Result of {@link pushImageToEcr}. */
export interface PushedImage {
  /** `<repositoryUri>@sha256:<manifest digest>`, pinned to exactly the pushed bytes. */
  imageUri: string;
  digest: string;
  /** From the image config, so callers can assert the platform they expect. */
  architecture: string;
  os: string;
}

/** Upload the layout's missing blobs, then put its manifest under `tag`. Safe to re-run. */
export async function pushImageToEcr(opts: PushImageToEcrOptions): Promise<PushedImage> {
  const { layoutDir, repositoryName, log = () => {} } = opts;
  const ecr = opts.ecr ?? new ECRClient({ region: opts.region });
  const manifestDescriptor = await readManifestDescriptor(layoutDir);
  await verifyBlob(layoutDir, manifestDescriptor);
  const manifestText = await readFile(blobPath(layoutDir, manifestDescriptor.digest), "utf-8");
  const manifest = JSON.parse(manifestText) as { config?: Descriptor; layers?: Descriptor[] };
  if (!manifest.config || !Array.isArray(manifest.layers)) {
    throw new Error(
      `[pushImageToEcr] manifest ${manifestDescriptor.digest} has no config or layers`,
    );
  }
  const blobs = [manifest.config, ...manifest.layers];
  for (const blob of blobs) await verifyBlob(layoutDir, blob);
  const config = JSON.parse(
    await readFile(blobPath(layoutDir, manifest.config.digest), "utf-8"),
  ) as { architecture?: string; os?: string };
  if (!config.architecture || !config.os) {
    throw new Error(
      `[pushImageToEcr] image config ${manifest.config.digest} names no architecture/os; ` +
        "build the image for one platform",
    );
  }

  const missing = await unavailableDigests(ecr, repositoryName, blobs);
  // ponytail: sequential uploads; upload time on big layers is the ceiling, bounded parallel layers is the upgrade.
  for (const blob of blobs) {
    if (!missing.delete(blob.digest)) continue;
    log(`uploading ${blob.digest} (${blob.size} bytes)`);
    await uploadBlob(ecr, repositoryName, blobPath(layoutDir, blob.digest), blob);
  }

  try {
    await ecr.send(
      new PutImageCommand({
        repositoryName,
        imageManifest: manifestText,
        imageManifestMediaType: manifestDescriptor.mediaType,
        imageTag: opts.tag,
        imageDigest: manifestDescriptor.digest,
      }),
    );
  } catch (error) {
    if ((error as Error).name !== "ImageAlreadyExistsException") throw error;
  }
  return {
    imageUri: `${opts.repositoryUri}@${manifestDescriptor.digest}`,
    digest: manifestDescriptor.digest,
    architecture: config.architecture,
    os: config.os,
  };
}

async function readManifestDescriptor(layoutDir: string): Promise<Descriptor> {
  const index = JSON.parse(await readFile(join(layoutDir, "index.json"), "utf-8")) as {
    manifests?: Descriptor[];
  };
  const manifests = index.manifests ?? [];
  const [only] = manifests;
  if (manifests.length !== 1 || !only || !MANIFEST_MEDIA_TYPES.has(only.mediaType)) {
    const found = manifests.map((m) => m.mediaType).join(", ") || "none";
    throw new Error(
      `[pushImageToEcr] ${layoutDir}/index.json must list exactly one single-platform image ` +
        `manifest; found ${manifests.length} (${found}). Build one platform with ` +
        "--provenance=false --sbom=false.",
    );
  }
  return only;
}

function blobPath(layoutDir: string, digest: string): string {
  const hex = /^sha256:([a-f0-9]{64})$/.exec(digest)?.[1];
  if (!hex) throw new Error(`[pushImageToEcr] unsupported blob digest ${JSON.stringify(digest)}`);
  return join(layoutDir, "blobs", "sha256", hex);
}

async function verifyBlob(layoutDir: string, blob: Descriptor): Promise<void> {
  const path = blobPath(layoutDir, blob.digest);
  const size = (await stat(path)).size;
  if (size !== blob.size || `sha256:${await sha256File(path)}` !== blob.digest) {
    throw new Error(
      `[pushImageToEcr] blob ${blob.digest} (${size} bytes, expected ${blob.size}) does not ` +
        "match its descriptor; the image layout is corrupt",
    );
  }
}

async function unavailableDigests(
  ecr: ECRClient,
  repositoryName: string,
  blobs: Descriptor[],
): Promise<Set<string>> {
  const missing = new Set(blobs.map((blob) => blob.digest));
  const digests = [...missing];
  for (let i = 0; i < digests.length; i += CHECK_BATCH_SIZE) {
    const { layers = [] } = await ecr.send(
      new BatchCheckLayerAvailabilityCommand({
        repositoryName,
        layerDigests: digests.slice(i, i + CHECK_BATCH_SIZE),
      }),
    );
    for (const layer of layers) {
      if (layer.layerAvailability === "AVAILABLE" && layer.layerDigest) {
        missing.delete(layer.layerDigest);
      }
    }
  }
  return missing;
}

async function uploadBlob(
  ecr: ECRClient,
  repositoryName: string,
  path: string,
  blob: Descriptor,
): Promise<void> {
  const { uploadId, partSize } = await ecr.send(new InitiateLayerUploadCommand({ repositoryName }));
  if (!uploadId || !partSize) {
    throw new Error(`[pushImageToEcr] InitiateLayerUpload returned no uploadId/partSize`);
  }
  const file = await open(path);
  try {
    for (let first = 0; first < blob.size; first += partSize) {
      const part = Buffer.alloc(Math.min(partSize, blob.size - first));
      const { bytesRead } = await file.read(part, 0, part.length, first);
      if (bytesRead !== part.length) throw new Error(`[pushImageToEcr] ${path} changed on disk`);
      await ecr.send(
        new UploadLayerPartCommand({
          repositoryName,
          uploadId,
          partFirstByte: first,
          partLastByte: first + part.length - 1,
          layerPartBlob: part,
        }),
      );
    }
  } finally {
    await file.close();
  }
  try {
    await ecr.send(
      new CompleteLayerUploadCommand({ repositoryName, uploadId, layerDigests: [blob.digest] }),
    );
  } catch (error) {
    if ((error as Error).name !== "LayerAlreadyExistsException") throw error;
  }
}
