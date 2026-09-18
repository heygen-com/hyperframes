import type { ProjectTimeline, TimelineRow } from "./describeProject.js";

const BAR_WIDTH = 40;
const n = (v: number) => String(Math.round(v * 100) / 100);

function bar(row: TimelineRow, total: number): string {
  if (total <= 0) return " ".repeat(BAR_WIDTH);
  const from = Math.min(BAR_WIDTH - 1, Math.floor((row.start / total) * BAR_WIDTH));
  const to = row.durationAuthored || row.duration > 0 ? (row.end / total) * BAR_WIDTH : BAR_WIDTH;
  const width = Math.max(1, Math.min(BAR_WIDTH, Math.ceil(to)) - from);
  const fill = row.durationAuthored || row.duration > 0 ? "█" : "░";
  return " ".repeat(from) + fill.repeat(width) + " ".repeat(BAR_WIDTH - from - width);
}

function details(row: TimelineRow): string {
  const lanes = row.lanes.map(
    (l) => `${l.target}[${l.points.map((p) => `${n(p.t)}:${n(p.v)}`).join(" ")}]`,
  );
  return [
    row.src && `src=${row.src}`,
    row.volume !== null && `vol=${n(row.volume)}`,
    row.playbackRate !== null && `rate=${n(row.playbackRate)}`,
    row.audioGroup && `group=${row.audioGroup}`,
    !row.durationAuthored && "duration=unauthored",
    ...lanes,
  ]
    .filter(Boolean)
    .join(" ");
}

function line(row: TimelineRow, total: number, indent: string): string {
  const times = `${n(row.start)}-${n(row.end)}s`;
  return `${indent}|${bar(row, total)}| ${row.id} ${times} ${details(row)}`.trimEnd();
}

export function formatTimeline(timeline: ProjectTimeline): string {
  const out = [`timeline ${n(timeline.duration)}s`];
  for (const track of timeline.tracks) {
    out.push("", `${track.kind} (${track.rows.length})`);
    for (const row of track.rows) {
      out.push(line(row, timeline.duration, "  "));
      for (const child of row.children)
        out.push(line(child, row.duration || timeline.duration, "    "));
    }
  }
  return out.join("\n");
}
