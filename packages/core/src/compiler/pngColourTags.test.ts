import { describe, expect, it } from "vitest";
import { stripSdrPngColourTags } from "./pngColourTags";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  // The helper never reads a CRC, so a filler is enough to tell the chunks apart.
  return Buffer.concat([length, Buffer.from(type, "latin1"), data, Buffer.alloc(4, 0xcc)]);
}

const IDAT = chunk("IDAT", Buffer.from([1, 2, 3]));
const png = (...before: Buffer[]) =>
  Buffer.concat([
    SIGNATURE,
    chunk("IHDR", Buffer.alloc(13)),
    ...before,
    IDAT,
    chunk("IEND", Buffer.alloc(0)),
  ]);
const cicp = (transfer: number) => chunk("cICP", Buffer.from([1, transfer, 0, 1]));

describe("stripSdrPngColourTags", () => {
  it.each([
    ["a BT.709 cICP", cicp(1)],
    ["an sRGB cICP", cicp(13)],
    ["a gAMA", chunk("gAMA", Buffer.alloc(4))],
    ["a cHRM", chunk("cHRM", Buffer.alloc(32))],
  ])("drops %s and nothing else", (_name, tag) => {
    expect(stripSdrPngColourTags(png(tag))?.equals(png())).toBe(true);
  });

  it("keeps the chunks that already match the file's values", () => {
    const kept = [chunk("sRGB", Buffer.from([0])), chunk("iCCP", Buffer.alloc(8))];
    expect(stripSdrPngColourTags(png(...kept, cicp(1)))?.equals(png(...kept))).toBe(true);
  });

  it.each([
    ["has no colour tag", png()],
    ["carries a PQ cICP", png(cicp(16), chunk("gAMA", Buffer.alloc(4)))],
    ["carries an HLG cICP", png(cicp(18))],
    ["is cut short", png(cicp(1)).subarray(0, 40)],
  ])("leaves a PNG that %s alone", (_name, bytes) => {
    expect(stripSdrPngColourTags(bytes)).toBeNull();
  });
});
