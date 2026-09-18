import { parseHTML } from "linkedom";
import { parseGsapScriptAcorn } from "./gsapParserAcorn.js";
import { isSubCompositionHost, topLevelElements } from "./topLevelElements.js";
import type { StructureNode } from "./topLevelElements.js";

const EPSILON = 0.05;
const NON_RENDERED = new Set(["script", "style", "template", "noscript", "link", "meta"]);

export type TimingFinding =
  | {
      kind: "tween-outside-window";
      selector: string;
      elementId: string | null;
      dataStart: number;
      dataEnd: number | null;
      tweenStart: number;
      tweenEnd: number;
    }
  | { kind: "animated-without-timing"; selector: string; elementId: string | null }
  | { kind: "timeline-exceeds-root-duration"; rootDuration: number; timelineEnd: number };

/** Timing that could not be read statically. Reported, never flagged. */
export interface UnresolvedTiming {
  selector: string;
  reason: "duration" | "position" | "stagger" | "start-attribute";
}

export interface TimingMismatchReport {
  findings: TimingFinding[];
  unresolved: UnresolvedTiming[];
}

interface DomNode extends StructureNode<DomNode> {
  el: Element;
}

const toNode = (el: Element): DomNode => ({
  tag: el.tagName,
  attrs: Object.fromEntries(Array.from(el.attributes, (a) => [a.name, a.value])),
  children: Array.from(el.children, toNode),
  el,
});

const numeric = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function queryAll(root: Element, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

type Anim = ReturnType<typeof parseGsapScriptAcorn>["animations"][number];

const unresolvedReason = (anim: Anim): UnresolvedTiming["reason"] | null => {
  if (anim.durationUnresolved) return "duration";
  if (anim.resolvedStart === undefined) return "position";
  return anim.extras?.stagger === undefined ? null : "stagger";
};

/** Where each element sits: inside a timeline row (timed clip or sub-composition), or loose. */
function rowMembership(root: Element): { rowEls: Set<Element>; insideRow: Set<Element> } {
  const rows = topLevelElements(toNode(root));
  const rowEls = new Set(rows.map((r) => r.el));
  const insideRow = new Set<Element>();
  for (const row of rows) {
    insideRow.add(row.el);
    for (const d of Array.from(row.el.querySelectorAll("*"))) insideRow.add(d);
  }
  return { rowEls, insideRow };
}

const attrNumber = (el: Element, name: string): number | null =>
  numeric(el.getAttribute(name) ?? undefined);

function windowFinding(
  el: Element,
  selector: string,
  anim: Anim,
  start: number,
  end: number,
): TimingFinding | null {
  const dataStart = attrNumber(el, "data-start");
  const duration = attrNumber(el, "data-duration");
  if (dataStart === null) return null;
  const dataEnd = duration === null ? null : dataStart + duration;
  const beforeStart = anim.method !== "set" && start < dataStart - EPSILON;
  const afterEnd = dataEnd !== null && start > dataEnd + EPSILON;
  if (!beforeStart && !afterEnd) return null;
  const elementId = el.getAttribute("id");
  return {
    kind: "tween-outside-window",
    selector,
    elementId,
    dataStart,
    dataEnd,
    tweenStart: start,
    tweenEnd: end,
  };
}

interface Layout {
  rowEls: Set<Element>;
  insideRow: Set<Element>;
}

const tweenEnd = (anim: Anim): number =>
  (anim.resolvedStart as number) + (anim.method === "set" ? 0 : (anim.duration ?? 0.5));

/** Findings and unresolved entries for one resolved tween against one target element. */
function checkTarget(
  el: Element,
  selector: string,
  anim: Anim,
  layout: Layout,
  report: TimingMismatchReport,
) {
  if (!layout.insideRow.has(el)) {
    if (!NON_RENDERED.has(el.tagName.toLowerCase())) {
      report.findings.push({
        kind: "animated-without-timing",
        selector,
        elementId: el.getAttribute("id"),
      });
    }
    return;
  }
  if (!layout.rowEls.has(el) || isSubCompositionHost(toNode(el))) return;
  if (el.hasAttribute("data-start") && attrNumber(el, "data-start") === null) {
    report.unresolved.push({ selector, reason: "start-attribute" });
    return;
  }
  const found = windowFinding(el, selector, anim, anim.resolvedStart as number, tweenEnd(anim));
  if (found) report.findings.push(found);
}

/** Checks one tween against its targets and returns its end, or null when its timing is unresolved. */
function checkTween(
  anim: Anim,
  root: Element,
  layout: Layout,
  seenUntimed: Set<Element>,
  report: TimingMismatchReport,
): number | null {
  const selector = anim.targetSelector;
  const targets = queryAll(root, selector).filter((el) => el !== root);
  const reason = unresolvedReason(anim);
  if (reason) {
    if (targets.length > 0) report.unresolved.push({ selector, reason });
    return null;
  }
  for (const el of targets) {
    const loose = !layout.insideRow.has(el);
    if (loose && seenUntimed.has(el)) continue;
    if (loose) seenUntimed.add(el);
    checkTarget(el, selector, anim, layout, report);
  }
  return tweenEnd(anim);
}

/**
 * Compares the GSAP timeline in a composition file with the timing attributes of its elements.
 * Attributes are authoritative: a tween that places an element outside its window is a finding.
 */
export function timingMismatches(html: string): TimingMismatchReport {
  const report: TimingMismatchReport = { findings: [], unresolved: [] };
  const { document } = parseHTML(html);
  const root = document.querySelector("[data-composition-id]");
  if (!root) return report;

  const layout = rowMembership(root);
  const seenUntimed = new Set<Element>();
  const scripts = Array.from(document.querySelectorAll("script:not([src])"));
  const anims = scripts.flatMap((s) => parseGsapScriptAcorn(s.textContent ?? "").animations);
  const ends = anims
    .filter((anim) => !anim.global && !anim.hasUnresolvedSelector)
    .map((anim) => checkTween(anim, root, layout, seenUntimed, report));
  const timelineEnd = Math.max(0, ...ends.filter((e): e is number => e !== null));

  const rootDuration = attrNumber(root, "data-duration");
  if (rootDuration !== null && timelineEnd > rootDuration + EPSILON) {
    report.findings.push({ kind: "timeline-exceeds-root-duration", rootDuration, timelineEnd });
  }
  return report;
}
