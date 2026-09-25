import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectWebCaptureResource } from "./webCaptureResourceInspection";

const fromBase64 = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

const REAL_WOFF2 = new Uint8Array(
  readFileSync(
    resolve(
      process.cwd(),
      "../../skills/embedded-captions/modes/standard/fonts/files/orbitron-latin-400-normal.woff2",
    ),
  ),
);

function ascii(value: string): Uint8Array {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function mp4Box(type: string, payload: Uint8Array): Uint8Array {
  const output = new Uint8Array(8 + payload.length);
  new DataView(output.buffer).setUint32(0, output.length);
  output.set(ascii(type), 4);
  output.set(payload, 8);
  return output;
}

function minimalMp4(): Uint8Array {
  const mvhd = new Uint8Array(20);
  const mvhdView = new DataView(mvhd.buffer);
  mvhdView.setUint32(12, 1000);
  mvhdView.setUint32(16, 1000);
  const tkhd = new Uint8Array(84);
  const tkhdView = new DataView(tkhd.buffer);
  tkhdView.setUint32(76, 1 << 16);
  tkhdView.setUint32(80, 1 << 16);
  return concat(
    mp4Box("ftyp", ascii("isom0000")),
    mp4Box("moov", concat(mp4Box("mvhd", mvhd), mp4Box("trak", mp4Box("tkhd", tkhd)))),
  );
}

function minimalGlb(gltf: Record<string, unknown> = { asset: { version: "2.0" } }): Uint8Array {
  const encoded = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength = Math.ceil(encoded.length / 4) * 4;
  const bytes = new Uint8Array(20 + jsonLength);
  const view = new DataView(bytes.buffer);
  bytes.set(ascii("glTF"), 0);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20);
  bytes.set(encoded, 20);
  return bytes;
}

describe("inspectWebCaptureResource", () => {
  it("reads the closed image formats from their bytes", () => {
    const png = fromBase64(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    );
    const jpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x08, 0x08, 0x00, 0x01, 0x00, 0x01, 0x00, 0xff, 0xd9,
    ]);
    const webp = new Uint8Array(30);
    webp.set(ascii("RIFF"), 0);
    new DataView(webp.buffer).setUint32(4, 22, true);
    webp.set(ascii("WEBPVP8X"), 8);
    new DataView(webp.buffer).setUint32(16, 10, true);

    expect(inspectWebCaptureResource(png)).toEqual({ mime: "image/png", width: 1, height: 1 });
    expect(inspectWebCaptureResource(jpeg)).toEqual({ mime: "image/jpeg", width: 1, height: 1 });
    expect(inspectWebCaptureResource(webp)).toEqual({ mime: "image/webp", width: 1, height: 1 });
  });

  it("reads WOFF2 expansion metadata and the closed media containers", () => {
    const webm = fromBase64("GkXfo4AYU4BnmxVJqWaHRImERHoAABZUrmuKrojghrCBAbqBAQ==");

    expect(inspectWebCaptureResource(REAL_WOFF2)).toEqual({
      mime: "font/woff2",
      decodedBytes: 16336,
    });
    expect(inspectWebCaptureResource(minimalMp4())).toEqual({
      mime: "video/mp4",
      width: 1,
      height: 1,
      durationMs: 1000,
    });
    expect(inspectWebCaptureResource(webm)).toEqual({
      mime: "video/webm",
      width: 1,
      height: 1,
      durationMs: 1000,
    });
  });

  it("accepts a WebM segment whose standard EBML size is unknown", () => {
    const webm = fromBase64("GkXfo4AYU4BnmxVJqWaHRImERHoAABZUrmuKrojghrCBAbqBAQ==");
    webm[9] = 0xff;

    expect(inspectWebCaptureResource(webm)).toEqual({
      mime: "video/webm",
      width: 1,
      height: 1,
      durationMs: 1000,
    });
  });

  it("separates cheap header inspection from full materialization", () => {
    const fakeWoff2 = new Uint8Array(48);
    fakeWoff2.set(ascii("wOF2"));
    const view = new DataView(fakeWoff2.buffer);
    view.setUint32(8, fakeWoff2.length);
    view.setUint32(16, 1024);

    expect(inspectWebCaptureResource(ascii("hello"))).toBeNull();
    expect(inspectWebCaptureResource(fakeWoff2)).toEqual({
      mime: "font/woff2",
      decodedBytes: 1024,
    });
    expect(inspectWebCaptureResource(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  it("accepts a self-contained GLB and rejects model bytes that escape the envelope", () => {
    expect(inspectWebCaptureResource(minimalGlb())).toEqual({
      mime: "model/gltf-binary",
    });
    expect(
      inspectWebCaptureResource(
        minimalGlb({ asset: { version: "2.0" }, buffers: [{ uri: "https://host/model.bin" }] }),
      ),
    ).toBeNull();
    expect(
      inspectWebCaptureResource(
        minimalGlb({ asset: { version: "2.0" }, images: [{ uri: "texture.png" }] }),
      ),
    ).toBeNull();
  });
});
