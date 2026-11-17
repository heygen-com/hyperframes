/**
 * Regenerate .media/index.md — the agent-readable inventory table — after a
 * figma import, exactly the way media-use does after a resolve. Both writers
 * regenerate the SAME file from the manifest's current rows (all writers'), so the
 * output format AND row selection here must stay byte-identical with
 * skills/media-use/scripts/lib/index-gen.mjs — including rendering every
 * JSON-parseable row (no shape filtering), or the file would flip-flop
 * depending on which writer ran last.
 */

import { join } from "node:path";
import { replaceFileAtomically } from "../atomicFile";
import { readJsonlValues } from "./jsonl";
import { manifestPath, mediaDir, ownMediaDir } from "./manifest";

type IndexRow = Record<string, unknown>;

function isRow(value: unknown): value is IndexRow {
  return typeof value === "object" && value !== null;
}

export function indexPath(projectDir: string): string {
  return join(mediaDir(projectDir), "index.md");
}

// One table cell: a line break in a record would start a new line of the index, so it becomes a space.
function cell(value: unknown): string {
  return String(value ?? "").replace(/\s*[\r\n]+\s*/g, " ");
}

function pad(str: unknown, len: number): string {
  return cell(str).padEnd(len);
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

export function generateIndexContent(records: IndexRow[]): string {
  const count = records.length;
  const header = `# .media · ${count} asset${count === 1 ? "" : "s"}\n`;
  if (count === 0) return header;

  const cols = { id: 4, type: 5, dur: 4, dims: 5, path: 5 };
  for (const r of records) {
    cols.id = Math.max(cols.id, cell(r.id).length);
    cols.type = Math.max(cols.type, cell(r.type).length);
    cols.dur = Math.max(cols.dur, formatDur(r).length);
    cols.dims = Math.max(cols.dims, formatDims(r).length);
    cols.path = Math.max(cols.path, cell(r.path).length);
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
        cell(r.description),
    );
  }
  return lines.join("\n") + "\n";
}

/** Rebuild index.md from every writer's rows (media-use + figma), newest record per path. */
export function regenerateIndex(projectDir: string): string {
  const rows = readJsonlValues(manifestPath(projectDir)).filter(isRow);
  const last = new Map(rows.map((row, index) => [row.path, index]));
  const records = rows.filter((row, index) => !row.path || last.get(row.path) === index);
  const content = generateIndexContent(records);
  ownMediaDir(projectDir);
  replaceFileAtomically(indexPath(projectDir), content);
  return content;
}
