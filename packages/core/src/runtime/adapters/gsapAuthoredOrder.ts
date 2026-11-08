import type { GsapPlaced } from "./gsap";

// GSAP sorts a timeline's children by start time and keeps no record of the order a film wrote them in. A set written
// before the tween it sits inside is that tween's initial state; one written after it is an override of that tween.
type Stamped = { _hfAuthored?: number };
type Adder = (this: { _recent?: Stamped }, ...args: unknown[]) => unknown;
type TimelineProto = Record<string, unknown> & { _hfStamped?: true };

const ADDERS = ["to", "from", "fromTo", "set"] as const;
let written = 0;

/** Numbers every child a timeline adds with `to`, `from`, `fromTo` and `set` by when the film wrote it. */
export function stampAuthoredOrder(gsap: object | undefined): void {
  const core = (gsap as { core?: { Timeline?: { prototype: object } } } | undefined)?.core;
  const proto = core?.Timeline?.prototype as TimelineProto | undefined;
  if (!proto || proto._hfStamped) return;
  proto._hfStamped = true;
  for (const name of ADDERS) {
    const add = proto[name] as Adder;
    proto[name] = function (this: { _recent?: Stamped }, ...args: unknown[]) {
      const result = add.apply(this, args);
      if (this._recent && this._recent._hfAuthored === undefined)
        this._recent._hfAuthored = ++written;
      return result;
    };
  }
}

/** When the film wrote the child of `owner` holding `tween`; undefined for a film built before the runtime loaded. */
export function authoredOrderOf(tween: GsapPlaced, owner: object): number | undefined {
  let order: number | undefined;
  for (
    let node: GsapPlaced | null | undefined = tween;
    node && node !== owner;
    node = node.parent
  ) {
    order = (node as Stamped)._hfAuthored ?? order;
  }
  return order;
}
