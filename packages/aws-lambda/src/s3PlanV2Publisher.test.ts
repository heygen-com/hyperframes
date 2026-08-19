// fallow-ignore-file code-duplication complexity
import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3PlanV2ArtifactPublisher } from "./s3PlanV2Publisher.js";

interface StoredObject {
  readonly bytes: Buffer;
  readonly sha256: string;
}

interface PutOperation {
  readonly uri: string;
  readonly ifNoneMatch?: string;
}

class FakeS3 {
  readonly objects = new Map<string, StoredObject>();
  readonly puts: PutOperation[] = [];

  asClient(): import("@aws-sdk/client-s3").S3Client {
    return this as unknown as import("@aws-sdk/client-s3").S3Client;
  }

  async send(command: unknown): Promise<unknown> {
    // AWS command inputs are the runtime boundary exercised by this fake.
    const value = command as unknown as {
      readonly constructor: { readonly name: string };
      readonly input: {
        readonly Bucket: string;
        readonly Key: string;
        readonly Body?: NodeJS.ReadableStream;
        readonly Metadata?: Record<string, string>;
        readonly IfNoneMatch?: string;
      };
    };
    const uri = `s3://${value.input.Bucket}/${value.input.Key}`;
    if (value.constructor.name === "HeadObjectCommand") {
      const object = this.objects.get(uri);
      if (!object) {
        const error = new Error("not found");
        error.name = "NotFound";
        Object.assign(error, { $metadata: { httpStatusCode: 404 } });
        throw error;
      }
      return {
        ContentLength: object.bytes.length,
        Metadata: { sha256: object.sha256 },
      };
    }
    if (value.constructor.name === "PutObjectCommand") {
      if (value.input.IfNoneMatch === "*" && this.objects.has(uri)) {
        const error = new Error("precondition failed");
        error.name = "PreconditionFailed";
        Object.assign(error, { $metadata: { httpStatusCode: 412 } });
        throw error;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of value.input.Body ?? []) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      this.objects.set(uri, {
        bytes,
        sha256: value.input.Metadata?.sha256 ?? "",
      });
      this.puts.push({ uri, ifNoneMatch: value.input.IfNoneMatch });
      return {};
    }
    throw new Error(`unexpected command ${value.constructor.name}`);
  }
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

function makeSource(contents: string): {
  readonly root: string;
  readonly path: string;
  readonly digest: string;
  readonly sizeBytes: number;
} {
  const root = mkdtempSync(join(tmpdir(), "hf-s3-plan-v2-publisher-"));
  roots.push(root);
  const path = join(root, "artifact.bin");
  writeFileSync(path, contents);
  return {
    root,
    path,
    digest: createHash("sha256").update(contents).digest("hex"),
    sizeBytes: statSync(path).size,
  };
}

function manifestFor(digest: string, marker = "one"): string {
  return JSON.stringify({
    planHash: marker,
    artifacts: [{ path: "compiled/index.html", sha256: digest, sizeBytes: 5 }],
  });
}

describe("S3PlanV2ArtifactPublisher", () => {
  it("trims an arbitrary trailing-slash run in linear time", () => {
    const publisher = new S3PlanV2ArtifactPublisher({
      s3: new FakeS3().asClient(),
      planOutputS3Prefix: `s3://bucket/render${"/".repeat(10_000)}`,
    });

    expect(publisher.artifactPrefix).toBe("s3://bucket/render/v2/artifacts/sha256");
    expect(publisher.manifestUri).toBe("s3://bucket/render/v2/manifest.json");
  });

  it("publishes immutable blobs before the fixed-key manifest", async () => {
    const source = makeSource("hello");
    const s3 = new FakeS3();
    const artifactPrefix = "s3://bucket/render/v2/artifacts/sha256";
    const manifestUri = "s3://bucket/render/v2/manifest.json";
    const publisher = new S3PlanV2ArtifactPublisher({
      s3: s3.asClient(),
      planOutputS3Prefix: "s3://bucket/render",
      temporaryRoot: source.root,
    });

    await publisher.putBlob({
      sourcePath: source.path,
      sha256: source.digest,
      sizeBytes: source.sizeBytes,
    });
    const manifest = manifestFor(source.digest);
    await publisher.commitManifest(manifest);

    const blobUri = `${artifactPrefix}/${source.digest.slice(0, 2)}/${source.digest}`;
    expect(s3.puts.map((operation) => operation.uri)).toEqual([blobUri, manifestUri]);
    expect(s3.puts.every((operation) => operation.ifNoneMatch === "*")).toBe(true);
    expect(s3.objects.get(manifestUri)?.bytes.toString("utf8")).toBe(manifest);
  });

  it("refuses to expose a manifest that references an unpublished digest", async () => {
    const source = makeSource("hello");
    const s3 = new FakeS3();
    const manifestUri = "s3://bucket/render/v2/manifest.json";
    const publisher = new S3PlanV2ArtifactPublisher({
      s3: s3.asClient(),
      planOutputS3Prefix: "s3://bucket/render",
      temporaryRoot: source.root,
    });

    await expect(publisher.commitManifest(manifestFor(source.digest))).rejects.toMatchObject({
      name: "PlanV2IntegrityError",
    });
    expect(s3.objects.has(manifestUri)).toBe(false);
  });

  it("rejects malformed digests before constructing an S3 object key", async () => {
    const source = makeSource("hello");
    const s3 = new FakeS3();
    const publisher = new S3PlanV2ArtifactPublisher({
      s3: s3.asClient(),
      planOutputS3Prefix: "s3://bucket/render",
      temporaryRoot: source.root,
    });

    await expect(
      publisher.putBlob({
        sourcePath: source.path,
        sha256: "../outside-prefix",
        sizeBytes: source.sizeBytes,
      }),
    ).rejects.toMatchObject({ name: "PlanV2IntegrityError" });
    expect(s3.puts).toHaveLength(0);
  });

  it("reuses matching objects and rejects a conflicting fixed-key manifest", async () => {
    const source = makeSource("hello");
    const s3 = new FakeS3();
    const options = {
      s3: s3.asClient(),
      planOutputS3Prefix: "s3://bucket/render",
      temporaryRoot: source.root,
    };
    const blob = {
      sourcePath: source.path,
      sha256: source.digest,
      sizeBytes: source.sizeBytes,
    };
    const first = new S3PlanV2ArtifactPublisher(options);
    await first.putBlob(blob);
    await first.commitManifest(manifestFor(source.digest, "one"));

    const retry = new S3PlanV2ArtifactPublisher(options);
    await retry.putBlob(blob);
    await retry.commitManifest(manifestFor(source.digest, "one"));
    expect(s3.puts).toHaveLength(2);

    const conflict = new S3PlanV2ArtifactPublisher(options);
    await conflict.putBlob(blob);
    await expect(conflict.commitManifest(manifestFor(source.digest, "two"))).rejects.toMatchObject({
      name: "PLAN_ARTIFACT_DIGEST_MISMATCH",
    });
    expect(s3.puts).toHaveLength(2);
  });

  it("leaves durable remote CAS blobs intact when publication aborts", async () => {
    const source = makeSource("hello");
    const s3 = new FakeS3();
    const publisher = new S3PlanV2ArtifactPublisher({
      s3: s3.asClient(),
      planOutputS3Prefix: "s3://bucket/render",
      temporaryRoot: source.root,
    });
    const blob = {
      sourcePath: source.path,
      sha256: source.digest,
      sizeBytes: source.sizeBytes,
    };

    await publisher.putBlob(blob);
    await publisher.abort();
    await publisher.abort();
    expect(s3.objects.size).toBe(1);
    await expect(publisher.putBlob(blob)).rejects.toMatchObject({
      name: "PlanV2IntegrityError",
    });
  });
});
