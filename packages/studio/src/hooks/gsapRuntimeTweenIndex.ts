import type { RuntimeTimeline, RuntimeTween } from "./gsapRuntimeKeyframes";

export function matchesElement(tween: RuntimeTween, el: Element): boolean {
  if (!tween.targets) return false;
  for (const t of tween.targets()) {
    if (t === el || (el.id && (t as Element).id === el.id)) return true;
  }
  return false;
}

type TweenIndex = { byElement: Map<unknown, RuntimeTween[]>; byId: Map<string, RuntimeTween[]> };
let tweenIndexes: WeakMap<RuntimeTimeline, TweenIndex> | null = null;

/** Within `run`, finding the tweens on an element reads one index per timeline, not every tween. */
export function withTweenIndex<T>(run: () => T): T {
  const outer = tweenIndexes;
  tweenIndexes ??= new WeakMap();
  try {
    return run();
  } finally {
    tweenIndexes = outer;
  }
}

function indexTweens(children: RuntimeTween[]): TweenIndex {
  const index: TweenIndex = { byElement: new Map(), byId: new Map() };
  const add = <K>(map: Map<K, RuntimeTween[]>, key: K, tween: RuntimeTween) =>
    map.set(key, [...(map.get(key) ?? []), tween]);
  for (const tween of children) {
    for (const target of tween.targets?.() ?? []) {
      add(index.byElement, target, tween);
      const id = (target as Element).id;
      if (id) add(index.byId, id, tween);
    }
  }
  return index;
}

export function tweensTargeting(timeline: RuntimeTimeline | undefined, el: Element): RuntimeTween[] {
  const children = timeline?.getChildren?.(true) ?? [];
  if (!timeline || typeof timeline !== "object" || !tweenIndexes)
    return children.filter((tween) => matchesElement(tween, el));
  let index = tweenIndexes.get(timeline);
  if (!index) tweenIndexes.set(timeline, (index = indexTweens(children)));
  return [...(index.byElement.get(el) ?? []), ...(el.id ? (index.byId.get(el.id) ?? []) : [])];
}

