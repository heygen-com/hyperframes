import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { MAX_LOTTIE_BYTES, readLottieArchive, validLottieJson } from "./lottieValidation.js";
import { preflightLottieArchive } from "./lottieArchivePreflight.js";

const animation = JSON.stringify({ w: 100, h: 100, fr: 30, ip: 0, op: 30, layers: [] });

function archive(path: string, content = animation): Buffer {
  const zip = new AdmZip();
  zip.addFile(path, Buffer.from(content));
  return zip.toBuffer();
}

describe("Lottie archive validation", () => {
  it("rejects one deeply segmented name before constructing adm-zip entries", () => {
    const bytes = archive(`a/${"x/".repeat(5000)}demo.json`);
    expect(preflightLottieArchive(bytes)).toBe(false);
    expect(readLottieArchive(bytes)).toBeNull();
  });
  it.each([0x06054b50, 0x06064b50, 0x07064b50])("rejects ambiguous footer marker %s", (marker) => {
    const bytes = archive("a/demo.json");
    const end = bytes.length - 22;
    const injected = Buffer.alloc(4);
    injected.writeUInt32LE(marker);
    const ambiguous = Buffer.concat([bytes.subarray(0, end), injected, bytes.subarray(end)]);
    expect(preflightLottieArchive(ambiguous)).toBe(false);
  });
  it("rejects excessive EOCD entry counts before entry materialization", () => {
    const bytes = archive("a/demo.json");
    const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    bytes.writeUInt16LE(1000, end + 8);
    bytes.writeUInt16LE(1000, end + 10);
    expect(readLottieArchive(bytes)).toBeNull();
  });
  it.each(["a/demo.json", "animations/demo.json"])("preserves valid %s animation JSON", (path) => {
    expect(readLottieArchive(archive(path))).toBe(animation);
  });
  it("rejects corrupt archives and traversal names", () => {
    expect(readLottieArchive(Buffer.from("not a zip"))).toBeNull();
    expect(readLottieArchive(archive("animations/../demo.json"))).toBeNull();
  });
  it.each([0, MAX_LOTTIE_BYTES + 1])("rejects an unsafe declared expansion size %s", (size) => {
    const bytes = archive("a/demo.json");
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(central).toBeGreaterThan(0);
    bytes.writeUInt32LE(size, central + 24);
    expect(readLottieArchive(bytes)).toBeNull();
  });
});

describe("Lottie JSON validation", () => {
  it("accepts the supported animation shape", () => {
    expect(validLottieJson(animation)).toBe(true);
  });
  it.each([
    '{"w":100,"h":100,"layers":true}',
    '{"w":100000,"h":100000,"layers":[]}',
    '{"w":100,"h":100,"layers":[],"__proto__":{}}',
    '{"w":100,"h":100,"layers":[],"fr":1e999}',
    '{"w":100,"h":100,"layers":[true,null,"x"],"fr":30,"ip":0,"op":30}',
    '{"w":100,"h":100,"layers":[],"fr":5e-324,"ip":0,"op":10000000}',
    '{"w":100,"h":100,"layers":[],"assets":[{"layers":[false]}]}',
  ])("rejects invalid animation data %s", (source) => {
    expect(validLottieJson(source)).toBe(false);
  });
});
