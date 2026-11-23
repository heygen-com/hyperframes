import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ECRClient } from "@aws-sdk/client-ecr";
import { ensureEcrRepository, pushImageToEcr } from "./pushImageToEcr.js";

const OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json";
const OCI_INDEX = "application/vnd.oci.image.index.v1+json";
const REGISTRY = "123456789012.dkr.ecr.us-east-1.amazonaws.com";
const PART_SIZE = 7;
// 21 bytes is exactly three parts; 17 bytes ends with a short part.
const LAYER_A = Buffer.from("layer-a: 21 bytes!!!!");
const LAYER_B = Buffer.from("layer-b: 17 bytes");

interface Descriptor {
  mediaType: string;
  digest: string;
  size: number;
}

function sha256(bytes: Buffer | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function awsError(name: string): Error {
  return Object.assign(new Error(name), { name });
}

/** In-memory ECR that enforces the upload rules real ECR enforces. */
class FakeEcr {
  calls: string[] = [];
  blobs = new Map<string, Buffer>();
  tags = new Map<string, string>();
  repositories = new Map<string, string>();
  repositoryTags = new Map<string, unknown>();
  /** Digests BatchCheckLayerAvailability reports missing even though stored (a concurrent push). */
  hiddenFromCheck = new Set<string>();
  private uploads = new Map<string, Buffer[]>();

  async send(command: unknown): Promise<unknown> {
    const name = (command as { constructor: { name: string } }).constructor.name;
    const input = (command as { input: unknown }).input;
    this.calls.push(name);
    const handler = (this as unknown as Record<string, (input: unknown) => unknown>)[name];
    if (!handler) throw new Error(`FakeEcr: unexpected command ${name}`);
    return handler.call(this, input);
  }

  CreateRepositoryCommand(input: { repositoryName: string; tags?: unknown }): unknown {
    if (this.repositories.has(input.repositoryName)) {
      throw awsError("RepositoryAlreadyExistsException");
    }
    const repositoryUri = `${REGISTRY}/${input.repositoryName}`;
    this.repositories.set(input.repositoryName, repositoryUri);
    this.repositoryTags.set(input.repositoryName, input.tags);
    return { repository: { repositoryUri } };
  }

  DescribeRepositoriesCommand(input: { repositoryNames: string[] }): unknown {
    return {
      repositories: input.repositoryNames.map((name) => ({
        repositoryArn: `arn:aws:ecr:r:1:repository/${name}`,
        repositoryUri: this.repositories.get(name),
      })),
    };
  }

  ListTagsForResourceCommand(input: { resourceArn: string }): unknown {
    return { tags: this.repositoryTags.get(input.resourceArn.split("/").pop() ?? "") ?? [] };
  }

  BatchCheckLayerAvailabilityCommand(input: { layerDigests: string[] }): unknown {
    if (input.layerDigests.length > 100) throw awsError("InvalidParameterException");
    const stored = (d: string) => this.blobs.has(d) && !this.hiddenFromCheck.has(d);
    return {
      layers: input.layerDigests
        .filter(stored)
        .map((layerDigest) => ({ layerDigest, layerAvailability: "AVAILABLE" })),
      failures: input.layerDigests
        .filter((d) => !stored(d))
        .map((layerDigest) => ({ layerDigest, failureCode: "MissingLayerDigest" })),
    };
  }

  InitiateLayerUploadCommand(): unknown {
    const uploadId = `upload-${this.uploads.size}`;
    this.uploads.set(uploadId, []);
    return { uploadId, partSize: PART_SIZE };
  }

  UploadLayerPartCommand(input: {
    uploadId: string;
    partFirstByte: number;
    partLastByte: number;
    layerPartBlob: Uint8Array;
  }): unknown {
    const parts = this.uploads.get(input.uploadId);
    if (!parts) throw awsError("UploadNotFoundException");
    const received = parts.reduce((sum, part) => sum + part.length, 0);
    const size = input.layerPartBlob.length;
    const contiguous = input.partFirstByte === received;
    const lastByteMatches = input.partLastByte === input.partFirstByte + size - 1;
    const previousWasFull = parts.every((part) => part.length === PART_SIZE);
    if (!contiguous || !lastByteMatches || size > PART_SIZE || !previousWasFull) {
      throw awsError("InvalidLayerPartException");
    }
    parts.push(Buffer.from(input.layerPartBlob));
    return { uploadId: input.uploadId, lastByteReceived: input.partLastByte };
  }

  CompleteLayerUploadCommand(input: { uploadId: string; layerDigests: string[] }): unknown {
    const parts = this.uploads.get(input.uploadId);
    if (!parts) throw awsError("UploadNotFoundException");
    this.uploads.delete(input.uploadId);
    const bytes = Buffer.concat(parts);
    const [digest] = input.layerDigests;
    if (input.layerDigests.length !== 1 || sha256(bytes) !== digest) {
      throw awsError("InvalidLayerException");
    }
    if (this.blobs.has(digest)) throw awsError("LayerAlreadyExistsException");
    this.blobs.set(digest, bytes);
    return { layerDigest: digest };
  }

  PutImageCommand(input: {
    imageManifest: string;
    imageTag: string;
    imageDigest: string;
  }): unknown {
    if (sha256(input.imageManifest) !== input.imageDigest)
      throw awsError("InvalidParameterException");
    const manifest = JSON.parse(input.imageManifest) as {
      config: Descriptor;
      layers: Descriptor[];
    };
    const referenced = [manifest.config, ...manifest.layers].map((blob) => blob.digest);
    if (referenced.some((digest) => !this.blobs.has(digest))) {
      throw awsError("LayersNotFoundException");
    }
    if (this.tags.get(input.imageTag) === input.imageDigest) {
      throw awsError("ImageAlreadyExistsException");
    }
    this.tags.set(input.imageTag, input.imageDigest);
    return { image: { imageId: { imageDigest: input.imageDigest, imageTag: input.imageTag } } };
  }
}

function asEcr(fake: FakeEcr): ECRClient {
  return fake as unknown as ECRClient;
}

let layoutDir: string;

beforeEach(() => {
  layoutDir = mkdtempSync(join(tmpdir(), "hf-ecr-layout-"));
});

afterEach(() => {
  rmSync(layoutDir, { recursive: true, force: true });
});

function putBlob(mediaType: string, bytes: Buffer): Descriptor {
  mkdirSync(join(layoutDir, "blobs", "sha256"), { recursive: true });
  const digest = sha256(bytes);
  writeFileSync(join(layoutDir, "blobs", "sha256", digest.slice("sha256:".length)), bytes);
  return { mediaType, digest, size: bytes.length };
}

function writeIndex(manifests: Descriptor[]): void {
  writeFileSync(
    join(layoutDir, "index.json"),
    JSON.stringify({ schemaVersion: 2, mediaType: OCI_INDEX, manifests }),
  );
}

function writeLayout(
  layers: Buffer[] = [LAYER_A, LAYER_B],
  platform: Record<string, string> = { architecture: "arm64", os: "linux" },
) {
  const config = putBlob(
    "application/vnd.oci.image.config.v1+json",
    Buffer.from(JSON.stringify({ ...platform, rootfs: { type: "layers" } })),
  );
  const layerDescriptors = layers.map((bytes) =>
    putBlob("application/vnd.oci.image.layer.v1.tar+gzip", bytes),
  );
  const manifest = putBlob(
    OCI_MANIFEST,
    Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        mediaType: OCI_MANIFEST,
        config,
        layers: layerDescriptors,
      }),
    ),
  );
  writeIndex([manifest]);
  return { config, manifest, layers: layerDescriptors };
}

