/**
 * Unit tests for the S3 URI parser + tar helpers. Real S3 network calls
 * are covered by the dispatch tests in `handler.test.ts` via a fake
 * S3Client; here we pin the lower-level helpers.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatS3Uri, parseS3Uri, tarDirectory, untarDirectory } from "./s3Transport.js";

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
