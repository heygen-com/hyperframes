// The segments of a REVERSE.md: `## S01 · 0.00–2.40 s · title` headings, each with an optional
// `Pixels: rebuilt | reused | regenerated` line saying where that window's picture comes from.
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
}

const HEADING =
  /^##\s+(S\d+)\s*[·|-]\s*(\d+(?:\.\d+)?)\s*[–—-]\s*(\d+(?:\.\d+)?)\s*s\b\s*(?:[·|-]\s*(.*))?$/gm;
const SOURCES: readonly PixelSource[] = ["rebuilt", "reused", "regenerated"];
const PIXELS = /^Pixels:\s*(rebuilt|reused|regenerated)\b/im;

export function parseSegments(markdown: string): Segment[] {
  const heads = [...markdown.matchAll(HEADING)];
  return heads.map((m, i) => {
    const body = markdown.slice(m.index! + m[0].length, heads[i + 1]?.index ?? markdown.length);
    const found = PIXELS.exec(body)?.[1]?.toLowerCase();
    const pixels = SOURCES.find((source) => source === found) ?? "rebuilt";
    return {
      id: m[1]!,
      start: Number(m[2]),
      end: Number(m[3]),
      title: (m[4] ?? "").trim(),
      pixels,
    };
  });
}

export function readSegments(path: string): Segment[] {
  if (!existsSync(path))
    throw new Fix(`no segments file at ${path}`, "pass the project's REVERSE.md");
  const segments = parseSegments(readFileSync(path, "utf8"));
  if (!segments.length)
    throw new Fix(
      `${path} has no "## S01 · 0.00–2.40 s · title" segment headings`,
      "write one heading per segment, as the reverse-any-video spec shows",
    );
  return segments;
}
