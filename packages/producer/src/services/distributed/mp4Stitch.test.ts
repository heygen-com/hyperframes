import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildStitchedHeader, readMp4Layout, readTracks, writeStitchedMp4 } from "./mp4Stitch.js";

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
  codec?: string;
}

/** A chunk file shaped like ffmpeg's: ftyp, mdat with samples interleaved one per mp4 chunk, moov
 * (or the moov first, as a faststart file has it). */
function fakeChunk(
  tag: number,
  tracks: FakeTrack[],
  moovFirst = false,
): { file: Buffer; samples: Buffer[][] } {
  const samples = tracks.map((track, t) =>
    track.sizes.map((size, k) => Buffer.alloc(size, (tag * 61 + t * 17 + k * 5 + 1) & 255)),
  );
  const ftyp = box("ftyp", Buffer.from("isom\0\0\x02\0isom", "latin1"));
  const moovAt = (payloadAt: number) => {
    const offsets = tracks.map(() => [] as number[]);
    const payload: Buffer[] = [];
    let at = payloadAt;
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
      const entry = track.codec ?? (track.handler === "vide" ? "avc1" : "mp4a");
      const stbl = box(
        "stbl",
        full("stsd", u32(1), box(entry, Buffer.alloc(8, t))),
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
    return { moov: box("moov", header("mvhd", 1000, 0), ...traks), mdat: box("mdat", ...payload) };
  };
  if (!moovFirst) {
    const { moov, mdat } = moovAt(ftyp.length + 8);
    return { file: Buffer.concat([ftyp, mdat, moov]), samples };
  }
  // The moov's size does not depend on the offsets it holds.
  const { moov, mdat } = moovAt(ftyp.length + moovAt(0).moov.length + 8);
  return { file: Buffer.concat([ftyp, moov, mdat]), samples };
}

const memoryRange = (file: Buffer) => async (start: number, end: number) =>
  file.subarray(start, end);

/** Every sample of `track`, read from `file` where its tables place it. */
function samplesOf(file: Buffer, track: ReturnType<typeof readTracks>[number]): Buffer[] {
  const read: Buffer[] = [];
  let k = 0;
  track.chunkOffsets.forEach((offset, c) => {
    for (let s = 0, at = offset; s < track.samplesPerChunk[c]!; s++) {
      read.push(file.subarray(at, at + track.sizes[k]!));
      at += track.sizes[k++]!;
    }
  });
  return read;
}

/** The stitched file: the header, then `audio`'s and each chunk's mdat payload in order. */
async function stitchInMemory(files: Buffer[], audio?: Buffer): Promise<Buffer> {
  const sources = audio ? [audio, ...files] : files;
  const layouts = await Promise.all(sources.map((file) => readMp4Layout(memoryRange(file))));
  return Buffer.concat([
    audio ? buildStitchedHeader(layouts.slice(1), layouts[0]) : buildStitchedHeader(layouts),
    ...layouts.map((l, i) => sources[i]!.subarray(l.payloadStart, l.payloadEnd)),
  ]);
}

/** A track's tkhd track_ID (version 0, as fakeChunk writes it). */
const trackIdOf = (moov: Buffer, track: ReturnType<typeof readTracks>[number]) =>
  moov.readUInt32BE(track.trak.bodyStart + 8 + 12);

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
      expect(samplesOf(file, track)).toEqual(chunks.flatMap((chunk) => chunk.samples[t]!));
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

  // A tail shorter than one AAC packet owns no packet (the one before it spans the boundary), so
  // its chunk is muxed video-only; the plan's audio track still holds every packet once.
  it("keeps the plan's audio when a chunk owns no audio packets", async () => {
    const chunks = [
      fakeChunk(0, [video([500, 120, 130]), audio([1024, 1024, 1024, 640], 1024)]),
      fakeChunk(1, [video([90])]),
    ];
    const file = await stitchInMemory(chunks.map((chunk) => chunk.file));
    const tracks = readTracks((await readMp4Layout(memoryRange(file))).moov);
    expect(tracks.map((track) => [track.handler, track.mediaTime])).toEqual([
      ["vide", 0],
      ["soun", 1024],
    ]);
    expect(samplesOf(file, tracks[0]!)).toEqual([
      ...chunks[0]!.samples[0]!,
      ...chunks[1]!.samples[0]!,
    ]);
    expect(samplesOf(file, tracks[1]!)).toEqual(chunks[0]!.samples[1]!);
    expect(tracks[1]!.durations).toEqual([1024, 1024, 1024, 640]);
  });

  it("puts a separate audio file's track and payload before every chunk's", async () => {
    const chunks = [fakeChunk(0, [video([500, 120])]), fakeChunk(1, [video([90])])];
    const mix = fakeChunk(2, [audio([1024, 1024, 640], 1024)]);
    const file = await stitchInMemory(
      chunks.map((chunk) => chunk.file),
      mix.file,
    );
    const { moov } = await readMp4Layout(memoryRange(file));
    const tracks = readTracks(moov);
    expect(tracks.map((track) => [track.handler, track.mediaTime])).toEqual([
      ["vide", 0],
      ["soun", 1024],
    ]);
    expect(tracks.map((track) => trackIdOf(moov, track))).toEqual([1, 2]);
    expect(samplesOf(file, tracks[0]!)).toEqual([
      ...chunks[0]!.samples[0]!,
      ...chunks[1]!.samples[0]!,
    ]);
    expect(samplesOf(file, tracks[1]!)).toEqual(mix.samples[0]!);
    expect(tracks[1]!.durations).toEqual([1024, 1024, 640]);
    expect(Math.max(...tracks[1]!.chunkOffsets)).toBeLessThan(Math.min(...tracks[0]!.chunkOffsets));
  });

  it.each([0, 1])(
    "refuses chunk %i carrying audio when the audio is a separate file",
    async (carrier) => {
      const chunk = (i: number) =>
        fakeChunk(i, i === carrier ? [video([500]), audio([1024], 0)] : [video([500])]);
      const layouts = await Promise.all(
        [chunk(0), chunk(1)].map((c) => readMp4Layout(memoryRange(c.file))),
      );
      const mix = await readMp4Layout(memoryRange(fakeChunk(2, [audio([1024], 1024)]).file));
      expect(() => buildStitchedHeader(layouts, mix)).toThrow(
        `chunk ${carrier} carries its own audio`,
      );
    },
  );

  it.each([
    [
      "an audio codec chunk 0 does not use",
      [video([500]), audio([1024], 1024)],
      [video([90]), { ...audio([1024], 0), codec: "Opus" }],
    ],
    ["no video", [video([500]), audio([1024], 1024)], [audio([1024], 0)]],
    ["audio chunk 0 does not carry", [video([500])], [video([90]), audio([1024], 0)]],
  ] as const)("refuses a chunk with %s", async (_, first, second) => {
    const layouts = await Promise.all(
      [fakeChunk(0, [...first]), fakeChunk(1, [...second])].map((c) =>
        readMp4Layout(memoryRange(c.file)),
      ),
    );
    expect(() => buildStitchedHeader(layouts)).toThrow("chunk 1 tracks differ from chunk 0");
  });
});

