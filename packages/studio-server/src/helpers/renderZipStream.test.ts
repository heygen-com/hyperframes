import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  calculateZip64ContentLength,
  directoryZipResponse,
  tableCrc32,
  updateCrc32,
} from "./renderZipStream";

interface ParsedEntry {
  name: string;
  crc: number;
  size: bigint;
  data: Buffer;
}

// An independent reader: walks the end records back to the central directory
// and reads every entry through its ZIP64 extra field, as a real unzip does.
function parseZip64(archive: Buffer): ParsedEntry[] {
  const eocd = archive.length - 22;
  expect(archive.readUInt32LE(eocd)).toBe(0x06054b50);
  expect(archive.readUInt32LE(eocd + 16)).toBe(0xffffffff);
  const locator = eocd - 20;
  expect(archive.readUInt32LE(locator)).toBe(0x07064b50);
  const zip64End = Number(archive.readBigUInt64LE(locator + 8));
  expect(archive.readUInt32LE(zip64End)).toBe(0x06064b50);
  const count = Number(archive.readBigUInt64LE(zip64End + 32));
  const directorySize = archive.readBigUInt64LE(zip64End + 40);
  let cursor = Number(archive.readBigUInt64LE(zip64End + 48));
  expect(BigInt(cursor) + directorySize).toBe(BigInt(zip64End));

  const entries: ParsedEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    expect(archive.readUInt32LE(cursor)).toBe(0x02014b50);
    expect(archive.readUInt16LE(cursor + 10)).toBe(0); // STORE
    const crc = archive.readUInt32LE(cursor + 16);
    expect(archive.readUInt32LE(cursor + 20)).toBe(0xffffffff);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const name = archive.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    const extra = cursor + 46 + nameLength;
    expect(archive.readUInt16LE(extra)).toBe(0x0001);
    const size = archive.readBigUInt64LE(extra + 4);
    expect(archive.readBigUInt64LE(extra + 12)).toBe(size);
    const localOffset = Number(archive.readBigUInt64LE(extra + 20));

    expect(archive.readUInt32LE(localOffset)).toBe(0x04034b50);
    const localName = archive.readUInt16LE(localOffset + 26);
    const localExtra = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localName + localExtra;
    const data = archive.subarray(dataStart, dataStart + Number(size));
    const descriptor = dataStart + Number(size);
    expect(archive.readUInt32LE(descriptor)).toBe(0x08074b50);
    expect(archive.readUInt32LE(descriptor + 4)).toBe(crc);
    expect(archive.readBigUInt64LE(descriptor + 8)).toBe(size);

    entries.push({ name, crc, size, data });
    cursor = extra + extraLength;
  }
  return entries;
}

// Reference CRC-32, deliberately the slow bitwise form so it shares no code with the writer.
function referenceCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

describe("directoryZipResponse", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function sequence(files: Record<string, string | Buffer>): string {
    const root = mkdtempSync(join(tmpdir(), "hf-render-zip-"));
    roots.push(root);
    const dir = join(root, "job");
    mkdirSync(dir);
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    return dir;
  }

  it("streams a STORE ZIP64 archive of the frames then audio.m4a, with an exact Content-Length", async () => {
    const large = Buffer.alloc(200_000, 7); // spans several read-stream chunks
    const dir = sequence({
      "frame_000001.png": "second",
      "frame_000000.png": large,
      "audio.m4a": "audio",
      "notes.txt": "excluded",
      "frame_1.png": "excluded",
    });
    mkdirSync(join(dir, "nested"));
    writeFileSync(join(dir, "nested", "frame_000002.png"), "excluded");

    const response = directoryZipResponse(dir, "job");
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toContain('filename="job.zip"');
    const archive = Buffer.from(await response.arrayBuffer());
    expect(Number(response.headers.get("content-length"))).toBe(archive.length);

    const entries = parseZip64(archive);
    expect(entries.map((entry) => entry.name)).toEqual([
      "frame_000000.png",
      "frame_000001.png",
      "audio.m4a",
    ]);
    expect(entries[0]?.data.equals(large)).toBe(true);
    expect(entries[1]?.data.toString()).toBe("second");
    for (const entry of entries) expect(entry.crc).toBe(referenceCrc32(entry.data));
  });

  it("handles empty files and an empty directory", async () => {
    const withEmpty = directoryZipResponse(sequence({ "frame_000000.png": "" }), "job");
    const archive = Buffer.from(await withEmpty.arrayBuffer());
    expect(Number(withEmpty.headers.get("content-length"))).toBe(archive.length);
    expect(parseZip64(archive)).toEqual([
      expect.objectContaining({ name: "frame_000000.png", size: 0n, crc: 0 }),
    ]);

    const empty = directoryZipResponse(sequence({}), "job");
    const emptyArchive = Buffer.from(await empty.arrayBuffer());
    expect(emptyArchive.length).toBe(98);
    expect(parseZip64(emptyArchive)).toEqual([]);
  });

  it("does not follow a symlinked frame out of the directory", async (context) => {
    const outside = mkdtempSync(join(tmpdir(), "hf-render-zip-outside-"));
    roots.push(outside);
    writeFileSync(join(outside, "secret"), "secret");
    const dir = sequence({ "frame_000000.png": "a" });
    try {
      symlinkSync(join(outside, "secret"), join(dir, "frame_000001.png"));
    } catch {
      context.skip();
      return;
    }
    const archive = Buffer.from(await directoryZipResponse(dir, "job").arrayBuffer());
    expect(parseZip64(archive).map((entry) => entry.name)).toEqual(["frame_000000.png"]);
  });

  it("refuses a path that is not a directory", () => {
    const dir = sequence({ "frame_000000.png": "a" });
    expect(() => directoryZipResponse(join(dir, "frame_000000.png"), "job")).toThrow();
    expect(() => directoryZipResponse(join(dir, "missing"), "job")).toThrow();
  });
});

describe("ZIP64 arithmetic beyond 4 GiB", () => {
  it("computes Content-Length from 64-bit entry sizes without truncation", () => {
    const fiveGiB = 5n * 1024n ** 3n;
    const entries = [
      { name: "frame_000000.png", size: fiveGiB },
      { name: "frame_000001.png", size: fiveGiB },
    ];
    // local(30+16+20) + descriptor(24) + central(46+16+28) per entry, then 98 bytes of end records.
    const perEntryOverhead = 30n + 16n + 20n + 24n + 46n + 16n + 28n;
    expect(calculateZip64ContentLength(entries)).toBe(2n * (fiveGiB + perEntryOverhead) + 98n);
    expect(calculateZip64ContentLength(entries) > 0xffffffffn).toBe(true);
  });
});

describe.each([
  ["updateCrc32", updateCrc32],
  // The fallback used on Node 22.0/22.1, where zlib.crc32 does not exist.
  ["tableCrc32", tableCrc32],
])("%s", (_name, crc32) => {
  it("matches the reference CRC-32 and chains across chunks", () => {
    const data = Buffer.from("The quick brown fox jumps over the lazy dog");
    expect(crc32(0, data)).toBe(0x414fa339);
    const chained = crc32(crc32(0, data.subarray(0, 10)), data.subarray(10));
    expect(chained).toBe(referenceCrc32(data));
  });
});
