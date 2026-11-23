import type { AnimationValues, DeclaredValue } from "../../core/src/runtime/timelineValues";
import type { TimelineEvent, TimelineRequest } from "../../core/src/runtime/timelineInspection";
import type { PageTimeline } from "./pageQueries";
import type { Sources } from "./sources";

type SourceMap = ReturnType<Sources["mapper"]>;
type Labeler = (ref: string) => string;

const GROUPS_PER_PAGE = 60;
const FOLLOWING_SHOWN = 16;
const MEMBERS_SHOWN = 8;
const RELATIONS_SHOWN = 8;
const COVERAGE_NOTE =
  "Observed DOM-target GSAP and explicit HF items only; callbacks/object tweens/unexecuted code are not inspected. Scheduled intervals do not establish visibility; no visual verification. at/range are half-open; boundary includes exact endpoints. No seek performed.";
const BOUNDARY_NOTE =
  "only actions crossing, starting, ending or instantaneous here. Later stagger members are excluded, not absent. Group spans do not imply simultaneous starts. Target labels T1, T2, ... identify the same element within this response, not DOM order.";

export interface TimelineReport {
  text: string;
  generation: string;
  reused: boolean;
  status: string;
  candidates: PageTimeline["candidates"];
  events: (Omit<TimelineEvent, "stack"> & {
    stack: undefined;
    sources: { file: string; line: number }[];
  })[];
  eventCount: number;
  groupCount: number;
  nextOffset: number | null;
  warnings: string[];
}

export function formatTimeline(
  raw: PageTimeline,
  request: TimelineRequest,
  view: { generation: string; map: SourceMap; reused: boolean },
): TimelineReport {
  const offset = request.offset ?? 0;
  const allGroups = byComponent(groupEvents(raw.events));
  const groups = allGroups.slice(offset, offset + GROUPS_PER_PAGE);
  const label = labeler();
  const events = groups.flat().map((event, index) => ({
    ...event,
    stack: undefined,
    sources: onePerSourceLine(event.stack ? view.map(event.stack, index) : []).map((s) => ({
      file: s.file,
      line: s.startLine,
    })),
  }));
  const nextOffset = offset + groups.length < allGroups.length ? offset + groups.length : null;
  const lines = [
    `Timeline · global seconds · ${raw.status}`,
    `generation: ${view.generation}`,
    ...(raw.status !== "found"
      ? raw.candidates.map(
          (c) =>
            `${c.ref} ${targetSummary([c])[0]} ${c.tag}${c.composition ? ` in ${c.composition}` : ""}`,
        )
      : []),
    ...pastTheEnd(request, raw.duration),
    ...(request.boundary !== undefined ? [`Boundary ${request.boundary}s: ${BOUNDARY_NOTE}`] : []),
    ...describeGroups(groups, request, view.map, label),
    ...describeFollowing(raw, view.map, label),
    ...describeRelations(groups),
    ...(nextOffset !== null
      ? [`More groups: repeat with offset=${nextOffset} and generation.`]
      : []),
    ...raw.warnings.map((w) => `Coverage: ${w}`),
    ...(events.some((e) => e.values)
      ? [
          "Authored values describe the original tween, not sampled state or reversed repeat direction; ? means unknown. Relative values and expressions are not resolved.",
        ]
      : []),
    COVERAGE_NOTE,
  ];
  return {
    text: lines.join("\n"),
    generation: view.generation,
    reused: view.reused,
    status: raw.status,
    candidates: raw.candidates,
    events,
    eventCount: raw.events.length,
    groupCount: allGroups.length,
    nextOffset,
    warnings: raw.warnings,
  };
}

function groupEvents(events: TimelineEvent[]): TimelineEvent[][] {
  const groups = new Map<string, TimelineEvent[]>();
  for (const event of events) {
    const identity = event.targets
      .map((t) => t.id || t.hfId || `${t.composition}:${t.tag}:${t.classes.join(".")}`)
      .sort();
    const key =
      event.kind === "animation" && event.stack
        ? JSON.stringify([
            event.stack,
            event.component?.ref,
            event.relation,
            [...event.properties].sort(),
            identity,
          ])
        : `unique:${groups.size}`;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups.values()];
}

const headingOf = (event: TimelineEvent) =>
  event.component?.id ? `#${event.component.id}` : (event.component?.composition ?? "unassigned");

