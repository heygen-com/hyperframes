// Builds small font files in memory so tests need no binary fixtures.
import { mkdirSync, mkdtempSync } from "node:fs";
import { afterAll } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Points the locator's per-user font folder, on every platform, at an empty folder and returns it. */
export function fixtureFontDir(): string {
  const home = mkdtempSync(join(tmpdir(), "hf-home-"));
  const set = {
    HOME: home,
    USERPROFILE: home,
    WINDIR: join(home, "Win"),
    LOCALAPPDATA: join(home, "Local"),
  };
  const before = Object.fromEntries(Object.keys(set).map((k) => [k, process.env[k]]));
  Object.assign(process.env, set);
  afterAll(() => {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const dir =
    process.platform === "win32"
      ? join(home, "Local", "Microsoft", "Windows", "Fonts")
      : process.platform === "darwin"
        ? join(home, "Library", "Fonts")
        : join(home, ".fonts");
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface FaceSpec {
  families: string[];
  weight?: number;
  italic?: boolean;
  flavor?: "ttf" | "otf";
}

function nameTable(families: string[]): Buffer {
  const strings = families.map((f) => Buffer.from(f, "utf16le").swap16());
  const header = Buffer.alloc(6 + families.length * 12);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(families.length, 2);
  header.writeUInt16BE(header.length, 4);
  let at = 0;
  strings.forEach((s, i) => {
    const r = 6 + i * 12;
    header.writeUInt16BE(3, r);
    header.writeUInt16BE(1, r + 2);
    header.writeUInt16BE(0x409, r + 4);
    header.writeUInt16BE(i === 0 ? 1 : 16, r + 6);
    header.writeUInt16BE(s.length, r + 8);
    header.writeUInt16BE(at, r + 10);
    at += s.length;
  });
  return Buffer.concat([header, ...strings]);
}

function os2Table(weight: number, italic: boolean): Buffer {
  const t = Buffer.alloc(78);
  t.writeUInt16BE(weight, 4);
  t.writeUInt16BE(italic ? 1 : 0, 62);
  return t;
}

/** One face: its tables laid out from `base`, so a collection can place it anywhere in the file. */
function face(spec: FaceSpec, base: number): { head: Buffer; body: Buffer } {
  const tables: [string, Buffer][] = [
    ["OS/2", os2Table(spec.weight ?? 400, spec.italic ?? false)],
    ["glyf", Buffer.from("glyph-data-" + spec.families[0])],
    ["name", nameTable(spec.families)],
  ];
  const head = Buffer.alloc(12 + tables.length * 16);
  head.write(spec.flavor === "otf" ? "OTTO" : "\0\x01\0\0", 0, "latin1");
  head.writeUInt16BE(tables.length, 4);
  let at = base + head.length;
  const body: Buffer[] = [];
  tables.forEach(([tag, data], i) => {
    const r = 12 + i * 16;
    head.write(tag, r, "latin1");
    head.writeUInt32BE(0, r + 4);
    head.writeUInt32BE(at, r + 8);
    head.writeUInt32BE(data.length, r + 12);
    const padded = Buffer.alloc((data.length + 3) & ~3);
    data.copy(padded);
    body.push(padded);
    at += padded.length;
  });
  return { head, body: Buffer.concat(body) };
}

export function makeSfnt(spec: FaceSpec): Buffer {
  const { head, body } = face(spec, 0);
  return Buffer.concat([head, body]);
}

export function makeTtc(specs: FaceSpec[]): { file: Buffer; offsets: number[] } {
  let at = 12 + specs.length * 4;
  const offsets: number[] = [];
  const parts: Buffer[] = [];
  for (const spec of specs) {
    const { head, body } = face(spec, at);
    offsets.push(at);
    parts.push(head, body);
    at += head.length + body.length;
  }
  const header = Buffer.alloc(12 + specs.length * 4);
  header.write("ttcf", 0, "latin1");
  header.writeUInt32BE(0x00010000, 4);
  header.writeUInt32BE(specs.length, 8);
  offsets.forEach((o, i) => header.writeUInt32BE(o, 12 + i * 4));
  return { file: Buffer.concat([header, ...parts]), offsets };
}
