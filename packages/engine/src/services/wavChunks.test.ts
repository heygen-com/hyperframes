import { describe, expect, it } from "vitest";
import { riffChunks, wavFormatTag } from "./wavChunks.js";

/**
 * The two WAV readers that share this walk both had their own copy, and neither
 * had a test for the walk itself — a real WAV out of the mixer has an even-sized
 * `fmt ` first and `data` last, so the two things the walk exists to handle
 * (ordering, and the pad byte after an odd chunk) never came up in either suite.
 */
function riff(chunks: { id: string; body: Buffer }[]): Buffer {
  const parts: Buffer[] = [Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE")];
  for (const { id, body } of chunks) {
    const header = Buffer.alloc(8);
    header.write(id, 0, "ascii");
    header.writeUInt32LE(body.length, 4);
    parts.push(header, body);
    // Word alignment: an odd body is followed by a pad byte the size excludes.
    if (body.length % 2) parts.push(Buffer.alloc(1));
  }
  const buf = Buffer.concat(parts);
  buf.writeUInt32LE(buf.length - 8, 4);
  return buf;
}

describe("riffChunks", () => {
  it("steps over the pad byte after an odd-sized chunk", () => {
    // An odd LIST is what ffmpeg writes for a metadata string of odd length. Read
    // without the pad, every chunk after it is one byte out and reads as garbage.
    const buf = riff([
      { id: "LIST", body: Buffer.from("INFOodd") },
      { id: "data", body: Buffer.from([1, 2, 3, 4]) },
    ]);
    const found = [...riffChunks(buf)];
    expect(found.map((c) => c.id)).toEqual(["LIST", "data"]);
    const data = found[1];
    if (!data) throw new Error("no data chunk");
    expect(buf.subarray(data.body, data.body + data.size)).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it("yields chunks in file order, whatever that order is", () => {
    // `data` before `fmt ` is legal and the reason the walk advances by declared
    // size rather than assuming a layout.
    const buf = riff([
      { id: "data", body: Buffer.alloc(6) },
      { id: "fmt ", body: Buffer.alloc(16) },
    ]);
    expect([...riffChunks(buf)].map((c) => c.id)).toEqual(["data", "fmt "]);
  });

  it("stops at a chunk header that runs past the end of the file", () => {
    // Truncated downloads and interrupted writes both land here; the walk must
    // end rather than read off the buffer.
    const buf = Buffer.concat([riff([{ id: "data", body: Buffer.alloc(4) }]), Buffer.from("da")]);
    expect([...riffChunks(buf)].map((c) => c.id)).toEqual(["data"]);
  });
});

describe("wavFormatTag", () => {
  const floatFmt = Buffer.from(
    "feff040080bb000000b80b001000200016002000070100000300000000001000800000aa00389b71",
    "hex",
  );

  it("resolves a complete IEEE float GUID", () => {
    expect(wavFormatTag(floatFmt, 0, floatFmt.length)).toBe(3);
  });

  it("rejects a different GUID sharing the float prefix", () => {
    const unknown = Buffer.from(floatFmt);
    unknown[39] = 0;
    expect(wavFormatTag(unknown, 0, unknown.length)).toBeNull();
  });

  it("does not read a GUID beyond the declared chunk", () => {
    expect(wavFormatTag(floatFmt, 0, 24)).toBeNull();
  });

  it("rejects a physically truncated GUID", () => {
    expect(wavFormatTag(floatFmt.subarray(0, 39), 0, 40)).toBeNull();
  });

  it.each([0, 21, 23])("rejects an invalid extension length of %i", (size) => {
    const malformed = Buffer.from(floatFmt);
    malformed.writeUInt16LE(size, 16);
    expect(wavFormatTag(malformed, 0, malformed.length)).toBeNull();
  });
});
