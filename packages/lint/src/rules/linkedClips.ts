import type { LintContext, HyperframeLintFinding, OpenTag } from "../context";
import { readAttr, truncateSnippet } from "../utils";

const SYNC_TOLERANCE_S = 1e-3;

const LINKED_TIMING_FIELDS: ReadonlyArray<{ field: string; attrs: string[]; fallback: number }> = [
  { field: "start", attrs: ["data-start"], fallback: 0 },
  { field: "duration", attrs: ["data-duration"], fallback: 0 },
  { field: "media-start", attrs: ["data-media-start", "data-playback-start"], fallback: 0 },
  { field: "playback-rate", attrs: ["data-playback-rate"], fallback: 1 },
];

function readTimingField(tag: OpenTag, attrs: string[], fallback: number): number {
  for (const attr of attrs) {
    const raw = readAttr(tag.raw, attr);
    if (raw === null || raw.trim() === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

function driftingFields(members: readonly OpenTag[]): string[] {
  return LINKED_TIMING_FIELDS.filter(({ attrs, fallback }) => {
    const values = members.map((tag) => readTimingField(tag, attrs, fallback));
    const first = values[0] ?? fallback;
    return values.some((value) => Math.abs(value - first) > SYNC_TOLERANCE_S);
  }).map(({ field }) => field);
}

function compositionScopeOf(tag: OpenTag, compositions: readonly OpenTag[]): number {
  let scope = -1;
  for (const composition of compositions) {
    const end = composition.endIndex ?? composition.closeIndex ?? Number.POSITIVE_INFINITY;
    const encloses = composition.index < tag.index && tag.index < end;
    if (composition !== tag && encloses && composition.index > scope) scope = composition.index;
  }
  return scope;
}

function groupByLink(tags: readonly OpenTag[]): Map<string, { link: string; members: OpenTag[] }> {
  const compositions = tags.filter((tag) =>
    ["data-composition-id", "data-composition-file"].some(
      (name) => readAttr(tag.raw, name) !== null,
    ),
  );
  const groups = new Map<string, { link: string; members: OpenTag[] }>();
  for (const tag of tags) {
    const link = readAttr(tag.raw, "data-link");
    if (!link) continue;
    const key = `${compositionScopeOf(tag, compositions)}\u0000${link}`;
    const group = groups.get(key) ?? { link, members: [] };
    group.members.push(tag);
    groups.set(key, group);
  }
  return groups;
}

const memberLabel = (tag: OpenTag) => {
  const id = readAttr(tag.raw, "id");
  return id ? `#${id}` : `<${tag.name}>`;
};

export function findLinkedClipFindings(ctx: LintContext): HyperframeLintFinding[] {
  const findings: HyperframeLintFinding[] = [];
  for (const { link, members } of groupByLink(ctx.tags).values()) {
    const first = members[0];
    if (!first) continue;
    const elementId = readAttr(first.raw, "id") || undefined;
    if (members.length === 1) {
      findings.push({
        code: "linked_clip_orphan",
        severity: "warning",
        message: `${memberLabel(first)} is the only clip with data-link="${link}"; its linked partner is gone.`,
        elementId,
        fixHint: `Remove data-link="${link}" from ${memberLabel(first)}, or restore the partner clip.`,
        snippet: truncateSnippet(first.raw),
      });
      continue;
    }
    const drift = driftingFields(members);
    if (drift.length === 0) continue;
    findings.push({
      code: "linked_clips_out_of_sync",
      severity: "warning",
      message: `Linked clips ${members.map(memberLabel).join(", ")} (data-link="${link}") differ in ${drift.join(", ")}.`,
      elementId,
      fixHint:
        "Linked clips are edited as one: give every member the same data-start, data-duration, data-media-start and data-playback-rate, or remove data-link from all of them to unlink.",
      snippet: truncateSnippet(first.raw),
    });
  }
  return findings;
}
