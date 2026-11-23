// A segments file: `## S01 · 0.00–2.40 s · title` headings, each with optional lines
// `Pixels: rebuilt | reused | regenerated`, `Regenerated: x, y, w, h` (source pixels, or shares of the frame when
// all are ≤ 1), `Drawn: x, y, w, h` with an optional `a–b s`, and `Copy:` quoting a string; see `Segment`.
import { existsSync, readFileSync } from "node:fs";
import { Fix } from "./media.js";

/** rebuilt: drawn in HTML; reused: cut from the original; regenerated: new media made for it. */
export type PixelSource = "rebuilt" | "reused" | "regenerated";

export interface Segment {
  id: string;
  start: number;
  end: number;
  title: string;
  pixels: PixelSource;
  /** A regenerated region inside a rebuilt or reused segment: [x, y, w, h], pixels or shares of the frame. */
  regenerated?: [number, number, number, number];
  /** Drawn elements over a regenerated person: their boxes, judged by pixels, and when they show. */
  drawn?: { box: [number, number, number, number]; window?: [number, number] }[];
  /** The segment quotes copy: it has drawn text. */
  copy?: true;
}

const HEADING =
  /^##\s+(S\d+)\s*[·|-]\s*(\d+(?:\.\d+)?)\s*[–—-]\s*(\d+(?:\.\d+)?)\s*s\b\s*(?:[·|-]\s*(.*))?$/gm;
const SOURCES: readonly PixelSource[] = ["rebuilt", "reused", "regenerated"];
const PIXELS = /^Pixels:\s*(rebuilt|reused|regenerated)\b/im;
const NUMBER = String.raw`(\d+(?:\.\d+)?)`;
const SEP = String.raw`(?:\s*,\s*|\s+)`;
const DRAWN = new RegExp(
  `^Drawn:\\s*${NUMBER}${SEP}${NUMBER}${SEP}${NUMBER}${SEP}${NUMBER}(?:.*?${NUMBER}\\s*[–—-]\\s*${NUMBER}\\s*s\\b)?`,
  "gim",
);
const COPY = /^Copy:.*["“”]\S/im;
const REGION =
  /^Regenerated:\s*(\d+(?:\.\d+)?)(?:\s*,\s*|\s+)(\d+(?:\.\d+)?)(?:\s*,\s*|\s+)(\d+(?:\.\d+)?)(?:\s*,\s*|\s+)(\d+(?:\.\d+)?)/im;

export function parseSegments(markdown: string): Segment[] {
  const heads = [...markdown.matchAll(HEADING)];
  // fallow-ignore-next-line complexity
  return heads.map((m, i) => {
    const body = markdown.slice(m.index! + m[0].length, heads[i + 1]?.index ?? markdown.length);
    const found = PIXELS.exec(body)?.[1]?.toLowerCase();
    const pixels = SOURCES.find((source) => source === found) ?? "rebuilt";
    const r = REGION.exec(body);
    const region: Segment["regenerated"] = r
      ? [Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4])]
      : undefined;
    const drawn = [...body.matchAll(DRAWN)].flatMap((d) => {
      const box: [number, number, number, number] = [
        Number(d[1]),
        Number(d[2]),
        Number(d[3]),
        Number(d[4]),
      ];
      if (box[2] <= 0 || box[3] <= 0) return [];
      return [d[5] ? { box, window: [Number(d[5]), Number(d[6])] as [number, number] } : { box }];
    });
    return {
      id: m[1]!,
      start: Number(m[2]),
      end: Number(m[3]),
      title: (m[4] ?? "").trim(),
      pixels,
      ...(region && pixels !== "regenerated" && region[2]! > 0 && region[3]! > 0
        ? { regenerated: region }
        : {}),
      ...(drawn.length ? { drawn } : {}),
      ...(COPY.test(body) ? { copy: true as const } : {}),
    };
  });
}

export function readSegments(path: string): Segment[] {
  if (!existsSync(path))
    throw new Fix(`no segments file at ${path}`, "pass a file of `## S01 · a–b s` segments");
  const segments = parseSegments(readFileSync(path, "utf8"));
  if (!segments.length)
    throw new Fix(
      `${path} has no "## S01 · 0.00–2.40 s · title" segment headings`,
      "write one `## S01 · a–b s · title` heading per segment",
    );
  return segments;
}
