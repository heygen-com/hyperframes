import { PassThrough, Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFrames } from "./frameReader.js";

const FRAME = 12;

/** `count` frames whose every byte names the frame, so a mixed-up or shifted byte shows. */
const frames = (count: number) =>
  Array.from({ length: count }, (_, n) => Buffer.alloc(FRAME, n + 1));
const stream = (chunks: Buffer[]) => Readable.from(chunks, { objectMode: false });
const cut = (whole: Buffer, sizes: number[]) => {
  const chunks: Buffer[] = [];
  let at = 0;
  for (const size of sizes) {
    chunks.push(whole.subarray(at, at + size));
    at += size;
  }
  if (at < whole.length) chunks.push(whole.subarray(at));
  return chunks;
};
const read = async (source: NodeJS.ReadableStream) => {
  const out: Buffer[] = [];
  for await (const frame of readFrames(source, FRAME)) out.push(Buffer.from(frame));
  return out;
};

afterEach(() => vi.restoreAllMocks());

describe("readFrames", () => {
  it("yields each frame in order whatever the chunks split or coalesce", async () => {
    const sent = frames(6);
    const whole = Buffer.concat(sent);
    for (const sizes of [
      [FRAME],
      [1, 1, 1],
      [5, 20, 3, 44],
      [FRAME * 6],
      [FRAME * 2 + 5, FRAME * 3 - 5],
      [FRAME - 1, 1, FRAME + 1, FRAME - 1],
    ]) {
      expect(await read(stream(cut(whole, sizes)))).toEqual(sent);
    }
  });

  it("drops a partial frame at the end of the stream, as a cut-off decoder leaves it", async () => {
    const sent = frames(3);
    const whole = Buffer.concat([...sent, Buffer.alloc(FRAME - 4, 9)]);
    expect(await read(stream(cut(whole, [7, 19, 11])))).toEqual(sent);
  });

  it("yields nothing for an empty stream", async () => {
    expect(await read(stream([]))).toEqual([]);
  });

  it("gives each frame its own memory, so a held frame survives the next one being read", async () => {
    const whole = Buffer.concat(frames(3));
    const held: Buffer[] = [];
    for await (const frame of readFrames(stream(cut(whole, [5, 5, 5])), FRAME)) held.push(frame);
    expect(held).toEqual(frames(3));
  });

  it("throws the stream's error to the reader", async () => {
    const source = new PassThrough();
    const reading = read(source);
    source.write(Buffer.alloc(FRAME + 3, 1));
    source.destroy(new Error("decoder pipe broke"));
    await expect(reading).rejects.toThrow("decoder pipe broke");
  });

  it("stops reading, and releases the stream, when the reader leaves early", async () => {
    const source = new PassThrough();
    source.write(Buffer.concat(frames(4)));
    for await (const frame of readFrames(source, FRAME)) {
      expect(frame).toEqual(frames(1)[0]);
      break;
    }
    expect(source.destroyed).toBe(true);
  });

  it("copies each byte once: a pipe's small chunks never re-copy what was already gathered", async () => {
    const frameBytes = 64 * 1024 * 8;
    const frame = Buffer.alloc(frameBytes, 7);
    const chunks = cut(Buffer.concat([frame, frame, frame]), Array(24).fill(64 * 1024));
    const concat = vi.spyOn(Buffer, "concat");
    const copy = vi.spyOn(Buffer.prototype, "copy");

    let count = 0;
    for await (const got of readFrames(stream(chunks), frameBytes)) {
      expect(got.length).toBe(frameBytes);
      count++;
    }

    const concatenated = concat.mock.results.reduce(
      (sum, r) => sum + (r.value as Buffer).length,
      0,
    );
    const copied = copy.mock.results.reduce((sum, r) => sum + (r.value as number), 0);
    expect(count).toBe(3);
    expect(concatenated + copied).toBeLessThanOrEqual(frameBytes * 3 * 1.01);
  });
});
