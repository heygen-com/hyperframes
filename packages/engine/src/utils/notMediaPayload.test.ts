import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertMediaPayload,
  fingerprintElementId,
  isNotMediaPayload,
  NotMediaPayloadError,
} from "./notMediaPayload.js";

function writeFixture(name: string, contents: string | Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-markup-sniff-"));
  const filePath = join(dir, name);
  writeFileSync(filePath, contents);
  return filePath;
}

describe("isNotMediaPayload", () => {
  it.each([
    ["doctype", "<!DOCTYPE html>\n<html><body></body></html>"],
    ["bare html tag, uppercase", "<HTML><body>hi</body></HTML>"],
    [
      "xml prolog",
      '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"/>',
    ],
    // The prolog-less form is the common minified SVG shape, and the one a
    // `<!doctype|<html|<?xml` prefix allowlist misses.
    ["prolog-less svg", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>'],
    // How a media URL most often downloads as XML in production: an expired
    // signed URL or an ACL change, served as a 200 with an S3 error body.
    ["s3 error document", '<?xml version="1.0"?><Error><Code>AccessDenied</Code></Error>'],
    ["comment first", "<!-- generated -->\n<!DOCTYPE html>"],
    // Replicate answers a dead asset this way, and a gateway in front of it can
    // relay the body with a 200 — the shape a `<` -only check misses.
    ["json object error body", '{"detail": "requested file not found"}'],
    ["json array body", '[{"error": "gone"}]'],
  ])("detects %s", async (_label, contents) => {
    expect(await isNotMediaPayload(writeFixture("payload", contents))).toBe(true);
  });

  it("detects a document behind a UTF-8 BOM and leading whitespace", async () => {
    const filePath = writeFixture(
      "bom.html",
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from("\n  \t<!doctype html><html></html>"),
      ]),
    );
    expect(await isNotMediaPayload(filePath)).toBe(true);
  });

  it("detects a document behind a leading NUL run", async () => {
    const filePath = writeFixture(
      "nul.html",
      Buffer.concat([Buffer.from([0x00, 0x00, 0x00]), Buffer.from("<html>x</html>")]),
    );
    expect(await isNotMediaPayload(filePath)).toBe(true);
  });

  it.each([
    ["little-endian", [0xff, 0xfe]],
    ["big-endian", [0xfe, 0xff]],
  ])("detects UTF-16 %s markup", async (_label, bom) => {
    // UTF-16 interleaves NULs between ASCII bytes, so a utf8-decoded prefix
    // comparison sees replacement characters and misses it entirely.
    const body = Buffer.from("<html>", "utf16le");
    const bytes = _label === "little-endian" ? body : body.swap16();
    const filePath = writeFixture("utf16.html", Buffer.concat([Buffer.from(bom), bytes]));
    expect(await isNotMediaPayload(filePath)).toBe(true);
  });

  it("detects nothing when padding overruns the sniff window", async () => {
    const filePath = writeFixture("padded.html", `${" ".repeat(600)}<!doctype html>`);
    // 600 bytes of padding overruns the 512-byte sniff window, so the verdict
    // has to be "unknown" (false) rather than a misread — asserted here so the
    // window size is a deliberate, visible bound rather than an accident.
    expect(await isNotMediaPayload(filePath)).toBe(false);
  });

  it.each([
    ["mp4 / ftypmp42", [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]],
    ["matroska / webm EBML", [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]],
    ["ogg", [0x4f, 0x67, 0x67, 0x53, 0x00, 0x02]],
    ["riff / wav", [0x52, 0x49, 0x46, 0x46, 0x24, 0x08]],
    ["mpeg-ts", [0x47, 0x40, 0x00, 0x10]],
    ["flac", [0x66, 0x4c, 0x61, 0x43, 0x00]],
    ["mp3 / ID3", [0x49, 0x44, 0x33, 0x03, 0x00]],
    ["adts aac", [0xff, 0xf1, 0x50, 0x80]],
    ["mpeg-ps", [0x00, 0x00, 0x01, 0xba]],
  ])("does not flag a %s container", async (_label, bytes) => {
    expect(await isNotMediaPayload(writeFixture("clip.bin", Buffer.from(bytes)))).toBe(false);
  });

  it("does not flag a container that merely contains a document byte further in", async () => {
    const filePath = writeFixture(
      "not-html.bin",
      Buffer.concat([Buffer.from([0x00, 0x00, 0x01, 0xba]), Buffer.from("<html later on")]),
    );
    expect(await isNotMediaPayload(filePath)).toBe(false);
  });

  it("does not flag an empty file", async () => {
    expect(await isNotMediaPayload(writeFixture("empty.bin", ""))).toBe(false);
  });

  it("reports not-a-document instead of throwing when the path is a directory", async () => {
    // `existsSync` passes for a directory, so callers reach the sniff with one.
    // The read fails EISDIR; classifying rather than propagating keeps the real
    // probe's own error as the one the caller sees.
    const dir = mkdtempSync(join(tmpdir(), "hf-markup-sniff-dir-"));
    mkdirSync(join(dir, "assets"));
    expect(await isNotMediaPayload(join(dir, "assets"))).toBe(false);
  });

  it("reports not-a-document instead of throwing when the file is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-markup-sniff-gone-"));
    expect(await isNotMediaPayload(join(dir, "evicted.mp4"))).toBe(false);
  });
});

describe("assertMediaPayload", () => {
  it("throws NotMediaPayloadError carrying routing metadata and a hashed element key", async () => {
    const filePath = writeFixture("nested.html", "<!DOCTYPE html><html></html>");

    let caught: unknown;
    try {
      await assertMediaPayload(filePath, "aroll-scene-3");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(NotMediaPayloadError);
    const error = caught as NotMediaPayloadError;
    expect(error.code).toBe("NOT_MEDIA_PAYLOAD");
    expect(error.owner).toBe("user");
    expect(error.retryable).toBe(false);
    expect(error.elementFingerprints).toEqual([fingerprintElementId("aroll-scene-3")]);
    expect(error.message).toContain(fingerprintElementId("aroll-scene-3"));
  });

  it("names both possible causes and leaks neither the src nor the payload bytes", async () => {
    // `error.message` is forwarded to API clients over SSE/JSON, so a
    // per-tenant CDN path or a token in the payload's first bytes must not
    // reach it — and an on-call engineer must not be pointed at the authoring
    // bug when a 403 error page is the actual cause.
    const filePath = writeFixture(
      "interstitial.html",
      '<!DOCTYPE html><html data-request-token="tok_9fA3xQ7pLz">',
    );

    const error = await assertMediaPayload(
      filePath,
      "https://cdn.example.com/tenants/acme-corp/projects/secret-q4/streamed-preview.html",
    ).catch((caught: unknown) => caught as NotMediaPayloadError);

    expect(error.message).not.toContain("acme-corp");
    expect(error.message).not.toContain("secret-q4");
    expect(error.message).not.toContain("cdn.example.com");
    expect(error.message).not.toContain("tok_9fA3xQ7pLz");
    expect(error.message).toContain("unresolved");
    expect(error.message).toContain("success status");
  });

  it("resolves for a real container", async () => {
    const filePath = writeFixture("clip.mp4", Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74]));
    await expect(assertMediaPayload(filePath, "v1")).resolves.toBeUndefined();
  });

  it("caps the fingerprint list so the message stays bounded", async () => {
    const error = new NotMediaPayloadError(
      Array.from({ length: 12 }, (_unused, index) => fingerprintElementId(`el-${index}`)),
    );
    expect(error.message).toContain("+4");
    expect(error.message.length).toBeLessThan(500);
  });
});