function push(ecr: FakeEcr) {
  return pushImageToEcr({
    ecr: asEcr(ecr),
    layoutDir,
    repositoryName: "hyperframes-render",
    repositoryUri: `${REGISTRY}/hyperframes-render`,
    tag: "v1",
  });
}

describe("pushImageToEcr", () => {
  it("uploads every blob in partSize parts and puts the manifest under the tag", async () => {
    const { config, manifest, layers } = writeLayout();
    const ecr = new FakeEcr();

    const result = await push(ecr);

    expect(result).toEqual({
      imageUri: `${REGISTRY}/hyperframes-render@${manifest.digest}`,
      digest: manifest.digest,
      architecture: "arm64",
      os: "linux",
    });
    expect(ecr.blobs.get(layers[0]!.digest)).toEqual(LAYER_A);
    expect(ecr.blobs.get(layers[1]!.digest)).toEqual(LAYER_B);
    expect(ecr.blobs.has(config.digest)).toBe(true);
    expect(ecr.tags.get("v1")).toBe(manifest.digest);
    const parts = ecr.calls.filter((call) => call === "UploadLayerPartCommand").length;
    expect(parts).toBe(Math.ceil(config.size / PART_SIZE) + 3 + 3);
    expect(ecr.calls[0]).toBe("BatchCheckLayerAvailabilityCommand");
    expect(ecr.calls.at(-1)).toBe("PutImageCommand");
  });

  it("skips blobs ECR already has", async () => {
    const { config, layers } = writeLayout();
    const ecr = new FakeEcr();
    ecr.blobs.set(config.digest, Buffer.from("stored"));
    ecr.blobs.set(layers[0]!.digest, LAYER_A);

    await push(ecr);

    expect(ecr.calls.filter((call) => call === "InitiateLayerUploadCommand")).toHaveLength(1);
    expect(ecr.blobs.get(layers[1]!.digest)).toEqual(LAYER_B);
  });

  it("checks availability in batches of at most 100 digests", async () => {
    writeLayout(Array.from({ length: 101 }, (_, i) => Buffer.from(`layer ${i}`)));
    const ecr = new FakeEcr();

    await push(ecr);

    expect(ecr.calls.filter((call) => call === "BatchCheckLayerAvailabilityCommand")).toHaveLength(
      2,
    );
    expect(ecr.blobs.size).toBe(102);
  });

  it("refuses a tampered blob before making any ECR call", async () => {
    const { layers } = writeLayout();
    const tampered = Buffer.from(LAYER_B);
    tampered[0] = tampered[0]! ^ 1;
    writeFileSync(join(layoutDir, "blobs", "sha256", layers[1]!.digest.slice(7)), tampered);
    const ecr = new FakeEcr();

    await expect(push(ecr)).rejects.toThrow(/does not match its descriptor/);
    expect(ecr.calls).toEqual([]);
  });

  it("refuses an index listing two manifests", async () => {
    const { manifest } = writeLayout();
    const attestation = putBlob(OCI_MANIFEST, Buffer.from("{}"));
    writeIndex([manifest, attestation]);
    const ecr = new FakeEcr();

    await expect(push(ecr)).rejects.toThrow(/exactly one single-platform image manifest; found 2/);
    expect(ecr.calls).toEqual([]);
  });

  it("refuses a multi-platform image index", async () => {
    const { manifest } = writeLayout();
    writeIndex([{ ...manifest, mediaType: OCI_INDEX }]);
    const ecr = new FakeEcr();

    await expect(push(ecr)).rejects.toThrow(`found 1 (${OCI_INDEX})`);
    expect(ecr.calls).toEqual([]);
  });

  it("refuses an image config with no architecture", async () => {
    writeLayout([LAYER_A], { os: "linux" });
    const ecr = new FakeEcr();

    await expect(push(ecr)).rejects.toThrow(/names no architecture\/os/);
    expect(ecr.calls).toEqual([]);
  });

  it("treats LayerAlreadyExists on complete as uploaded", async () => {
    const { layers, manifest } = writeLayout();
    const ecr = new FakeEcr();
    ecr.blobs.set(layers[0]!.digest, LAYER_A);
    ecr.hiddenFromCheck.add(layers[0]!.digest);

    const result = await push(ecr);

    expect(result.digest).toBe(manifest.digest);
    expect(ecr.tags.get("v1")).toBe(manifest.digest);
  });

  it("redeploying the same image uploads nothing and succeeds", async () => {
    const { manifest } = writeLayout();
    const ecr = new FakeEcr();
    await push(ecr);
    ecr.calls = [];

    const result = await push(ecr);

    expect(result.digest).toBe(manifest.digest);
    expect(ecr.calls).toEqual(["BatchCheckLayerAvailabilityCommand", "PutImageCommand"]);
  });
});