function byComponent(groups: TimelineEvent[][]): TimelineEvent[][] {
  const owners = new Map<string, TimelineEvent[][]>();
  for (const group of groups) {
    const heading = headingOf(group[0]!);
    owners.set(heading, [...(owners.get(heading) ?? []), group]);
  }
  return [...owners.values()].flat();
}

function pastTheEnd(request: TimelineRequest, duration: number | undefined): string[] {
  const from = request.range?.[0] ?? request.at ?? request.boundary;
  const filmLength = duration !== undefined && duration > 0 ? duration : undefined;
  if (filmLength === undefined || from === undefined || from < filmLength) return [];
  return [`Requested time is past the end: the film is ${Number(filmLength.toFixed(4))}s long.`];
}

function labeler(): Labeler {
  const labels = new Map<string, string>();
  return (ref) => {
    if (!labels.has(ref)) labels.set(ref, `T${labels.size + 1}`);
    return labels.get(ref)!;
  };
}

const at = (seconds: number) => seconds.toFixed(4);
function onePerSourceLine<T extends { file: string; startLine: number }>(sources: T[]): T[] {
  return [...new Map(sources.map((s) => [`${s.file}:${s.startLine}`, s])).values()];
}
const located = (sources: { file: string; startLine: number }[]) =>
  onePerSourceLine(sources)
    .map((s) => `${s.file}:${s.startLine}`)
    .join(", ");

function describeValue(value: DeclaredValue): string {
  if (value.kind === "unknown") return "?";
  if (value.kind === "expression" && value.value === "custom function") return "custom function";
  const shown = typeof value.value === "number" ? Number(value.value.toFixed(4)) : value.value;
  return `${shown}${value.kind === "literal" ? "" : ` (${value.kind})`}`;
}
function describeValues(values: AnimationValues): string {
  return `    authored: ${values.properties.map((p) => `${p.property}: ${describeValue(p.from)} → ${describeValue(p.to)}`).join("; ")}; ease: ${describeValue(values.ease)}`;
}

function describeGroups(
  groups: TimelineEvent[][],
  request: TimelineRequest,
  map: SourceMap,
  label: Labeler,
): string[] {
  const lines: string[] = [];
  let owner = "";
  for (const members of groups) {
    const first = members[0]!;
    const event = {
      ...first,
      start: Math.min(...members.map((e) => e.start)),
      end: Math.max(...members.map((e) => e.end)),
      targets: [...new Map(members.flatMap((e) => e.targets).map((t) => [t.ref, t])).values()],
    };
    const component = event.component;
    const heading = headingOf(event);
    if (owner !== heading) {
      lines.push(`\n${heading}${component ? ` [${component.ref}]` : ""}`);
      owner = heading;
    }
    const targets = targetSummary(event.targets);
    const more = targets.length > 4 ? ` (+${targets.length - 4} groups)` : "";
    lines.push(
      `  ${at(event.start)}–${at(event.end)}s ${event.relation} ${event.kind} ${targets.slice(0, 4).join(", ")}${more} ${event.properties.join(",")}`,
    );
    const variants = new Map(
      members.filter((m) => m.values).map((m) => [JSON.stringify(m.values), m.values!]),
    );
    if (variants.size === 1) lines.push(describeValues(variants.values().next().value!));
    else if (variants.size > 1)
      lines.push("    authored values vary across events; inspect the per-event JSON values.");
    if (event.kind === "animation") {
      const sources = event.stack ? map(event.stack, 0) : [];
      lines.push(`    ${sources.length ? located(sources) : "source unknown"}`);
    }
    if (request.boundary !== undefined && event.kind === "animation")
      lines.push(...describeMembers(event.targets, members, label));
    if (members.length > 1) lines.push(describeSpacing(members));
  }
  return lines;
}

function targetSummary(targets: TimelineEvent["targets"]): string[] {
  const counts = new Map<string, number>();
  for (const target of targets) {
    const own = target.id
      ? `#${target.id}`
      : (target.hfId ?? (target.classes.length ? `.${target.classes.join(".")}` : target.tag));
    const name = !target.id && target.withinId ? `${own} in #${target.withinId}` : own;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name));
}

