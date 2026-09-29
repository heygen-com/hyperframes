/** Check JPEG headers before image2pipe; entropy-coded pixels still belong to FFmpeg. */
export function jpegInputError(buffer: Buffer): string | undefined {
  if (buffer.length === 0) return "empty frame";
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return "missing JPEG SOI marker";
  let offset = 2;
  while (offset < buffer.length) {
    const segment = readSegment(buffer, offset);
    if (typeof segment === "string") return segment;
    const { marker, start, end } = segment;
    if (marker === 0xdb) {
      const error = quantizationTableError(buffer, start, end);
      if (error) return error;
    }
    // Do not scan compressed pixel data as markers (byte stuffing/restarts).
    if (marker === 0xda) return undefined;
    offset = end;
  }
  return "missing JPEG scan";
}

function readSegment(
  buffer: Buffer,
  offset: number,
): { marker: number; start: number; end: number } | string {
  if (buffer[offset++] !== 0xff) return "invalid JPEG marker";
  while (buffer[offset] === 0xff) offset++;
  const marker = buffer[offset++];
  if (marker === undefined) return "truncated JPEG marker";
  if (marker === 0x01) return { marker, start: offset, end: offset };
  if (offset + 2 > buffer.length) return "truncated JPEG segment length";
  const length = buffer.readUInt16BE(offset);
  const end = offset + length;
  if (length < 2 || end > buffer.length) return "invalid JPEG segment length";
  return { marker, start: offset + 2, end };
}

function quantizationTableError(buffer: Buffer, start: number, end: number): string | undefined {
  if (start === end) return "empty JPEG DQT segment";
  let offset = start;
  while (offset < end) {
    const descriptor = buffer[offset++];
    if (descriptor === undefined) return "truncated JPEG DQT descriptor";
    const precision = descriptor >> 4;
    if (precision > 1) return `invalid JPEG DQT precision ${precision}`;
    if ((descriptor & 0x0f) > 3) return "invalid JPEG DQT table id";
    offset += precision === 0 ? 64 : 128;
    if (offset > end) return "truncated JPEG DQT table";
  }
  return undefined;
}
