import type { ProjectTimeline, TimelineRow, TimelineTrack } from "./describeProject.js";

const BAR_WIDTH = 40;
const n = (v: number) => String(Math.round(v * 1000) / 1000);

function bar(row: TimelineRow, total: number): string {
  if (total <= 0) return " ".repeat(BAR_WIDTH);
  const known = row.durationAuthored || row.duration > 0;
  const from = Math.min(BAR_WIDTH - 1, Math.floor((row.absStart / total) * BAR_WIDTH));
  const to = known ? (row.absEnd / total) * BAR_WIDTH : BAR_WIDTH;
  const width = Math.max(1, Math.min(BAR_WIDTH, Math.ceil(to)) - from);
  const fill = known ? "█" : "░";
  return " ".repeat(from) + fill.repeat(width) + " ".repeat(BAR_WIDTH - from - width);
}

/** Never "unauthored": says either the resolved length's source or why one is pending. */
function durationNote(row: TimelineRow): string | false {
  switch (row.durationSource) {
    case "media":
    case "default":
      return `duration=${row.durationSource}`;
    case "inner":
      return "duration=inferred";
    case "pending":
      return `pending: ${row.pendingReason}`;
    case "authored":
    case null:
      return false;
  }
}

function details(row: TimelineRow): string {
  const lanes = row.lanes.map(
    (l) => `${l.target}[${l.points.map((p) => `${n(p.t)}:${n(p.v)}`).join(" ")}]`,
  );
  return [
    row.src && `src=${row.src}`,
    row.volume !== null && `vol=${row.volume}`,
    row.playbackRate !== null && `rate=${n(row.playbackRate)}`,
    row.audioGroup && `group=${row.audioGroup}`,
    durationNote(row),
    row.sourceFile && !row.children.length && "children=unread",
    row.laneError && `lanes unreadable: ${row.laneError}`,
    ...lanes,
  ]
    .filter(Boolean)
    .join(" ");
}

const span = (a: number, b: number) => `${n(a)}-${n(b)}s`;

function line(row: TimelineRow, total: number): string {
  const times = row.host
    ? `${span(row.absStart, row.absEnd)} (local ${span(row.start, row.end)}) nested in ${row.host} ${row.file}`
    : span(row.start, row.end);
  return `  |${bar(row, total)}| ${row.id} ${times} ${details(row)}`.trimEnd();
}

function header({ kind, rows }: TimelineTrack): string {
  const nested = rows.filter((r) => r.nested).length;
  const split = nested ? `: ${rows.length - nested} top-level, ${nested} nested` : "";
  return `${kind} (${rows.length}${split})`;
}

export function formatTimeline(timeline: ProjectTimeline): string {
  const out = [`timeline ${n(timeline.duration)}s`];
  for (const track of timeline.tracks) {
    out.push("", header(track));
    for (const row of track.rows) out.push(line(row, timeline.duration));
  }
  return out.join("\n");
}
