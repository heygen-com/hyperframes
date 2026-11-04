// fallow-ignore-file code-duplication complexity
/**
 * Unit tests for the S3 URI parser + tar helpers. Real S3 network calls
 * are covered by the dispatch tests in `handler.test.ts` via a fake
 * S3Client; here we pin the lower-level helpers.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTENT_STORE_REFRESH_AFTER_DAYS, contentStoreUri } from "./contentStore.js";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  downloadS3ObjectToFileVerified,
  ensureContentStoreObject,
  MAX_SINGLE_PUT_BYTES,
  formatS3Uri,
  parseS3Uri,
  presignVerifiedS3GetUrl,
  sha256File,
  tarDirectory,
  untarDirectory,
  putContentStoreFile,
  uploadContentAddressedFileToS3,
  uploadFileToS3,
} from "./s3Transport.js";

let scratchRoot: string;

/** An S3 error as the SDK throws it; a dropped connection carries no HTTP status. */
function s3Error(name: string, httpStatusCode?: number): Error {
  const error = Object.assign(new Error(name), { name });
  return httpStatusCode === undefined
    ? error
    : Object.assign(error, { $metadata: { httpStatusCode } });
}

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

  it("leaves verifying the local bytes to the S3 checksum instead of hashing them again", async () => {
    const source = join(scratchRoot, "artifact-changed.bin");
    writeFileSync(source, "bytes that changed");
    const digest = createHash("sha256").update("bytes as hashed").digest("hex");
    const uri = `s3://bucket/v2/artifacts/sha256/${digest.slice(0, 2)}/${digest}`;
    const s3 = new ContentAddressedFakeS3();

    await expect(
      uploadContentAddressedFileToS3(s3.asClient(), source, uri, digest),
    ).rejects.toMatchObject({ name: "BadDigest" });
    expect(s3.objects.has(uri)).toBe(false);
    expect(s3.putAttempts).toBe(1);
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

  it("rewrites a reused object at the refresh age so its lifecycle expiry restarts", async () => {
    const source = join(scratchRoot, "artifact-aging.bin");
    writeFileSync(source, "aging bytes");
    const digest = await sha256File(source);
    const uri = contentStoreUri("bucket", digest);
    const s3 = new ContentAddressedFakeS3();
    const days = (n: number) => new Date(Date.now() - n * 86_400_000);
    s3.objects.set(uri, {
      bytes: Buffer.from("aging bytes"),
      sha256: digest,
      lastModified: days(CONTENT_STORE_REFRESH_AFTER_DAYS - 1),
    });

    expect(await putContentStoreFile(s3.asClient(), source, "bucket", digest)).toBe("reused");
    expect(s3.copies).toEqual([]);

    s3.objects.get(uri)!.lastModified = days(CONTENT_STORE_REFRESH_AFTER_DAYS);
    expect(await putContentStoreFile(s3.asClient(), source, "bucket", digest)).toBe("reused");
    expect(s3.copies).toEqual([
      {
        uri,
        CopySource: `bucket/cas/sha256/${digest.slice(0, 2)}/${digest}`,
        MetadataDirective: "REPLACE",
        Metadata: { sha256: digest },
        ChecksumAlgorithm: "SHA256",
      },
    ]);
    expect(s3.objects.get(uri)).toMatchObject({ sha256: digest });
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

describe("presignVerifiedS3GetUrl", () => {
  const digest = "ab".repeat(32);
  const uri = `s3://bucket/v2/artifacts/sha256/ab/${digest}`;
  function clientHolding(head: { ChecksumSHA256?: string; ContentLength: number }): S3Client {
    const client = new S3Client({
      region: "us-east-2",
      credentials: { accessKeyId: "AKIDTEST", secretAccessKey: "test-secret" },
    });
    client.send = (async (command: unknown) => {
      expect(command).toBeInstanceOf(HeadObjectCommand);
      expect((command as HeadObjectCommand).input.ChecksumMode).toBe("ENABLED");
      return head;
    }) as S3Client["send"];
    return client;
  }

  it.each([
    { uri, key: `/v2/artifacts/sha256/ab/${digest}` },
    { uri: contentStoreUri("bucket", digest), key: `/cas/sha256/ab/${digest}` },
  ])("signs an attested legacy or shared-content source at $key", async (source) => {
    const checksum = Buffer.from(digest, "hex").toString("base64");
    const url = new URL(
      await presignVerifiedS3GetUrl(
        clientHolding({ ChecksumSHA256: checksum, ContentLength: 42 }),
        source.uri,
        digest,
        42,
        600,
      ),
    );
    expect(url.pathname).toBe(source.key);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
  });

  it("refuses an object whose stored checksum is not the pinned digest", async () => {
    const other = Buffer.from("cd".repeat(32), "hex").toString("base64");
    await expect(
      presignVerifiedS3GetUrl(
        clientHolding({ ChecksumSHA256: other, ContentLength: 42 }),
        uri,
        digest,
        42,
        600,
      ),
    ).rejects.toMatchObject({ name: "PLAN_ARTIFACT_DIGEST_MISMATCH" });
  });
});

const TRANSIENT_FAILURES: [string, Error][] = [
  ["a dropped connection", s3Error("TimeoutError")],
  ["an S3 request timeout (HTTP 400)", s3Error("RequestTimeout", 400)],
];

describe("single-PUT uploads", () => {
  it.each(TRANSIENT_FAILURES)("resends the file from a fresh read after %s", async (_, failure) => {
    const source = join(scratchRoot, "single-retry.bin");
    writeFileSync(source, "chunk bytes");
    const s3 = new ContentAddressedFakeS3();
    s3.failNextPut = failure;
    await uploadFileToS3(s3.asClient(), source, "s3://bucket/chunks/0.mp4");
    expect(s3.objects.get("s3://bucket/chunks/0.mp4")?.bytes.toString()).toBe("chunk bytes");
    expect(s3.putAttempts).toBe(2);
  });

  it("does not resend after any other S3 answer", async () => {
    const source = join(scratchRoot, "single-final.bin");
    writeFileSync(source, "chunk bytes");
    const s3 = new ContentAddressedFakeS3();
    s3.failNextPut = s3Error("InvalidArgument", 400);
    await expect(
      uploadFileToS3(s3.asClient(), source, "s3://bucket/chunks/0.mp4"),
    ).rejects.toMatchObject({ name: "InvalidArgument" });
    expect(s3.putAttempts).toBe(1);
  });
});

describe("objects over the single-PUT limit", () => {
  const bigSize = MAX_SINGLE_PUT_BYTES + 1;
  // sha256 of bigSize zero bytes, computed outside this code.
  const bigDigest = "edcddf01fc829bf06be2b5393a9793cdd43598a0fd483c57f41a9b58183f6e33";
  function sparseFile(name: string): string {
    const path = join(scratchRoot, name);
    writeFileSync(path, "");
    truncateSync(path, bigSize);
    return path;
  }

  it("stores a file over 5 GB in checked parts, created only if the key is free", async () => {
    const source = sparseFile("big-upload.bin");
    const s3 = new MultipartFakeS3();
    try {
      expect(await putContentStoreFile(s3.asClient(), source, "bucket", bigDigest)).toBe(
        "uploaded",
      );
    } finally {
      rmSync(source);
    }
    const [create, complete] = [s3.calls[1]!, s3.calls.at(-1)!];
    expect(s3.calls.map((c) => c.name)).not.toContain("PutObjectCommand");
    expect(create).toMatchObject({
      name: "CreateMultipartUploadCommand",
      input: { Metadata: { sha256: bigDigest }, ChecksumAlgorithm: "SHA256" },
    });
    expect(complete).toMatchObject({
      name: "CompleteMultipartUploadCommand",
      input: { IfNoneMatch: "*", MpuObjectSize: bigSize },
    });
    expect(s3.partSizes.reduce((a, b) => a + b, 0)).toBe(bigSize);
    expect(s3.partSizes.length).toBeLessThanOrEqual(10_000);
    expect(s3.maxPartsInFlight).toBeGreaterThan(1);
    expect(s3.maxPartsInFlight).toBeLessThanOrEqual(8);
  }, 120_000);

  it.each(TRANSIENT_FAILURES)(
    "resends a part from a fresh read after %s",
    async (_, failure) => {
      const source = sparseFile("big-retry.bin");
      const s3 = new MultipartFakeS3();
      s3.failNextPart = failure;
      try {
        expect(await putContentStoreFile(s3.asClient(), source, "bucket", bigDigest)).toBe(
          "uploaded",
        );
      } finally {
        rmSync(source);
      }
      expect(s3.partSizes.reduce((a, b) => a + b, 0)).toBe(bigSize);
      expect(s3.calls.at(-1)).toMatchObject({ name: "CompleteMultipartUploadCommand" });
    },
    120_000,
  );

  it("aborts instead of completing when the file no longer has the digest it was stored under", async () => {
    const source = sparseFile("big-changed.bin");
    const s3 = new MultipartFakeS3();
    try {
      await expect(
        putContentStoreFile(s3.asClient(), source, "bucket", "0".repeat(64)),
      ).rejects.toMatchObject({ name: "PLAN_ARTIFACT_DIGEST_MISMATCH" });
    } finally {
      rmSync(source);
    }
    const names = s3.calls.map((c) => c.name);
    expect(names).toContain("AbortMultipartUploadCommand");
    expect(names).not.toContain("CompleteMultipartUploadCommand");
  }, 120_000);

  it("refreshes an aging object over 5 GB by copying it onto itself in parts", async () => {
    const s3 = new MultipartFakeS3();
    s3.head = {
      ContentLength: bigSize,
      Metadata: { sha256: bigDigest },
      LastModified: new Date(Date.now() - CONTENT_STORE_REFRESH_AFTER_DAYS * 86_400_000),
    };
    await ensureContentStoreObject(s3.asClient(), "bucket", bigDigest, bigSize);
    const copies = s3.calls.filter((c) => c.name === "UploadPartCopyCommand");
    expect(copies.map((c) => c.input.CopySourceRange)).toEqual([
      `bytes=0-${MAX_SINGLE_PUT_BYTES - 1}`,
      `bytes=${MAX_SINGLE_PUT_BYTES}-${MAX_SINGLE_PUT_BYTES}`,
    ]);
    expect(s3.calls.at(-1)).toMatchObject({ name: "CompleteMultipartUploadCommand" });
    expect(s3.calls[1]).toMatchObject({ input: { Metadata: { sha256: bigDigest } } });
  });

  it("signs a multipart object by its recorded digest only above the single-PUT limit", async () => {
    const uri = contentStoreUri("bucket", bigDigest);
    const head = {
      ChecksumSHA256: "Y29tcG9zaXRl-2",
      ChecksumType: "COMPOSITE",
      Metadata: { sha256: bigDigest },
    };
    const holding = (ContentLength: number) => {
      const s3 = new MultipartFakeS3();
      s3.head = { ...head, ContentLength };
      return s3.asClient();
    };
    expect(await presignVerifiedS3GetUrl(holding(bigSize), uri, bigDigest, bigSize, 60)).toContain(
      bigDigest,
    );
    await expect(
      presignVerifiedS3GetUrl(holding(42), uri, bigDigest, 42, 60),
    ).rejects.toMatchObject({ name: "PLAN_ARTIFACT_DIGEST_MISMATCH" });
  });
});

/** Behaves like S3 at the size limits and records part sizes instead of holding the bytes. */
class MultipartFakeS3 {
  readonly calls: { name: string; input: Record<string, unknown> }[] = [];
  readonly partSizes: number[] = [];
  head: Record<string, unknown> | undefined;
  failNextPart: Error | undefined;
  maxPartsInFlight = 0;
  #inFlight = 0;

  asClient(): S3Client {
    const client = new S3Client({
      region: "us-east-2",
      credentials: { accessKeyId: "AKIDTEST", secretAccessKey: "test-secret" },
    });
    client.send = ((command: { constructor: { name: string }; input: Record<string, unknown> }) =>
      this.send(command)) as S3Client["send"];
    return client;
  }

  async send(command: {
    constructor: { name: string };
    input: Record<string, unknown>;
  }): Promise<unknown> {
    const { name } = command.constructor;
    const { Body, ...input } = command.input;
    this.calls.push({ name, input });
    if (name === "HeadObjectCommand") {
      if (this.head) return this.head;
      throw Object.assign(new Error("not found"), {
        name: "NotFound",
        $metadata: { httpStatusCode: 404 },
      });
    }
    if (name === "PutObjectCommand" && Number(input.ContentLength) > MAX_SINGLE_PUT_BYTES) {
      (Body as NodeJS.ReadableStream & { destroy(): void }).destroy();
      throw Object.assign(new Error("EntityTooLarge"), { name: "EntityTooLarge" });
    }
    if (name === "CopyObjectCommand" && Number(this.head?.ContentLength) > MAX_SINGLE_PUT_BYTES) {
      throw Object.assign(new Error("copy source too large"), { name: "InvalidRequest" });
    }
    if (name === "CreateMultipartUploadCommand") return { UploadId: "upload-1" };
    if (name === "UploadPartCommand") {
      this.maxPartsInFlight = Math.max(this.maxPartsInFlight, ++this.#inFlight);
      try {
        const hash = createHash("sha256");
        let length = 0;
        for await (const chunk of Body as AsyncIterable<Buffer>) {
          hash.update(chunk);
          length += chunk.length;
        }
        const failure = this.failNextPart;
        this.failNextPart = undefined;
        if (failure) throw failure;
        if (length !== input.ContentLength || hash.digest("base64") !== input.ChecksumSHA256) {
          throw s3Error("BadDigest", 400);
        }
        this.partSizes.push(length);
        return { ETag: `"part-${String(input.PartNumber)}"` };
      } finally {
        this.#inFlight -= 1;
      }
    }
    if (name === "UploadPartCopyCommand") {
      return { CopyPartResult: { ETag: `"copy-${String(input.PartNumber)}"` } };
    }
    if (name === "CompleteMultipartUploadCommand" || name === "AbortMultipartUploadCommand") {
      return {};
    }
    throw new Error(`unexpected command ${name}`);
  }
}

class ContentAddressedFakeS3 {
  readonly objects = new Map<string, { bytes: Buffer; sha256: string; lastModified?: Date }>();
  readonly copies: Record<string, unknown>[] = [];
  putCount = 0;
  putAttempts = 0;
  failNextPut: Error | undefined;
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
        CopySource?: string;
        MetadataDirective?: string;
        ChecksumAlgorithm?: string;
        ChecksumSHA256?: string;
      };
    };
    const uri = `s3://${value.input.Bucket}/${value.input.Key}`;
    if (value.constructor.name === "CopyObjectCommand") {
      const { CopySource, MetadataDirective, Metadata, ChecksumAlgorithm } = value.input;
      this.copies.push({ uri, CopySource, MetadataDirective, Metadata, ChecksumAlgorithm });
      const source = this.objects.get(`s3://${CopySource}`);
      if (!source) throw new Error("missing copy source");
      this.objects.set(uri, {
        bytes: source.bytes,
        sha256: Metadata?.sha256 ?? "",
        lastModified: new Date(),
      });
      return {};
    }
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
        LastModified: object.lastModified,
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
      this.putAttempts += 1;
      const failure = this.failNextPut;
      this.failNextPut = undefined;
      if (failure) throw failure;
      const checksum = createHash("sha256").update(bytes).digest("base64");
      if (value.input.ChecksumSHA256 !== undefined && value.input.ChecksumSHA256 !== checksum) {
        throw s3Error("BadDigest", 400);
      }
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
