import { currentRecords, indexPath, ownMediaDir, replaceFile } from "./manifest.mjs";
import { terminalText } from "./terminal-text.mjs";

const LINE_BREAKS = /\s*[\r\n\v\f\u0085\u2028\u2029]+\s*/g;

function cell(value) {
  return terminalText(String(value ?? "").replace(LINE_BREAKS, " "));
}

function pad(str, len) {
  return cell(str).padEnd(len);
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

export function regenerateIndex(projectDir) {
  const records = currentRecords(projectDir);
  const content = generateIndexContent(records);
  ownMediaDir(projectDir);
  replaceFile(indexPath(projectDir), content);
  return content;
}
