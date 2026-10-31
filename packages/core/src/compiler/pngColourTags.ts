const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_SIGNATURE_BYTES = PNG_SIGNATURE.length;
const CHUNK_OVERHEAD_BYTES = 12;
const REMOVED_CHUNKS = new Set(["cICP", "gAMA", "cHRM"]);
const HDR_CICP_TRANSFERS = new Set([16, 18]);

/** An SDR PNG's copy without the tags that make Chrome re-map its pixels; null if none apply or it is HDR. */
export function stripSdrPngColourTags(png: Uint8Array): Buffer | null {
  const bytes = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (!bytes.subarray(0, PNG_SIGNATURE_BYTES).equals(PNG_SIGNATURE)) return null;
  const kept: Buffer[] = [bytes.subarray(0, PNG_SIGNATURE_BYTES)];
  let removed = false;
  for (let at = PNG_SIGNATURE_BYTES; at + CHUNK_OVERHEAD_BYTES <= bytes.length; ) {
    const end = at + CHUNK_OVERHEAD_BYTES + bytes.readUInt32BE(at);
    if (end > bytes.length) return null;
    const type = bytes.toString("latin1", at + 4, at + 8);
    if (type === "cICP" && HDR_CICP_TRANSFERS.has(bytes[at + 9] ?? 0)) return null;
    if (REMOVED_CHUNKS.has(type)) removed = true;
    else kept.push(bytes.subarray(at, end));
    at = end;
  }
  return removed ? Buffer.concat(kept) : null;
}
