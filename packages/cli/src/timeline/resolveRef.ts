import type { SourceMutationTarget } from "@hyperframes/studio-server";
import type { ProjectTimeline, TimelineRow } from "./describeProject.js";

export type RefResolution =
  | { ok: true; row: TimelineRow; target: SourceMutationTarget }
  | { ok: false; reason: string; fix: string };

function targetFor(row: TimelineRow): SourceMutationTarget | null {
  if (row.ref.startsWith("#")) return { id: row.ref.slice(1) };
  if (row.ref.startsWith("hf:")) return { hfId: row.ref.slice(3) };
  return row.id && row.id !== row.kind ? { id: row.id } : null;
}

export function resolveRef(timeline: ProjectTimeline, ref: string): RefResolution {
  const rows = timeline.tracks.flatMap((track) => track.rows);
  const matches = ref.startsWith("#")
    ? rows.filter((row) => row.ref === ref || row.id === ref.slice(1))
    : ref.startsWith("hf:")
      ? rows.filter((row) => row.ref === ref)
      : (() => {
          const match = /^(video|graphics|captions|audio)\/(\d+)$/.exec(ref);
          if (!match) return [];
          const row = timeline.tracks
            .find((track) => track.kind === match[1])
            ?.rows.find((candidate) => candidate.index === Number(match[2]));
          return row ? [row] : [];
        })();
  if (matches.length !== 1) {
    return {
      ok: false,
      reason:
        matches.length === 0 ? `${ref} was not found` : `${ref} matches ${matches.length} rows`,
      fix: "add id=\"<name>\" to the element in its source file, then retry with #<name>",
    };
  }
  const row = matches[0]!;
  const target = targetFor(row);
  if (!target) {
    return {
      ok: false,
      reason: `${ref} has no stable element id in ${row.file}`,
      fix: `add id=\"<name>\" to the element in ${row.file}, then retry with #<name>`,
    };
  }
  return { ok: true, row, target };
}
