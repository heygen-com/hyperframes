// fallow-ignore-file code-duplication complexity
/**
 * Unit tests for the S3 URI parser + tar helpers. Real S3 network calls
 * are covered by the dispatch tests in `handler.test.ts` via a fake
 * S3Client; here we pin the lower-level helpers.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  downloadS3ObjectToFileVerified,
  formatS3Uri,
  parseS3Uri,
  sha256File,
  tarDirectory,
  untarDirectory,
  uploadContentAddressedFileToS3,
} from "./s3Transport.js";

let scratchRoot: string;

beforeAll(() => {
  scratchRoot = mkdtempSync(join(tmpdir(), "hf-s3transport-test-"));
});

afterAll(() => {
  rmSync(scratchRoot, { recursive: true, force: true });
});

describe("parseS3Uri", () => {
  it("parses a simple bucket+key URI", () => {
    expect(parseS3Uri("s3://my-bucket/path/to/object.zip")).toEqual({
      bucket: "my-bucket",
      key: "path/to/object.zip",
    });
  });

  it("preserves nested keys", () => {
    expect(parseS3Uri("s3://b/a/b/c/d.mp4").key).toBe("a/b/c/d.mp4");
  });

  it("throws on non-s3 schemes", () => {
    expect(() => parseS3Uri("https://example.com/x")).toThrow(/expected s3:\/\//);
  });

  it("throws on missing key", () => {
    expect(() => parseS3Uri("s3://bucket-only")).toThrow(/missing key/);
  });

  it("throws on empty bucket", () => {
    expect(() => parseS3Uri("s3:///somekey")).toThrow(/empty bucket or key/);
  });
});

describe("formatS3Uri", () => {
  it("round-trips with parseS3Uri", () => {
    const uri = "s3://my-bucket/path/to/object.zip";
    expect(formatS3Uri(parseS3Uri(uri))).toBe(uri);
  });
});

describe("tar round-trip", () => {
  it("tars a directory and untars to identical contents", async () => {
    const sourceDir = join(scratchRoot, "src");
    const destDir = join(scratchRoot, "dest");
    const tarPath = join(scratchRoot, "out.tar.gz");

    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(sourceDir, "nested"), { recursive: true });
    writeFileSync(join(sourceDir, "top.txt"), "hello-top");
    writeFileSync(join(sourceDir, "nested", "inner.txt"), "hello-inner");

    await tarDirectory(sourceDir, tarPath);
    await untarDirectory(tarPath, destDir);

    expect(readFileSync(join(destDir, "top.txt"), "utf-8")).toBe("hello-top");
    expect(readFileSync(join(destDir, "nested", "inner.txt"), "utf-8")).toBe("hello-inner");
  });

  it("wipes the destination before extracting", async () => {
    const sourceDir = join(scratchRoot, "src2");
    const destDir = join(scratchRoot, "dest2");
    const tarPath = join(scratchRoot, "out2.tar.gz");

    const { mkdirSync } = await import("node:fs");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "fresh.txt"), "new");

    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "stale.txt"), "leftover");

    await tarDirectory(sourceDir, tarPath);
    await untarDirectory(tarPath, destDir);

    // Stale file should be gone; fresh file should be present.
    expect(readFileSync(join(destDir, "fresh.txt"), "utf-8")).toBe("new");
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(destDir, "stale.txt"))).toBe(false);
  });
});

describe("content-addressed v2 artifacts", () => {
  it("uploads once and reuses an object with matching digest metadata", async () => {
    const source = join(scratchRoot, "artifact-upload.bin");
    writeFileSync(source, "immutable bytes");
    const digest = await sha256File(source);
    const s3 = new ContentAddressedFakeS3();
    const uri = `s3://bucket/v2/artifacts/sha256/${digest.slice(0, 2)}/${digest}`;

    expect(await uploadContentAddressedFileToS3(s3.asClient(), source, uri, digest)).toBe(
      "uploaded",
    );
    expect(await uploadContentAddressedFileToS3(s3.asClient(), source, uri, digest)).toBe("reused");
    expect(s3.putCount).toBe(1);
  });

  it("refuses to overwrite an immutable key with conflicting metadata", async () => {
    const source = join(scratchRoot, "artifact-conflict.bin");
    writeFileSync(source, "expected bytes");
    const digest = await sha256File(source);
    const uri = `s3://bucket/v2/artifacts/sha256/${digest.slice(0, 2)}/${digest}`;
    const s3 = new ContentAddressedFakeS3();
    s3.objects.set(uri, {
      bytes: Buffer.from("same length!!"),
      sha256: "0".repeat(64),
    });

    await expect(
      uploadContentAddressedFileToS3(s3.asClient(), source, uri, digest),
    ).rejects.toMatchObject({ name: "PLAN_ARTIFACT_DIGEST_MISMATCH" });
    expect(s3.putCount).toBe(0);
  });

  it("reuses a matching object won by a concurrent conditional create", async () => {
    const source = join(scratchRoot, "artifact-race.bin");
    writeFileSync(source, "race-safe bytes");
    const digest = await sha256File(source);
    const uri = `s3://bucket/v2/artifacts/sha256/${digest.slice(0, 2)}/${digest}`;
    const s3 = new ContentAddressedFakeS3();
    s3.raceOnNextPut = { bytes: Buffer.from("race-safe bytes"), sha256: digest };

    expect(await uploadContentAddressedFileToS3(s3.asClient(), source, uri, digest)).toBe("reused");
    expect(s3.putCount).toBe(0);
  });

  it("rejects a conflicting object won by a concurrent conditional create", async () => {
    const source = join(scratchRoot, "artifact-race-conflict.bin");
    writeFileSync(source, "race-safe bytes");
    const digest = await sha256File(source);
    const uri = `s3://bucket/v2/artifacts/sha256/${digest.slice(0, 2)}/${digest}`;
    const s3 = new ContentAddressedFakeS3();
    s3.raceOnNextPut = {
      bytes: Buffer.alloc(Buffer.byteLength("race-safe bytes"), "x"),
      sha256: "0".repeat(64),
    };

    await expect(
      uploadContentAddressedFileToS3(s3.asClient(), source, uri, digest),
    ).rejects.toMatchObject({ name: "PLAN_ARTIFACT_DIGEST_MISMATCH" });
    expect(s3.putCount).toBe(0);
  });

  it("deletes a downloaded artifact when digest verification fails", async () => {
    const expectedSource = join(scratchRoot, "artifact-expected.bin");
    const destination = join(scratchRoot, "artifact-download.bin");
    writeFileSync(expectedSource, "expected");
    const expected = await sha256File(expectedSource);
    const uri = "s3://bucket/v2/artifacts/corrupt";
    const s3 = new ContentAddressedFakeS3();
    s3.objects.set(uri, { bytes: Buffer.from("corrupt"), sha256: "f".repeat(64) });

    await expect(
      downloadS3ObjectToFileVerified(s3.asClient(), uri, destination, expected),
    ).rejects.toMatchObject({ name: "PLAN_ARTIFACT_DIGEST_MISMATCH" });
    const { existsSync } = await import("node:fs");
    expect(existsSync(destination)).toBe(false);
  });
});

class ContentAddressedFakeS3 {
  readonly objects = new Map<string, { bytes: Buffer; sha256: string }>();
  putCount = 0;
  raceOnNextPut: { bytes: Buffer; sha256: string } | undefined;

  asClient(): import("@aws-sdk/client-s3").S3Client {
    return this as unknown as import("@aws-sdk/client-s3").S3Client;
  }

  // This fake intentionally keeps the S3 command matrix in one stateful boundary;
  // splitting commands across helpers would obscure the transport test behavior.
  // fallow-ignore-next-line complexity
  async send(command: unknown): Promise<unknown> {
    const value = command as {
      constructor: { name: string };
      input: {
        Bucket: string;
        Key: string;
        Body?: NodeJS.ReadableStream;
        Metadata?: Record<string, string>;
      };
    };
    const uri = `s3://${value.input.Bucket}/${value.input.Key}`;
    if (value.constructor.name === "HeadObjectCommand") {
      const object = this.objects.get(uri);
      if (!object) {
        const error = new Error("not found") as Error & {
          $metadata: { httpStatusCode: number };
        };
        error.name = "NotFound";
        error.$metadata = { httpStatusCode: 404 };
        throw error;
      }
      return {
        ContentLength: object.bytes.length,
        Metadata: { sha256: object.sha256 },
      };
    }
    if (value.constructor.name === "GetObjectCommand") {
      const object = this.objects.get(uri);
      if (!object) throw new Error("missing fake object");
      const { Readable } = await import("node:stream");
      return { Body: Readable.from([object.bytes]) };
    }
    if (value.constructor.name === "PutObjectCommand") {
      if (this.raceOnNextPut) {
        this.objects.set(uri, this.raceOnNextPut);
        this.raceOnNextPut = undefined;
        if (value.input.Body && "destroy" in value.input.Body) {
          value.input.Body.destroy();
        }
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
      this.putCount += 1;
      return {};
    }
    throw new Error(`unexpected command ${value.constructor.name}`);
  }
}
