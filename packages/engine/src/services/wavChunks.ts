/**
 * The RIFF chunk walk, which two WAV readers in this directory each had a copy
 * of: `audioFxRender`'s `readWavChunks` and `audioVolumeEnvelope`'s
 * `parseWavLayout`.
 *
 * Only the walk is shared. What the two do with the chunks is genuinely
 * different — one wants a slice of the payload and lets the decoder judge the
 * format, the other wants offsets to edit in place and refuses anything that is
 * not 16-bit PCM — and folding those together would mean picking one behaviour
 * for each difference, in the parser every render's audio passes through. So
 * this yields chunks and holds no policy at all.
 */

export interface RiffChunk {
  /** Four ASCII characters: `fmt `, `data`, `LIST`, `fact`, … */
  id: string;
  /** Byte offset of the chunk's body, past the 8-byte header. */
  body: number;
  /** The size the chunk declares. May run past the end of a truncated file. */
  size: number;
}

/**
 * Every chunk after the 12-byte RIFF header, in the order they sit.
 *
 * Advances by each chunk's declared size, so ordering is not assumed — `data`
 * may precede `fmt `, and trailing LIST/fact chunks are walked past rather than
 * tripped over. Chunks are word-aligned, so an odd size carries a pad byte.
 */
export function* riffChunks(buffer: Buffer): Generator<RiffChunk> {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    yield { id, body: offset + 8, size };
    offset += 8 + size + (size % 2);
  }
}
