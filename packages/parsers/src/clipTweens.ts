import type { GsapAnimation } from "./gsapSerialize.js";

type TweenTarget = Pick<GsapAnimation, "targetSelector" | "hasPartialSelector">;
type TweenTime = Pick<GsapAnimation, "position" | "implicitPosition">;

// Tweens a timeline move or retime of a clip carries: an own selector, plus (given a DOM) a fully known target
// set that is the clip or sits inside it with no nearer `data-start` clip. A tween also aiming outside stays put.
export function clipTweenMatcher(
  clipSelectors: string | readonly string[],
  root?: ParentNode,
): (tween: TweenTarget) => boolean {
  const own = typeof clipSelectors === "string" ? [clipSelectors] : clipSelectors;
  const clips = root ? own.flatMap((selector) => queryAll(root, selector)) : [];
  return ({ targetSelector, hasPartialSelector }) => {
    if (hasPartialSelector) return false;
    if (own.includes(targetSelector)) return true;
    if (!root || clips.length === 0) return false;
    const targets = queryAll(root, targetSelector);
    return (
      targets.length > 0 &&
      targets.every((target) => {
        const owner = target.closest("[data-start]");
        return clips.includes(target) || (owner !== null && clips.includes(owner));
      })
    );
  };
}

/** Where a GSAP script's clips live: linkedom keeps a `<template>`'s children under it, out of document queries. */
export function clipQueryRoot(script: Element): ParentNode {
  return script.closest("template") ?? script.ownerDocument;
}

/** A written position; an implicit one follows the tween before it and must stay unwritten. */
export function hasExplicitTime<T extends TweenTime>(
  animation: T,
): animation is T & { position: number } {
  return typeof animation.position === "number" && !animation.implicitPosition;
}

function queryAll(root: ParentNode, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    // Pseudo-selectors such as a proxy or dwell label never match the DOM.
    return [];
  }
}
