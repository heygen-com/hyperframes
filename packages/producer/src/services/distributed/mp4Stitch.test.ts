import { describe, expect, it } from "bun:test";
import { buildStitchedHeader, readMp4Layout, readTracks } from "./mp4Stitch.js";

function box(type: string, ...body: Buffer[]): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.reduce((n, part) => n + part.length, 0));
  header.write(type, 4, "latin1");
  return Buffer.concat([header, ...body]);
}

function u32(...values: number[]): Buffer {
  const buf = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => buf.writeUInt32BE(value, i * 4));
  return buf;
}
const full = (type: string, ...body: Buffer[]) => box(type, u32(0), ...body);
// Version 0 mvhd/tkhd/mdhd with only the fields the stitcher reads filled in.
const header = (type: string, timescaleOrTrack: number, duration: number) =>
  type === "tkhd"
    ? full(type, u32(0, 0, timescaleOrTrack, 0, duration), Buffer.alloc(60))
    : full(type, u32(0, 0, timescaleOrTrack, duration), Buffer.alloc(type === "mvhd" ? 80 : 4));

interface FakeTrack {
  handler: "vide" | "soun";
  timescale: number;
  mediaTime: number;
  durations: number[];
  sizes: number[];
  sync?: number[];
}

/** A chunk file shaped like ffmpeg's: ftyp, mdat with samples interleaved one per mp4 chunk, moov. */
function fakeChunk(tag: number, tracks: FakeTrack[]): { file: Buffer; samples: Buffer[][] } {
  const samples = tracks.map((track, t) =>
    track.sizes.map((size, k) => Buffer.alloc(size, (tag * 61 + t * 17 + k * 5 + 1) & 255)),
  );
  const ftyp = box("ftyp", Buffer.from("isom\0\0\x02\0isom", "latin1"));
  const offsets = tracks.map(() => [] as number[]);
  const payload: Buffer[] = [];
  let at = ftyp.length + 8;
  for (let k = 0; k < Math.max(...tracks.map((track) => track.sizes.length)); k++) {
    samples.forEach((track, t) => {
      if (!track[k]) return;
      offsets[t]!.push(at);
      payload.push(track[k]!);
      at += track[k]!.length;
    });
  }
  const traks = tracks.map((track, t) => {
    const duration = track.durations.reduce((n, d) => n + d, 0);
    const stbl = box(
      "stbl",
      full("stsd", u32(1), box(track.handler === "vide" ? "avc1" : "mp4a", Buffer.alloc(8, t))),
      full("stts", u32(track.durations.length, ...track.durations.flatMap((d) => [1, d]))),
      ...(track.sync ? [full("stss", u32(track.sync.length, ...track.sync))] : []),
      full("stsc", u32(1, 1, 1, 1)),
      full("stsz", u32(0, track.sizes.length, ...track.sizes)),
      full("stco", u32(offsets[t]!.length, ...offsets[t]!)),
    );
    return box(
      "trak",
      header("tkhd", t + 1, 0),
      box("edts", full("elst", u32(1, 0, track.mediaTime, 0x10000))),
      box(
        "mdia",
        header("mdhd", track.timescale, duration),
        full("hdlr", u32(0), Buffer.from(track.handler), Buffer.alloc(13)),
        box("minf", stbl),
      ),
    );
  });
  const moov = box("moov", header("mvhd", 1000, 0), ...traks);
  return { file: Buffer.concat([ftyp, box("mdat", ...payload), moov]), samples };
}

const memoryRange = (file: Buffer) => async (start: number, end: number) =>
  file.subarray(start, end);

describe("buildStitchedHeader", () => {
  const video = (sizes: number[], mediaTime = 0): FakeTrack => ({
    handler: "vide",
    timescale: 15360,
    mediaTime,
    durations: sizes.map(() => 512),
    sizes,
    sync: [1],
  });
  const audio = (durations: number[], mediaTime: number): FakeTrack => ({
    handler: "soun",
    timescale: 48000,
    mediaTime,
    durations,
    sizes: durations.map((_, k) => 40 + k),
  });

  it("indexes every chunk's samples at their place after the header", async () => {
    const chunks = [
      fakeChunk(0, [video([500, 120, 130]), audio([1024, 1024, 1024, 1024], 1024)]),
      fakeChunk(1, [video([480, 110]), audio([1024, 1024, 640], 0)]),
    ];
    const layouts = await Promise.all(chunks.map((c) => readMp4Layout(memoryRange(c.file))));
    const header = buildStitchedHeader(layouts);
    const file = Buffer.concat([
      header,
      ...layouts.map((l, i) => chunks[i]!.file.subarray(l.payloadStart, l.payloadEnd)),
    ]);

    const stitched = await readMp4Layout(memoryRange(file));
    expect(stitched.payloadStart).toBe(header.length);
    expect(stitched.payloadEnd).toBe(file.length);
    const tracks = readTracks(stitched.moov);
    tracks.forEach((track, t) => {
      const read: Buffer[] = [];
      let k = 0;
      track.chunkOffsets.forEach((offset, c) => {
        for (let s = 0, at = offset; s < track.samplesPerChunk[c]!; s++) {
          read.push(file.subarray(at, at + track.sizes[k]!));
          at += track.sizes[k++]!;
        }
      });
      expect(read).toEqual(chunks.flatMap((chunk) => chunk.samples[t]!));
    });
    expect(tracks.map((track) => [track.handler, track.mediaTime])).toEqual([
      ["vide", 0],
      ["soun", 1024],
    ]);
    expect(tracks[0]!.sync).toEqual([true, false, false, true, false]);
    expect(tracks[1]!.durations).toEqual([1024, 1024, 1024, 1024, 1024, 1024, 640]);

    const moov = stitched.moov;
    const after = (type: string, from = 0) => moov.indexOf(type, from, "latin1") + 4;
    // Only audio needs an edit list (version 1): it shows its media minus the 1024-sample
    // priming, (6784 - 1024) / 48000 s = 120 ms in the 1000-tick movie timescale.
    const audioElst = after("elst");
    expect(moov.indexOf("elst", audioElst, "latin1")).toBe(-1);
    expect(audioElst).toBeGreaterThan(after("vide"));
    expect(Number(moov.readBigUInt64BE(audioElst + 8))).toBe(120);
    expect(Number(moov.readBigInt64BE(audioElst + 16))).toBe(1024);
    expect(moov.readUInt32BE(after("mdhd", audioElst) + 16)).toBe(6784);
    expect(moov.readUInt32BE(after("mvhd") + 16)).toBe(167);
  });

  it("refuses a chunk whose video starts late, as B-frames make it", async () => {
    const chunks = [fakeChunk(0, [video([500, 120])]), fakeChunk(1, [video([480, 110], 512)])];
    const layouts = await Promise.all(chunks.map((c) => readMp4Layout(memoryRange(c.file))));
    expect(() => buildStitchedHeader(layouts)).toThrow("chunk 1 video starts at media time 512");
  });
});
