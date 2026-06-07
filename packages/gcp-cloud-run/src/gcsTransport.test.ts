/**
 * GCS transport unit tests — URI parsing, tar round-trip, and the
 * download/upload bridge over the `FakeGcs` double.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asStorage, FakeGcs } from "./__fixtures__/fakeGcs.js";
import {
  downloadGcsObjectToFile,
  formatGcsUri,
  parseGcsUri,
  tarDirectory,
  untarDirectory,
  uploadFileToGcs,
} from "./gcsTransport.js";

const tmpDirs: string[] = [];
function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("parseGcsUri", () => {
  it("splits bucket and key", () => {
    expect(parseGcsUri("gs://my-bucket/path/to/object.tar.gz")).toEqual({
      bucket: "my-bucket",
      key: "path/to/object.tar.gz",
    });
  });

  it("rejects non-gs URIs", () => {
    expect(() => parseGcsUri("s3://b/k")).toThrow(/expected gs:\/\//);
  });

  it("rejects a bucket with no key", () => {
    expect(() => parseGcsUri("gs://just-a-bucket")).toThrow(/missing key/);
  });

  it("rejects an empty bucket", () => {
    expect(() => parseGcsUri("gs:///key")).toThrow(/empty bucket or key/);
  });

  it("round-trips through formatGcsUri", () => {
    const uri = "gs://b/some/key";
    expect(formatGcsUri(parseGcsUri(uri))).toBe(uri);
  });
});

describe("tarDirectory / untarDirectory", () => {
  it("round-trips a directory tree", async () => {
    const src = mkTmp("hf-tar-src-");
    mkdirSync(join(src, "nested"), { recursive: true });
    writeFileSync(join(src, "index.html"), "<html>hi</html>");
    writeFileSync(join(src, "nested", "data.json"), '{"a":1}');

    const work = mkTmp("hf-tar-work-");
    const tarball = join(work, "out.tar.gz");
    await tarDirectory(src, tarball);
    expect(existsSync(tarball)).toBe(true);

    const dest = join(work, "extracted");
    await untarDirectory(tarball, dest);
    expect(readFileSync(join(dest, "index.html"), "utf8")).toBe("<html>hi</html>");
    expect(readFileSync(join(dest, "nested", "data.json"), "utf8")).toBe('{"a":1}');
  });

  it("untar wipes a stale destination first", async () => {
    const src = mkTmp("hf-tar-src2-");
    writeFileSync(join(src, "keep.txt"), "new");
    const work = mkTmp("hf-tar-work2-");
    const tarball = join(work, "out.tar.gz");
    await tarDirectory(src, tarball);

    const dest = join(work, "extracted");
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "stale.txt"), "should be gone");

    await untarDirectory(tarball, dest);
    expect(existsSync(join(dest, "stale.txt"))).toBe(false);
    expect(readFileSync(join(dest, "keep.txt"), "utf8")).toBe("new");
  });
});

describe("download/upload bridge", () => {
  it("uploads a local file then downloads identical bytes", async () => {
    const gcs = new FakeGcs();
    const work = mkTmp("hf-dl-");
    const srcFile = join(work, "src.bin");
    writeFileSync(srcFile, Buffer.from("hello gcs"));

    const uri = "gs://bucket/obj.bin";
    await uploadFileToGcs(asStorage(gcs), srcFile, uri, "application/octet-stream");

    const dest = join(work, "dl.bin");
    await downloadGcsObjectToFile(asStorage(gcs), uri, dest);
    expect(readFileSync(dest, "utf8")).toBe("hello gcs");

    expect(gcs.ops.map((o) => o.kind)).toEqual(["upload", "download"]);
  });

  it("upload throws when the source file is missing", async () => {
    const gcs = new FakeGcs();
    await expect(uploadFileToGcs(asStorage(gcs), "/no/such/file", "gs://b/k")).rejects.toThrow(
      /upload source missing/,
    );
  });
});
