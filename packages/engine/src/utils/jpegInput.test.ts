import { describe, expect, it } from "vitest";
import { validJpeg } from "../services/__fixtures__/jpeg.js";
import { jpegInputError } from "./jpegInput.js";

function withDqt(descriptor: number, bytes: number): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0, bytes + 3, descriptor]),
    Buffer.alloc(bytes, 1),
    Buffer.from([0xff, 0xda, 0, 2]),
  ]);
}

describe("JPEG input diagnostics", () => {
  it("accepts an actual FFmpeg-encoded JPEG", () => {
    expect(jpegInputError(validJpeg)).toBeUndefined();
  });
  it("identifies the reproduced invalid DQT precision", () => {
    const malformed = Buffer.from(validJpeg);
    const dqt = malformed.indexOf(Buffer.from([0xff, 0xdb]));
    expect(dqt).toBeGreaterThan(0);
    malformed[dqt + 4] = 0x20;
    expect(jpegInputError(malformed)).toBe("invalid JPEG DQT precision 2");
  });
  it.each([0, 1])("accepts DQT precision %i", (precision) => {
    expect(jpegInputError(withDqt(precision << 4, precision === 0 ? 64 : 128))).toBeUndefined();
  });
  it("rejects a truncated DQT table within a complete segment", () => {
    expect(jpegInputError(withDqt(0, 63))).toBe("truncated JPEG DQT table");
  });
  it.each([
    [Buffer.alloc(0), "empty frame"],
    [Buffer.from([0]), "missing JPEG SOI marker"],
    [Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0, 67]), "invalid JPEG segment length"],
    [Buffer.from([0xff, 0xd8, 0xff]), "truncated JPEG marker"],
  ])("reports malformed input without reading past its buffer", (buffer, message) => {
    expect(jpegInputError(buffer)).toBe(message);
  });
});