describe("writeStitchedMp4", () => {
  const video = (sizes: number[], mediaTime = 0): FakeTrack => ({
    handler: "vide",
    timescale: 15360,
    mediaTime,
    durations: sizes.map(() => 512),
    sizes,
    sync: [1],
  });
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-mp4-stitch-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const write = (name: string, file: Buffer) => {
    writeFileSync(join(dir, name), file);
    return join(dir, name);
  };

  it("writes the header and every payload, replacing an earlier output", async () => {
    const files = [fakeChunk(0, [video([500, 120])]).file, fakeChunk(1, [video([480])]).file];
    const output = write("out.mp4", Buffer.from("stale"));
    await writeStitchedMp4([write("a.mp4", files[0]!), write("b.mp4", files[1]!)], output);
    expect(readFileSync(output).equals(await stitchInMemory(files))).toBe(true);
    expect(readdirSync(dir).sort()).toEqual(["a.mp4", "b.mp4", "out.mp4"]);
  });

  it("writes a separate audio file's payload right after the header", async () => {
    const files = [fakeChunk(0, [video([500, 120])]).file, fakeChunk(1, [video([480])]).file];
    const mix = fakeChunk(2, [
      {
        handler: "soun",
        timescale: 48000,
        mediaTime: 1024,
        durations: [1024, 640],
        sizes: [40, 41],
      },
    ]).file;
    const output = join(dir, "out.mp4");
    await writeStitchedMp4(
      [write("a.mp4", files[0]!), write("b.mp4", files[1]!)],
      output,
      write("audio.m4a", mix),
    );
    expect(readFileSync(output).equals(await stitchInMemory(files, mix))).toBe(true);
  });

  it("opens no output for chunks it refuses", async () => {
    const paths = [
      write("a.mp4", fakeChunk(0, [video([500])]).file),
      write("b.mp4", fakeChunk(1, [video([480], 512)]).file),
    ];
    await expect(writeStitchedMp4(paths, join(dir, "out.mp4"))).rejects.toThrow(
      "chunk 1 video starts at media time 512",
    );
    expect(readdirSync(dir).sort()).toEqual(["a.mp4", "b.mp4"]);
  });

  it("fails a chunk whose mdat is cut short mid-copy and leaves no output", async () => {
    const whole = fakeChunk(1, [video([480, 300])], true).file;
    const paths = [
      write("a.mp4", fakeChunk(0, [video([500])]).file),
      write("b.mp4", whole.subarray(0, whole.length - 200)),
    ];
    await expect(writeStitchedMp4(paths, join(dir, "out.mp4"))).rejects.toThrow(
      "chunk 1 mdat holds 580 of 780 payload bytes",
    );
    expect(readdirSync(dir).sort()).toEqual(["a.mp4", "b.mp4"]);
  });
});
