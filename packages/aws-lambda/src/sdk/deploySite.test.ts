import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HeadObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { deploySite } from "./deploySite.js";

interface FakeOp {
  kind: "head" | "put";
  bucket: string;
  key: string;
}

class FakeS3 {
  ops: FakeOp[] = [];
  existing = new Set<string>();
  async send(command: unknown): Promise<unknown> {
    const cmdName = (command as { constructor: { name: string } }).constructor.name;
    const input = (command as { input: { Bucket: string; Key: string } }).input;
    if (cmdName === "HeadObjectCommand") {
      this.ops.push({ kind: "head", bucket: input.Bucket, key: input.Key });
      if (this.existing.has(`${input.Bucket}/${input.Key}`)) {
        return { ContentLength: 123, LastModified: new Date("2026-05-16T00:00:00Z") };
      }
      const err = new Error("Not Found") as Error & {
        $metadata: { httpStatusCode: number };
        name: string;
      };
      err.name = "NotFound";
      err.$metadata = { httpStatusCode: 404 };
      throw err;
    }
    if (cmdName === "PutObjectCommand") {
      this.ops.push({ kind: "put", bucket: input.Bucket, key: input.Key });
      this.existing.add(`${input.Bucket}/${input.Key}`);
      // Drain the body stream so its underlying file descriptor opens
      // (and closes) while the source file still exists. Without this,
      // the lazy `createReadStream` would attempt to open the workdir
      // tarball after `deploySite`'s `finally` block has rmSync'd the
      // workdir, surfacing as an "Unhandled error between tests".
      await drainBody((command as { input: { Body: NodeJS.ReadableStream | Buffer } }).input.Body);
      return {};
    }
    throw new Error(`FakeS3: unexpected command ${cmdName}`);
  }
}

async function drainBody(body: NodeJS.ReadableStream | Buffer): Promise<void> {
  if (Buffer.isBuffer(body)) return;
  // Consume to completion or error; either way, the FD lifecycle is
  // bounded to this `send()` call.
  await new Promise<void>((resolve, reject) => {
    body.on("data", () => {});
    body.on("end", () => resolve());
    body.on("close", () => resolve());
    body.on("error", reject);
  });
}

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "hf-deploy-site-test-"));
  mkdirSync(join(projectDir, "assets"));
  writeFileSync(join(projectDir, "index.html"), "<html><body>hi</body></html>");
  writeFileSync(join(projectDir, "assets", "style.css"), "body { color: red; }");
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("deploySite", () => {
  it("uploads the tarball when no matching object exists", async () => {
    const s3 = new FakeS3();
    const result = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      s3: s3 as unknown as S3Client,
    });

    expect(result.uploaded).toBe(true);
    expect(result.siteId).toMatch(/^[0-9a-f]{16}$/);
    expect(result.projectS3Uri).toBe(`s3://test-bucket/sites/${result.siteId}/project.tar.gz`);
    expect(result.bytes).toBeGreaterThan(0);
    expect(s3.ops).toEqual([
      { kind: "head", bucket: "test-bucket", key: `sites/${result.siteId}/project.tar.gz` },
      { kind: "put", bucket: "test-bucket", key: `sites/${result.siteId}/project.tar.gz` },
    ]);
  });

  it("yields a stable siteId across re-runs of the same tree", async () => {
    const s3a = new FakeS3();
    const a = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      s3: s3a as unknown as S3Client,
    });
    const s3b = new FakeS3();
    const b = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      s3: s3b as unknown as S3Client,
    });
    expect(a.siteId).toBe(b.siteId);
  });

  it("changes siteId when a file's content changes", async () => {
    const s3 = new FakeS3();
    const before = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      s3: s3 as unknown as S3Client,
    });

    writeFileSync(join(projectDir, "index.html"), "<html><body>changed</body></html>");
    const s3b = new FakeS3();
    const after = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      s3: s3b as unknown as S3Client,
    });
    expect(after.siteId).not.toBe(before.siteId);
  });

  it("short-circuits on HEAD 200 (skips PUT)", async () => {
    const s3 = new FakeS3();
    const first = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      s3: s3 as unknown as S3Client,
    });

    const second = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      s3: s3 as unknown as S3Client,
    });

    expect(second.uploaded).toBe(false);
    expect(second.siteId).toBe(first.siteId);
    // Only one PUT total, plus two HEADs.
    expect(s3.ops.filter((op) => op.kind === "put")).toHaveLength(1);
    expect(s3.ops.filter((op) => op.kind === "head")).toHaveLength(2);
  });

  it("honours a caller-supplied siteId", async () => {
    const s3 = new FakeS3();
    const result = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      siteId: "release-v1.2.3",
      s3: s3 as unknown as S3Client,
    });
    expect(result.siteId).toBe("release-v1.2.3");
    expect(result.projectS3Uri).toBe("s3://test-bucket/sites/release-v1.2.3/project.tar.gz");
  });

  it("propagates non-404 S3 errors", async () => {
    const errS3 = {
      async send(_cmd: unknown): Promise<unknown> {
        const err = new Error("Access Denied") as Error & {
          $metadata: { httpStatusCode: number };
        };
        err.$metadata = { httpStatusCode: 403 };
        throw err;
      },
    };
    await expect(
      deploySite({
        projectDir,
        bucketName: "test-bucket",
        s3: errS3 as unknown as S3Client,
      }),
    ).rejects.toThrow(/Access Denied/);
  });

  it("ignores SKIP_TOP_LEVEL dirs when hashing", async () => {
    const s3 = new FakeS3();
    const before = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      s3: s3 as unknown as S3Client,
    });

    mkdirSync(join(projectDir, "node_modules"));
    writeFileSync(join(projectDir, "node_modules", "junk.bin"), "x".repeat(100));
    const s3b = new FakeS3();
    const after = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      s3: s3b as unknown as S3Client,
    });

    // node_modules contents shouldn't move the hash.
    expect(after.siteId).toBe(before.siteId);
  });
});

// Suppress unused-import lint complaints when these are only referenced via
// `constructor.name` checks in the fake's `send` method.
void HeadObjectCommand;
void PutObjectCommand;
