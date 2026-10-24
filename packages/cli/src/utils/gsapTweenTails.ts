/**
 * A GSAP tween that ends just after a later tween on the same property takes the property back for that tail
 * and leaves its own end value on screen. A banner word whose drift (x: -40) ended 20 ms after its exit
 * (x: 2200) stayed in the middle of the frame for the rest of the scene, in playback and in renders alike.
 */

/** Seconds: a longer tail reads as an intended drift that resumes, not a tail the author missed. */
const TWEEN_TAIL_WINDOW = 0.25;

export interface TweenRecord {
  timeline: string;
  target: number;
  label: string;
  properties: string[];
  start: number;
  end: number;
}

export interface TweenTail {
  timeline: string;
  label: string;
  properties: string[];
  earlier: { start: number; end: number };
  later: { start: number; end: number };
}

export function findTweenTails(records: TweenRecord[]): TweenTail[] {
  return records.flatMap((earlier) =>
    records.flatMap((later) => {
      const tail = tailBetween(earlier, later);
      return tail ? [tail] : [];
    }),
  );
}

function tailBetween(earlier: TweenRecord, later: TweenRecord): TweenTail | null {
  if (later.target !== earlier.target || later.timeline !== earlier.timeline) return null;
  const overlaps = earlier.start < later.start && later.start < earlier.end;
  const tail = earlier.end - later.end;
  if (!overlaps || tail <= 0 || tail > TWEEN_TAIL_WINDOW) return null;
  const properties = earlier.properties.filter((name) => later.properties.includes(name));
  if (properties.length === 0) return null;
  return {
    timeline: earlier.timeline,
    label: earlier.label,
    properties,
    earlier: { start: earlier.start, end: earlier.end },
    later: { start: later.start, end: later.end },
  };
}

export function tweenTailMessage(tail: TweenTail): string {
  const props = tail.properties.join(", ");
  const seconds = (value: number) => `${value.toFixed(3)} s`;
  return (
    `In timeline "${tail.timeline}", a tween on ${props} of ${tail.label} ends at ${seconds(tail.earlier.end)}, ` +
    `${(tail.earlier.end - tail.later.end).toFixed(3)} s after a later tween on ${props} ends at ` +
    `${seconds(tail.later.end)}. For that tail the earlier tween takes ${props} back and leaves its own end value ` +
    `on screen, so the later tween's end never shows. End the earlier tween by ${seconds(tail.later.start)}, or ` +
    `add overwrite: "auto" to the later tween.`
  );
}

/**
 * Runs in the page (serialized by puppeteer, so it is self-contained): every plain tween of every registered
 * timeline, timed on that timeline. Repeating, yoyo, keyframed and overwrite tweens are left out.
 */
export function collectTweenRecords(): TweenRecord[] {
  type Tween = {
    vars: Record<string, unknown>;
    parent: Tween | null;
    targets: () => unknown[];
    totalDuration: () => number;
    globalTime: (localTime: number) => number;
    getChildren?: (nested: boolean, tweens: boolean, timelines: boolean) => Tween[];
  };
  const NOT_PROPERTIES = new Set([
    "duration",
    "force3D",
    "autoRound",
    "delay",
    "ease",
    "repeat",
    "repeatDelay",
    "repeatRefresh",
    "yoyo",
    "yoyoEase",
    "stagger",
    "overwrite",
    "immediateRender",
    "lazy",
    "paused",
    "reversed",
    "runBackwards",
    "startAt",
    "keyframes",
    "inherit",
    "data",
    "id",
    "callbackScope",
    "onStart",
    "onStartParams",
    "onUpdate",
    "onUpdateParams",
    "onComplete",
    "onCompleteParams",
    "onRepeat",
    "onRepeatParams",
    "onReverseComplete",
    "onReverseCompleteParams",
    "parent",
    "onInterrupt",
    "autoRevert",
    "smoothChildTiming",
  ]);
  const registered =
    (window as unknown as { __timelines?: Record<string, Tween> }).__timelines ?? {};
  const names = new Map<Tween, string>();
  for (const [name, timeline] of Object.entries(registered)) {
    if (typeof timeline?.getChildren === "function") names.set(timeline, name);
  }
  const ids = new Map<unknown, number>();

  // A registered timeline nested in another one is walked as part of its parent.
  function nestedInAnother(timeline: Tween): boolean {
    for (let parent = timeline.parent; parent; parent = parent.parent) {
      if (names.has(parent)) return true;
    }
    return false;
  }

  function plainProperties(tween: Tween): string[] {
    const vars = tween.vars ?? {};
    const plain = !vars.repeat && !vars.yoyo && !vars.keyframes && !vars.overwrite;
    return plain ? Object.keys(vars).filter((key) => !NOT_PROPERTIES.has(key)) : [];
  }

  function labelOf(target: unknown): string {
    if (!(target instanceof Element)) return "an object";
    if (target.id) return `#${target.id}`;
    return [target.tagName.toLowerCase(), ...target.classList].join(".");
  }

  function recordsOf(timeline: Tween, name: string): TweenRecord[] {
    const origin = timeline.globalTime(0);
    return (timeline.getChildren?.(true, true, false) ?? []).flatMap((tween) => {
      const duration = tween.totalDuration();
      const properties = plainProperties(tween);
      if (!(duration > 0) || properties.length === 0) return [];
      const start = tween.globalTime(0) - origin;
      const end = tween.globalTime(duration) - origin;
      return tween.targets().map((target) => {
        if (!ids.has(target)) ids.set(target, ids.size);
        const id = ids.get(target) ?? -1;
        return { timeline: name, target: id, label: labelOf(target), properties, start, end };
      });
    });
  }

  return [...names].flatMap(([timeline, name]) =>
    nestedInAnother(timeline) ? [] : recordsOf(timeline, name),
  );
}
