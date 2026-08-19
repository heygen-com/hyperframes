// fallow-ignore-file code-duplication complexity
import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asStorage, FakeGcs } from "./__fixtures__/fakeGcs.js";
import { GcsPlanV2ArtifactPublisher } from "./gcsPlanV2Publisher.js";

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
  const root = mkdtempSync(join(tmpdir(), "hf-gcs-plan-v2-publisher-"));
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

describe("GcsPlanV2ArtifactPublisher", () => {
  it("trims an arbitrary trailing-slash run in linear time", () => {
    const publisher = new GcsPlanV2ArtifactPublisher({
      storage: asStorage(new FakeGcs()),
      planOutputGcsPrefix: `gs://bucket/render${"/".repeat(10_000)}`,
    });

    expect(publisher.artifactPrefix).toBe("gs://bucket/render/v2/artifacts/sha256");
    expect(publisher.manifestUri).toBe("gs://bucket/render/v2/manifest.json");
  });

  it("publishes immutable blobs before the fixed-key manifest", async () => {
    const source = makeSource("hello");
    const gcs = new FakeGcs();
    const artifactPrefix = "gs://bucket/render/v2/artifacts/sha256";
    const manifestUri = "gs://bucket/render/v2/manifest.json";
    const publisher = new GcsPlanV2ArtifactPublisher({
      storage: asStorage(gcs),
      planOutputGcsPrefix: "gs://bucket/render",
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
    expect(gcs.ops.filter((operation) => operation.kind === "upload").map((op) => op.uri)).toEqual([
      blobUri,
      manifestUri,
    ]);
    expect(gcs.objects.get(manifestUri)?.toString("utf8")).toBe(manifest);
  });

  it("refuses to expose a manifest that references an unpublished digest", async () => {
    const source = makeSource("hello");
    const gcs = new FakeGcs();
    const manifestUri = "gs://bucket/render/v2/manifest.json";
    const publisher = new GcsPlanV2ArtifactPublisher({
      storage: asStorage(gcs),
      planOutputGcsPrefix: "gs://bucket/render",
      temporaryRoot: source.root,
    });

    await expect(publisher.commitManifest(manifestFor(source.digest))).rejects.toMatchObject({
      name: "PlanV2IntegrityError",
    });
    expect(gcs.objects.has(manifestUri)).toBe(false);
  });

  it("rejects malformed digests before constructing a GCS object key", async () => {
    const source = makeSource("hello");
    const gcs = new FakeGcs();
    const publisher = new GcsPlanV2ArtifactPublisher({
      storage: asStorage(gcs),
      planOutputGcsPrefix: "gs://bucket/render",
      temporaryRoot: source.root,
    });

    await expect(
      publisher.putBlob({
        sourcePath: source.path,
        sha256: "../outside-prefix",
        sizeBytes: source.sizeBytes,
      }),
    ).rejects.toMatchObject({ name: "PlanV2IntegrityError" });
    expect(gcs.ops.filter((operation) => operation.kind === "upload")).toHaveLength(0);
  });

  it("reuses matching objects and rejects a conflicting fixed-key manifest", async () => {
    const source = makeSource("hello");
    const gcs = new FakeGcs();
    const options = {
      storage: asStorage(gcs),
      planOutputGcsPrefix: "gs://bucket/render",
      temporaryRoot: source.root,
    };
    const blob = {
      sourcePath: source.path,
      sha256: source.digest,
      sizeBytes: source.sizeBytes,
    };
    const first = new GcsPlanV2ArtifactPublisher(options);
    await first.putBlob(blob);
    await first.commitManifest(manifestFor(source.digest, "one"));

    const retry = new GcsPlanV2ArtifactPublisher(options);
    await retry.putBlob(blob);
    await retry.commitManifest(manifestFor(source.digest, "one"));
    expect(gcs.ops.filter((operation) => operation.kind === "upload")).toHaveLength(2);

    const conflict = new GcsPlanV2ArtifactPublisher(options);
    await conflict.putBlob(blob);
    await expect(conflict.commitManifest(manifestFor(source.digest, "two"))).rejects.toMatchObject({
      name: "PLAN_ARTIFACT_DIGEST_MISMATCH",
    });
    expect(gcs.ops.filter((operation) => operation.kind === "upload")).toHaveLength(2);
  });

  it("leaves durable remote CAS blobs intact when publication aborts", async () => {
    const source = makeSource("hello");
    const gcs = new FakeGcs();
    const publisher = new GcsPlanV2ArtifactPublisher({
      storage: asStorage(gcs),
      planOutputGcsPrefix: "gs://bucket/render",
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
    expect(gcs.objects.size).toBe(1);
    await expect(publisher.putBlob(blob)).rejects.toMatchObject({
      name: "PlanV2IntegrityError",
    });
  });
});
