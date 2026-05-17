import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";
import { asS3Client, FakeS3 } from "./__fixtures__/fakeS3.js";
import { deploySite } from "./deploySite.js";

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
      s3: asS3Client(s3),
    });

    expect(result.uploaded).toBe(true);
    expect(result.siteId).toMatch(/^[0-9a-f]{16}$/);
    expect(result.bucketName).toBe("test-bucket");
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
      s3: asS3Client(s3a),
    });
    const s3b = new FakeS3();
    const b = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      s3: asS3Client(s3b),
    });
    expect(a.siteId).toBe(b.siteId);
  });

  it("changes siteId when a file's content changes", async () => {
    const s3 = new FakeS3();
    const before = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      s3: asS3Client(s3),
    });

    writeFileSync(join(projectDir, "index.html"), "<html><body>changed</body></html>");
    const s3b = new FakeS3();
    const after = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      s3: asS3Client(s3b),
    });
    expect(after.siteId).not.toBe(before.siteId);
  });

  it("short-circuits on HEAD 200 (skips PUT)", async () => {
    const s3 = new FakeS3();
    const first = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      s3: asS3Client(s3),
    });

    const second = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      s3: asS3Client(s3),
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
      s3: asS3Client(s3),
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
      s3: asS3Client(s3),
    });

    mkdirSync(join(projectDir, "node_modules"));
    writeFileSync(join(projectDir, "node_modules", "junk.bin"), "x".repeat(100));
    const s3b = new FakeS3();
    const after = await deploySite({
      projectDir,
      bucketName: "test-bucket",
      s3: asS3Client(s3b),
    });

    // node_modules contents shouldn't move the hash.
    expect(after.siteId).toBe(before.siteId);
  });
});