function describeMembers(
  targets: TimelineEvent["targets"],
  members: TimelineEvent[],
  label: Labeler,
): string[] {
  const lines = [`    targets: ${targets.map((t) => label(t.ref)).join(", ")}`];
  if (members.length < 2) return lines;
  for (const member of members.slice(0, MEMBERS_SHOWN))
    lines.push(
      `    ${member.targets.map((t) => label(t.ref)).join(", ")}: ${at(member.start)}–${at(member.end)}s ${member.relation}`,
    );
  if (members.length > MEMBERS_SHOWN)
    lines.push(
      `    ${members.length - MEMBERS_SHOWN} more member intervals omitted; do not infer their exact timing from this span.`,
    );
  return lines;
}

function describeSpacing(members: TimelineEvent[]): string {
  const durations = members.map((e) => e.end - e.start);
  const starts = [...new Set(members.map((e) => e.start))].sort((a, b) => a - b);
  const step = starts.length > 1 ? starts[1]! - starts[0]! : null;
  const regular =
    step !== null && starts.every((t, i) => i === 0 || Math.abs(t - starts[i - 1]! - step) < 1e-4);
  const uniform = durations.every((d) => Math.abs(d - durations[0]!) < 1e-7);
  return `    ${members.length} events; span is not continuous activity; ${uniform ? `each ${at(durations[0]!)}s` : "varying durations"}${regular ? `; approx. start spacing ${at(step)}s` : "; irregular or simultaneous starts"}`;
}

function describeFollowing(raw: PageTimeline, map: SourceMap, label: Labeler): string[] {
  if (!raw.following.length) return [];
  const lines = ["\nFollowing actions (context only; these do NOT start at the queried boundary):"];
  for (const event of raw.following.slice(0, FOLLOWING_SHOWN)) {
    const sources = event.stack ? map(event.stack, 0) : [];
    lines.push(
      `  ${event.targets.map((t) => label(t.ref)).join(", ")}: ${at(event.start)}–${at(event.end)}s ${event.properties.join(",")} ${located(sources)}`,
    );
    for (const prior of raw.events) {
      if (prior.kind !== "animation" || prior.relation !== "crosses") continue;
      if (!prior.targets.some((t) => event.targets.some((n) => n.ref === t.ref))) continue;
      if (!prior.properties.some((p) => event.properties.includes(p))) continue;
      const overlap = Math.min(prior.end, event.end) - Math.max(prior.start, event.start);
      const handoff =
        overlap > 1e-7
          ? `overlap ${at(overlap)}s`
          : Math.abs(prior.end - event.start) < 1e-7
            ? "endpoint handoff: NO duration overlap on this target"
            : "NO duration overlap on this target";
      lines.push(`    previous action ends ${at(prior.end)}s; ${handoff}.`);
    }
  }
  if (raw.following.length > FOLLOWING_SHOWN)
    lines.push(`  ${raw.following.length - FOLLOWING_SHOWN} additional following actions omitted.`);
  return lines;
}

function describeRelations(groups: TimelineEvent[][]): string[] {
  const lines: string[] = [];
  const events = groups.flatMap((members, group) => members.map((event) => ({ event, group })));
  const described = new Set<string>();
  for (let a = 0; a < events.length; a++)
    for (let b = a + 1; b < events.length; b++) {
      const left = events[a]!.event;
      const right = events[b]!.event;
      const pair = `${events[a]!.group}:${events[b]!.group}`;
      if (described.has(pair)) continue;
      if (left.kind !== "animation" || right.kind !== "animation") continue;
      if (left.end < right.start || right.end < left.start) continue;
      const shared = left.targets.some((t) => right.targets.some((r) => r.ref === t.ref));
      const properties = left.properties.filter((p) => right.properties.includes(p));
      if (!shared || !properties.length || lines.length >= RELATIONS_SHOWN) continue;
      const kind =
        left.start === left.end || right.start === right.end
          ? "instantaneous action touches or occurs inside the other interval"
          : Math.min(left.end, right.end) > Math.max(left.start, right.start)
            ? "intervals overlap"
            : "touch at an endpoint only, no positive-duration overlap";
      described.add(pair);
      lines.push(
        `Relation: ${at(left.start)}–${at(left.end)} and ${at(right.start)}–${at(right.end)} share targets and ${properties.join(",")}; ${kind}; not necessarily an error.`,
      );
    }
  return lines;
}
