/**
 * Regenerate .media/index.md — the agent-readable inventory table — after a
 * figma import, exactly the way media-use does after a resolve. Both writers
 * regenerate the SAME file from the full manifest (all writers' rows), so the
 * output format AND row selection here must stay byte-identical with
 * skills/media-use/scripts/lib/index-gen.mjs — including rendering every
 * JSON-parseable row (no shape filtering), or the file would flip-flop
 * depending on which writer ran last.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readJsonlValues } from "./jsonl";
import { manifestPath, mediaDir } from "./manifest";

type IndexRow = Record<string, unknown>;

function isRow(value: unknown): value is IndexRow {
  return typeof value === "object" && value !== null;
}

export function indexPath(projectDir: string): string {
  return join(mediaDir(projectDir), "index.md");
}

function pad(str: unknown, len: number): string {
  return String(str ?? "").padEnd(len);
}

function formatDur(r: IndexRow): string {
  if (r.duration == null) return "—";
  return `${String(r.duration)}s`;
}

function formatDims(r: IndexRow): string {
  if (r.width && r.height) return `${String(r.width)}×${String(r.height)}`;
  if (r.type === "icon" && r.transparent) return "svg";
  return "—";
}

function len(value: unknown): number {
  return String(value ?? "").length;
}

export function generateIndexContent(records: IndexRow[]): string {
  const count = records.length;
  const header = `# .media · ${count} asset${count === 1 ? "" : "s"}\n`;
  if (count === 0) return header;

  const cols = { id: 4, type: 5, dur: 4, dims: 5, path: 5 };
  for (const r of records) {
    cols.id = Math.max(cols.id, len(r.id));
    cols.type = Math.max(cols.type, len(r.type));
    cols.dur = Math.max(cols.dur, formatDur(r).length);
    cols.dims = Math.max(cols.dims, formatDims(r).length);
    cols.path = Math.max(cols.path, len(r.path));
  }

  const heading =
    pad("id", cols.id + 2) +
    pad("type", cols.type + 2) +
    pad("dur", cols.dur + 2) +
    pad("dims", cols.dims + 2) +
    pad("path", cols.path + 2) +
    "description";

  const lines = [header, heading];
  for (const r of records) {
    lines.push(
      pad(r.id, cols.id + 2) +
        pad(r.type, cols.type + 2) +
        pad(formatDur(r), cols.dur + 2) +
        pad(formatDims(r), cols.dims + 2) +
        pad(r.path, cols.path + 2) +
        String(r.description ?? ""),
    );
  }
  return lines.join("\n") + "\n";
}

/** Rebuild index.md from EVERY writer's manifest rows (media-use + figma). */
export function regenerateIndex(projectDir: string): string {
  const records = readJsonlValues(manifestPath(projectDir)).filter(isRow);
  const content = generateIndexContent(records);
  const p = indexPath(projectDir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  return content;
}
