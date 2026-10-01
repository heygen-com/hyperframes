// Which elements a GSAP soft reload resets, what their tweens wrote, and which file writes each.
import { parseSavedSource } from "./authoredSource";

type TweenLike = {
  targets?: () => Element[];
  vars?: Record<string, unknown>;
  getChildren?: (deep: boolean) => TweenLike[];
};

const NESTED_VARS = new Set(["css", "startAt", "keyframes"]);

// The CSS names a tween's vars write; GSAP's own keys (ease, duration) are not CSS and restore as no-ops.
function tweenedProps(vars: unknown): string[] {
  if (!vars || typeof vars !== "object") return [];
  return Object.entries(vars).flatMap(([key, value]) => [
    key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
    ...(NESTED_VARS.has(key) || /^\d|%$/.test(key) ? tweenedProps(value) : []),
  ]);
}

// A nested composition's timeline sits inside the root one but only its own script rebuilds it.
function ownTweens(tl: TweenLike, nested: Set<unknown>): TweenLike[] {
  return (tl.getChildren?.(false) ?? []).flatMap((child) => {
    if (nested.has(child)) return [];
    return child.getChildren ? ownTweens(child, nested) : [child];
  });
}

// The preview marks each inlined composition's host with its file; the host itself is the parent's.
export function authoringFile(el: Element): string | null {
  return (
    el.parentElement?.closest("[data-composition-file]")?.getAttribute("data-composition-file") ??
    null
  );
}

function addTweenTargets(tween: TweenLike, targets: Map<Element, Set<string>>): void {
  const props = tweenedProps(tween.vars);
  for (const el of tween.targets?.() ?? []) {
    const seen = targets.get(el) ?? new Set<string>();
    for (const prop of props) seen.add(prop);
    targets.set(el, seen);
  }
}

/** Each element the re-run rebuilds, with the CSS names its killed tweens wrote. */
export function collectResetTargets(
  win: { __timelines?: Record<string, unknown> },
  doc: Document,
  targetKeys: string[],
  reparse: Element[] = [],
): Map<Element, Set<string>> {
  // Elements the caller needs GSAP to parse again, with nothing tweened yet.
  const targets = new Map<Element, Set<string>>(reparse.map((el) => [el, new Set<string>()]));
  const timelines = (win.__timelines ?? {}) as Record<string, TweenLike | undefined>;
  const others = new Set<unknown>(
    Object.entries(timelines).flatMap(([key, tl]) => (targetKeys.includes(key) ? [] : [tl])),
  );
  for (const key of targetKeys) {
    try {
      for (const tween of ownTweens(timelines[key] ?? {}, others)) addTweenTargets(tween, targets);
    } catch {}
  }
  sweepOrphanedTransforms(doc, targetKeys, others, targets);
  return targets;
}

function tweenTargetsIn(timelines: Set<unknown>): Set<Element> {
  const els = new Set<Element>();
  for (const tl of timelines) {
    try {
      for (const tween of (tl as TweenLike | undefined)?.getChildren?.(true) ?? []) {
        for (const el of tween.targets?.() ?? []) els.add(el);
      }
    } catch {}
  }
  return els;
}

export function compositionFile(doc: Document, targetKeys: string[]): string | null {
  const root = targetKeys
    .map((key) => doc.querySelectorAll(`[data-composition-id="${CSS.escape(key)}"]`)[0])
    .find(Boolean);
  return root?.closest("[data-composition-file]")?.getAttribute("data-composition-file") ?? null;
}

// A standalone gsap.set, or keyframes just removed, leaves a transform no timeline child shows.
// Gate on GSAP's cache so an authored inline transform is never stripped. What another file
// holds or another timeline animates belongs to a script this re-run does not rebuild.
function sweepOrphanedTransforms(
  doc: Document,
  targetKeys: string[],
  others: Set<unknown>,
  targets: Map<Element, Set<string>>,
): void {
  const elsewhere = tweenTargetsIn(others);
  const file = compositionFile(doc, targetKeys);
  for (const el of doc.querySelectorAll<HTMLElement>("[style*='transform']")) {
    if (targets.has(el) || elsewhere.has(el) || authoringFile(el) !== file) continue;
    if (el.style.transform && "_gsap" in el) targets.set(el, new Set());
  }
}

// Each file a reset element may be written in, parsed at most once per reload: the reloaded
// composition's own file is the one just written, any other comes from the caller.
export function fileDocs(
  ownFile: string | null,
  written: string | undefined,
  nestedFiles: Map<string, string> | undefined,
): (file: string | null) => Document | null {
  const docs = new Map<string | null, Document | null>();
  return (file) => {
    if (!docs.has(file)) {
      const text = file === ownFile ? written : nestedFiles?.get(file ?? "");
      try {
        docs.set(file, text ? parseSavedSource(text) : null);
      } catch {
        docs.set(file, null);
      }
    }
    return docs.get(file) ?? null;
  };
}
