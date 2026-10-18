import { createReadStream, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as zlib from "node:zlib";
import { contentDispositionHeader } from "./contentDisposition.js";

const FRAME_FILENAME = /^frame_\d{6}\.png$/;
const AUDIO_FILENAME = "audio.m4a";
const ZIP64_END_RECORDS_LENGTH = 98n;
const UINT32_MAX = 0xffff_ffff;
const ZIP_LOCAL_FILE_HEADER = 0x0403_4b50;
const ZIP_DATA_DESCRIPTOR = 0x0807_4b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x0201_4b50;
const ZIP64_END_RECORD = 0x0606_4b50;
const ZIP64_END_LOCATOR = 0x0706_4b50;
const ZIP_END_RECORD = 0x0605_4b50;
const ZIP_FLAGS = 0x0808; // UTF-8 names and a trailing data descriptor.

interface ArchiveEntry {
  name: string;
  path: string;
  size: bigint;
}

export interface ZipEntrySize {
  name: string;
  size: bigint;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

// `zlib.crc32` only exists from Node 22.2, below the package's `>=22` floor.
const nativeCrc32: ((data: Uint8Array, value?: number) => number) | undefined =
  typeof zlib.crc32 === "function" ? zlib.crc32 : undefined;

/** Running CRC-32 (start at 0), same chaining contract as `zlib.crc32(data, value)`. */
export function updateCrc32(crc: number, bytes: Uint8Array): number {
  return nativeCrc32 ? nativeCrc32(bytes, crc) : tableCrc32(crc, bytes);
}

export function tableCrc32(crc: number, bytes: Uint8Array): number {
  let updated = (crc ^ UINT32_MAX) >>> 0;
  for (const byte of bytes) {
    updated = (CRC32_TABLE[(updated ^ byte) & 0xff] ?? 0) ^ (updated >>> 8);
  }
  return (updated ^ UINT32_MAX) >>> 0;
}

function readArchiveEntries(directory: string): ArchiveEntry[] {
  if (!lstatSync(directory).isDirectory()) {
    throw new Error("PNG-sequence output is not a directory");
  }

  const candidates = readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && (FRAME_FILENAME.test(entry.name) || entry.name === AUDIO_FILENAME),
    )
    .map((entry) => entry.name)
    .sort((left, right) => {
      if (left === AUDIO_FILENAME) return right === AUDIO_FILENAME ? 0 : 1;
      if (right === AUDIO_FILENAME) return -1;
      return left.localeCompare(right);
    });

  const entries: ArchiveEntry[] = [];
  for (const name of candidates) {
    const path = join(directory, name);
    try {
      const stat = lstatSync(path);
      if (stat.isFile()) entries.push({ name, path, size: BigInt(stat.size) });
    } catch {
      // Ignore a file that disappeared while the archive manifest was read.
    }
  }
  return entries;
}

/** Compute the exact length of an archive that always emits ZIP64 records. */
export function calculateZip64ContentLength(entries: readonly ZipEntrySize[]): bigint {
  let length = ZIP64_END_RECORDS_LENGTH;
  for (const entry of entries) {
    const filenameLength = BigInt(Buffer.byteLength(entry.name));
    length += 30n + filenameLength + 20n + entry.size + 24n;
    length += 46n + filenameLength + 28n;
  }
  return length;
}

function localFileHeader(entry: ArchiveEntry): Buffer {
  const filename = Buffer.from(entry.name, "utf8");
  const header = Buffer.alloc(30 + filename.length + 20);
  header.writeUInt32LE(ZIP_LOCAL_FILE_HEADER, 0);
  header.writeUInt16LE(45, 4);
  header.writeUInt16LE(ZIP_FLAGS, 6);
  header.writeUInt16LE(0, 8); // STORE
  header.writeUInt16LE(0, 10); // DOS time
  header.writeUInt16LE(0x21, 12); // DOS date: 1980-01-01
  header.writeUInt32LE(0, 14); // CRC is written in the data descriptor.
  header.writeUInt32LE(UINT32_MAX, 18);
  header.writeUInt32LE(UINT32_MAX, 22);
  header.writeUInt16LE(filename.length, 26);
  header.writeUInt16LE(20, 28);
  filename.copy(header, 30);

  const extraOffset = 30 + filename.length;
  header.writeUInt16LE(0x0001, extraOffset);
  header.writeUInt16LE(16, extraOffset + 2);
  header.writeBigUInt64LE(entry.size, extraOffset + 4);
  header.writeBigUInt64LE(entry.size, extraOffset + 12);
  return header;
}

function dataDescriptor(crc: number, size: bigint): Buffer {
  const descriptor = Buffer.alloc(24);
  descriptor.writeUInt32LE(ZIP_DATA_DESCRIPTOR, 0);
  descriptor.writeUInt32LE(crc, 4);
  descriptor.writeBigUInt64LE(size, 8);
  descriptor.writeBigUInt64LE(size, 16);
  return descriptor;
}

function centralDirectoryHeader(entry: ArchiveEntry, crc: number, localOffset: bigint): Buffer {
  const filename = Buffer.from(entry.name, "utf8");
  const header = Buffer.alloc(46 + filename.length + 28);
  header.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_HEADER, 0);
  header.writeUInt16LE(45, 4); // ZIP64 creator version.
  header.writeUInt16LE(45, 6);
  header.writeUInt16LE(ZIP_FLAGS, 8);
  header.writeUInt16LE(0, 10); // STORE
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0x21, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(UINT32_MAX, 20);
  header.writeUInt32LE(UINT32_MAX, 24);
  header.writeUInt16LE(filename.length, 28);
  header.writeUInt16LE(28, 30);
  header.writeUInt16LE(0, 32); // No file comment.
  header.writeUInt16LE(0, 34); // Disk number.
  header.writeUInt16LE(0, 36); // Internal attributes.
  header.writeUInt32LE(0, 38); // External attributes.
  header.writeUInt32LE(UINT32_MAX, 42);
  filename.copy(header, 46);

  const extraOffset = 46 + filename.length;
  header.writeUInt16LE(0x0001, extraOffset);
  header.writeUInt16LE(24, extraOffset + 2);
  header.writeBigUInt64LE(entry.size, extraOffset + 4);
  header.writeBigUInt64LE(entry.size, extraOffset + 12);
  header.writeBigUInt64LE(localOffset, extraOffset + 20);
  return header;
}

