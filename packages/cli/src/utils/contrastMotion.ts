export interface ContrastTweenState {
  active: boolean;
  infiniteAncestor: boolean;
  duration: number;
  repeat: number;
}

export interface ContrastMotionSample {
  opacity: number;
  tweens: ContrastTweenState[];
}

/** A repeating tween or one this long is set dressing (a camera drift, a pulse), not an entrance or exit. */
const AMBIENT_TWEEN_SECONDS = 4;

function isAmbientTween(tween: ContrastTweenState): boolean {
  return tween.infiniteAncestor || tween.repeat !== 0 || tween.duration >= AMBIENT_TWEEN_SECONDS;
}

/** True when a non-ambient tween on the text or an ancestor is running at the current seek, or the text is not fully opaque. */
export function measuredInMotion(sample: ContrastMotionSample): boolean {
  if (Math.round(sample.opacity * 1000) < 1000) return true;
  return sample.tweens.some((tween) => !isAmbientTween(tween) && tween.active);
}

// Serialized into the page: read prepared elements at the current seek without advancing GSAP.
// fallow-ignore-next-line complexity
export function readContrastMotion(): (ContrastMotionSample | null)[] {
  type Animation = {
    parent: Animation | null;
    targets: () => unknown[];
    duration: () => number;
    totalDuration: () => number;
    repeat: () => number;
    time: () => number;
    startTime: () => number;
    endTime: () => number;
    timeScale: () => number;
    paused: () => boolean;
    getChildren: (nested: boolean, tweens: boolean, timelines: boolean) => Animation[];
  };
  const restores: unknown = Reflect.get(window, "__contrastAuditRestores");
  const registry: unknown = Reflect.get(window, "__timelines");
  const timelines = Object.values(typeof registry === "object" && registry ? registry : {}).filter(
    (timeline): timeline is Animation =>
      typeof timeline?.getChildren === "function" && typeof timeline.time === "function",
  );
  const registered = new Set<Animation>(timelines);
  const byTarget = new Map<Element, ContrastTweenState[]>();

  function nestedInAnother(timeline: Animation): boolean {
    for (let parent = timeline.parent; parent; parent = parent.parent) {
      if (registered.has(parent)) return true;
    }
    return false;
  }

  function activeInRoot(animation: Animation, root: Animation): boolean {
    if (animation === root) return true;
    const parent = animation.parent;
    if (!parent || animation.paused() || animation.timeScale() === 0) return false;
    const time = parent.time();
    return (
      animation.startTime() <= time + 1e-6 &&
      time < animation.endTime() - 1e-6 &&
      activeInRoot(parent, root)
    );
  }

  function hasInfiniteAncestor(animation: Animation, root: Animation): boolean {
    for (let parent = animation.parent; parent; parent = parent.parent) {
      if (parent.repeat() === -1) return true;
      if (parent === root) break;
    }
    return false;
  }

  function addTweens(timeline: Animation): void {
    for (const tween of timeline.getChildren(true, true, false)) {
      const total = tween.totalDuration();
      if (!(total > 0)) continue;
      const state = {
        active: activeInRoot(tween, timeline),
        infiniteAncestor: hasInfiniteAncestor(tween, timeline),
        duration: tween.duration(),
        repeat: tween.repeat(),
      };
      for (const target of tween.targets()) {
        if (target instanceof Element)
          byTarget.set(target, [...(byTarget.get(target) ?? []), state]);
      }
    }
  }

  function sampleOf(element: unknown): ContrastMotionSample | null {
    if (!(element instanceof Element)) return null;
    const tweens: ContrastTweenState[] = [];
    let opacity = 1;
    for (let node: Element | null = element; node; node = node.parentElement) {
      tweens.push(...(byTarget.get(node) ?? []));
      const own = Number.parseFloat(getComputedStyle(node).opacity);
      if (Number.isFinite(own)) opacity *= own;
    }
    return tweens.length > 0 ? { opacity, tweens } : null;
  }

  for (const timeline of timelines) {
    try {
      if (!nestedInAnother(timeline)) addTweens(timeline);
    } catch {
      continue;
    }
  }
  return (Array.isArray(restores) ? restores : []).map((restore) =>
    typeof restore === "object" && restore ? sampleOf(Reflect.get(restore, "el")) : null,
  );
}
