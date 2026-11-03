/** Whether a file's first bytes are the container its extension claims, for the types the asset API takes as-is. */
export function bytesMatchExtension(ext: string, head: Buffer): boolean {
  const at = (offset: number, text: string) =>
    head.toString("latin1", offset, offset + text.length) === text;
  switch (ext) {
    case ".mp3":
      return at(0, "ID3") || (head[0] === 0xff && ((head[1] ?? 0) & 0xe6) === 0xe2);
    case ".wav":
      return at(0, "RIFF") && at(8, "WAVE");
    case ".webp":
      return at(0, "RIFF") && at(8, "WEBP");
    case ".png":
      return head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    case ".jpg":
    case ".jpeg":
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case ".webm":
      return head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    case ".mov":
      return ["ftyp", "moov", "mdat", "wide", "free"].some((box) => at(4, box));
    case ".mp4":
    case ".m4v":
      // An audio-only M4A/M4B brand is not a video the API stores as video/mp4.
      return at(4, "ftyp") && !at(8, "M4A ") && !at(8, "M4B ") && !at(8, "M4P ");
    default:
      return false;
  }
}