function endRecords(entryCount: number, directorySize: bigint, directoryOffset: bigint): Buffer {
  const records = Buffer.alloc(Number(ZIP64_END_RECORDS_LENGTH));
  records.writeUInt32LE(ZIP64_END_RECORD, 0);
  records.writeBigUInt64LE(44n, 4); // ZIP64 end-record payload length.
  records.writeUInt16LE(45, 12);
  records.writeUInt16LE(45, 14);
  records.writeUInt32LE(0, 16);
  records.writeUInt32LE(0, 20);
  records.writeBigUInt64LE(BigInt(entryCount), 24);
  records.writeBigUInt64LE(BigInt(entryCount), 32);
  records.writeBigUInt64LE(directorySize, 40);
  records.writeBigUInt64LE(directoryOffset, 48);

  records.writeUInt32LE(ZIP64_END_LOCATOR, 56);
  records.writeUInt32LE(0, 60);
  records.writeBigUInt64LE(directoryOffset + directorySize, 64);
  records.writeUInt32LE(1, 72);

  records.writeUInt32LE(ZIP_END_RECORD, 76);
  records.writeUInt16LE(0, 80);
  records.writeUInt16LE(0, 82);
  records.writeUInt16LE(0xffff, 84);
  records.writeUInt16LE(0xffff, 86);
  records.writeUInt32LE(UINT32_MAX, 88);
  records.writeUInt32LE(UINT32_MAX, 92);
  records.writeUInt16LE(0, 96);
  return records;
}

async function* zipChunks(entries: readonly ArchiveEntry[]): AsyncGenerator<Uint8Array> {
  const centralHeaders: Buffer[] = [];
  let offset = 0n;

  for (const entry of entries) {
    const localOffset = offset;
    const header = localFileHeader(entry);
    yield header;
    offset += BigInt(header.length);

    let crc = 0;
    let bytesRead = 0n;
    if (entry.size > 0n) {
      // Bounded to the stat'd size so a file growing mid-download cannot push
      // the body past the advertised Content-Length.
      const stream = createReadStream(entry.path, { start: 0, end: Number(entry.size - 1n) });
      try {
        for await (const chunk of stream) {
          if (!(chunk instanceof Uint8Array)) continue;
          crc = updateCrc32(crc, chunk);
          bytesRead += BigInt(chunk.length);
          yield chunk;
        }
      } finally {
        stream.destroy();
      }
    }
    if (bytesRead !== entry.size) {
      throw new Error(`Render file changed while archiving: ${entry.name}`);
    }

    offset += entry.size;
    const descriptor = dataDescriptor(crc, entry.size);
    yield descriptor;
    offset += BigInt(descriptor.length);
    centralHeaders.push(centralDirectoryHeader(entry, crc, localOffset));
  }

  const directoryOffset = offset;
  let directorySize = 0n;
  for (const header of centralHeaders) {
    yield header;
    directorySize += BigInt(header.length);
  }
  yield endRecords(centralHeaders.length, directorySize, directoryOffset);
}

function readableZipStream(entries: readonly ArchiveEntry[]): ReadableStream<Uint8Array> {
  const iterator = zipChunks(entries);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}

/** Stream a validated PNG-sequence directory as a ZIP64 archive. */
export function directoryZipResponse(directory: string, jobId: string): Response {
  const entries = readArchiveEntries(directory);
  const filename = `${jobId}.zip`;
  const length = calculateZip64ContentLength(entries);
  return new Response(readableZipStream(entries), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": contentDispositionHeader("attachment", filename),
      "Content-Length": String(length),
    },
  });
}