describe("ensureEcrRepository", () => {
  it("creates the repository with its tags", async () => {
    const ecr = new FakeEcr();
    const tags = [{ Key: "app", Value: "hyperframes" }];

    const { repositoryUri } = await ensureEcrRepository({
      ecr: asEcr(ecr),
      repositoryName: "hyperframes-render",
      tags,
    });

    expect(repositoryUri).toBe(`${REGISTRY}/hyperframes-render`);
    expect(ecr.calls).toEqual(["CreateRepositoryCommand"]);
    expect(ecr.repositoryTags.get("hyperframes-render")).toEqual(tags);
  });

  it("returns the existing repository's uri", async () => {
    const ecr = new FakeEcr();
    ecr.repositories.set("hyperframes-render", `${REGISTRY}/hyperframes-render`);

    const { repositoryUri } = await ensureEcrRepository({
      ecr: asEcr(ecr),
      repositoryName: "hyperframes-render",
    });

    expect(repositoryUri).toBe(`${REGISTRY}/hyperframes-render`);
    expect(ecr.calls).toEqual(["CreateRepositoryCommand", "DescribeRepositoriesCommand"]);
  });

  it("adopts an existing repository only when it carries the tags", async () => {
    const ecr = new FakeEcr();
    const tags = [{ Key: "hyperframes:stack", Value: "s" }];
    await ensureEcrRepository({ ecr: asEcr(ecr), repositoryName: "s-video", tags });

    const again = await ensureEcrRepository({ ecr: asEcr(ecr), repositoryName: "s-video", tags });
    expect(again.repositoryUri).toBe(`${REGISTRY}/s-video`);

    ecr.repositories.set("other-video", `${REGISTRY}/other-video`);
    ecr.repositoryTags.set("other-video", [{ Key: "hyperframes:stack", Value: "other" }]);
    await expect(
      ensureEcrRepository({ ecr: asEcr(ecr), repositoryName: "other-video", tags }),
    ).rejects.toThrow("other-video already exists without hyperframes:stack=s");
  });
});
