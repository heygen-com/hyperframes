import { readFileSync, writeFileSync } from "node:fs";

/** Where a RIFF chunk's bytes start and how many there are, or null when the file has none. */
export function findWavChunk(buf: Buffer, want: string): { offset: number; size: number } | null {
  if (buf.length < 12) return null;
  let pos = 12; // skip RIFF header
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === want) return { offset: pos + 8, size: Math.min(size, buf.length - pos - 8) };
    pos += 8 + size;
    if (size % 2 !== 0) pos++; // RIFF chunks are word-aligned
  }
  return null;
}

const PCM = 1;
const EXTENSIBLE = 0xfffe;

/** A prepared 16-bit mono WAV, read in JS: sherpa's readWave returns memory Electron refuses. */
export function readWav(path: string): { samples: Float32Array; sampleRate: number } {
  const buf = readFileSync(path);
  const riff = buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE";
  const fmt = riff ? findWavChunk(buf, "fmt ") : null;
  const data = fmt && findWavChunk(buf, "data");
  const format = fmt && buf.readUInt16LE(fmt.offset);
  if (
    !fmt ||
    !data ||
    (format !== PCM && format !== EXTENSIBLE) ||
    buf.readUInt16LE(fmt.offset + 2) !== 1 ||
    buf.readUInt16LE(fmt.offset + 14) !== 16
  ) {
    throw new Error(`${path} is not a 16-bit mono PCM WAV`);
  }
  const samples = new Float32Array(data.size >> 1);
  for (let i = 0; i < samples.length; i++)
    samples[i] = buf.readInt16LE(data.offset + 2 * i) / 32768;
  return { samples, sampleRate: buf.readUInt32LE(fmt.offset + 4) };
}

/** The 44-byte header of a 16-bit mono PCM WAV holding `bytes` of samples. */
export function wavHeader(bytes: number, sampleRate: number): Buffer {
  const head = Buffer.alloc(44);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(36 + bytes, 4);
  head.write("WAVEfmt ", 8, "ascii");
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(PCM, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(sampleRate, 24);
  head.writeUInt32LE(sampleRate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36, "ascii");
  head.writeUInt32LE(bytes, 40);
  return head;
}

/** `seconds` of a prepared WAV (16 kHz mono s16) from `start`, written as a WAV of its own. */
export function writeWavWindow(source: string, dest: string, start: number, seconds: number): void {
  const buf = readFileSync(source);
  const data = findWavChunk(buf, "data");
  if (!data) throw new Error(`${source} has no WAV data`);
  const from = data.offset + Math.floor(start * 16_000) * 2;
  const pcm = buf.subarray(from, Math.min(from + seconds * 32_000, data.offset + data.size));
  writeFileSync(dest, Buffer.concat([wavHeader(pcm.length, 16_000), pcm]));
}
