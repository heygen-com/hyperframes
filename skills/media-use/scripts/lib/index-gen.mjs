import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { readManifest, indexPath } from "./manifest.mjs";

function pad(str, len) {
  return String(str ?? "").padEnd(len);
}

function formatDur(record) {
  if (record.duration == null) return "—";
  return `${record.duration}s`;
}

function formatDims(record) {
  if (record.width && record.height) return `${record.width}×${record.height}`;
  if (record.type === "icon" && record.transparent) return "svg";
  return "—";
}

export function generateIndexContent(records) {
  const count = records.length;
  const header = `# .media · ${count} asset${count === 1 ? "" : "s"}\n`;
  if (count === 0) return header;

  const cols = { id: 4, type: 5, dur: 4, dims: 5, path: 5, desc: 11 };
  for (const r of records) {
    cols.id = Math.max(cols.id, (r.id ?? "").length);
    cols.type = Math.max(cols.type, (r.type ?? "").length);
    cols.dur = Math.max(cols.dur, formatDur(r).length);
    cols.dims = Math.max(cols.dims, formatDims(r).length);
    cols.path = Math.max(cols.path, (r.path ?? "").length);
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
        (r.description ?? ""),
    );
  }
  return lines.join("\n") + "\n";
}

export function regenerateIndex(projectDir) {
  const records = readManifest(projectDir);
  const content = generateIndexContent(records);
  const p = indexPath(projectDir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  return content;
}
