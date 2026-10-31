// fallow-ignore-file complexity
interface Box {
  type: string;
  start: number;
  end: number;
}

function* boxes(buf: Buffer, start: number, end: number): Generator<Box> {
  let at = start;
  while (at + 8 <= end) {
    let size = buf.readUInt32BE(at);
    let header = 8;
    if (size === 1 && at + 16 <= end) {
      size = Number(buf.readBigUInt64BE(at + 8));
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) return;
    yield { type: buf.toString("latin1", at + 4, at + 8), start: at + header, end: at + size };
    at += size;
  }
}

function child(buf: Buffer, parent: Box, type: string, skip = 0): Box[] {
  return [...boxes(buf, parent.start + skip, parent.end)].filter((box) => box.type === type);
}

/** Counter-clockwise degrees of the primary item's `irot` property; 0 when none or unreadable. */
export function readHeifPrimaryRotation(buf: Buffer): 0 | 90 | 180 | 270 {
  try {
    const root: Box = { type: "", start: 0, end: buf.length };
    const meta = child(buf, root, "meta")[0];
    const pitm = meta && child(buf, meta, "pitm", 4)[0];
    const iprp = meta && child(buf, meta, "iprp", 4)[0];
    const ipco = iprp && child(buf, iprp, "ipco")[0];
    if (!pitm || !ipco || !iprp) return 0;
    const primaryId =
      buf[pitm.start] === 0 ? buf.readUInt16BE(pitm.start + 4) : buf.readUInt32BE(pitm.start + 4);
    const props = [...boxes(buf, ipco.start, ipco.end)];
    for (const ipma of child(buf, iprp, "ipma")) {
      const version = buf[ipma.start]!;
      const wide = (buf[ipma.start + 3]! & 1) === 1;
      let at = ipma.start + 8;
      for (let n = buf.readUInt32BE(ipma.start + 4); n > 0 && at < ipma.end; n--) {
        const id = version < 1 ? buf.readUInt16BE(at) : buf.readUInt32BE(at);
        at += version < 1 ? 2 : 4;
        const count = buf[at++]!;
        for (let i = 0; i < count; i++) {
          const index = wide ? buf.readUInt16BE(at) & 0x7fff : buf[at]! & 0x7f;
          at += wide ? 2 : 1;
          const prop = props[index - 1];
          if (id === primaryId && prop?.type === "irot")
            return ((buf[prop.start]! & 3) * 90) as 0 | 90 | 180 | 270;
        }
      }
    }
  } catch {
    // unreadable boxes: treat as unrotated
  }
  return 0;
}
