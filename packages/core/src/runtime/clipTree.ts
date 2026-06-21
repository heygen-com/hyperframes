/**
 * window.__clipTree — hierarchical clip tree for Studio.
 *
 * Maps every timed element to a node so Studio can derive parent/child
 * relationships for inline timeline expansion. Read-only: timing edits go
 * through the host's normal save → reloadPreview path, not a DOM patch here.
 *
 * ponytail: intentionally minimal. Node carries only what consumers read
 * (id/parentId/children) plus the backing element. Add fields (label, kind,
 * absolute start) when a caller needs them.
 */

import type { RuntimeTimelineLike } from "./types";

export interface ClipNode {
  readonly id: string;
  readonly element: Element;
  readonly parentId: string | null;
  readonly children: readonly ClipNode[];
}

export interface ClipTree {
  readonly roots: readonly ClipNode[];
}

// Mutable shape used only while building; the public ClipTree exposes it as
// readonly so Studio consumers can't accidentally mutate the live tree.
type MutableClipNode = {
  id: string;
  element: Element;
  parentId: string | null;
  children: MutableClipNode[];
};

const DECORATIVE_TAGS = new Set(["SCRIPT", "STYLE", "LINK", "META", "TEMPLATE", "NOSCRIPT"]);

/**
 * Stable identity for a timed element, shared by __clipTree and __clipManifest
 * so the two id spaces align. Prefers the author `id`, then the generator's
 * `data-hf-id` (present on every generated element). Without the data-hf-id
 * fallback an id-less child (root index.html children use data-hf-id, not id)
 * gets a synthetic `__clip-N` in the tree but `null` in the manifest, so inline
 * timeline expansion can't join them and never expands.
 */
export function stableClipId(el: Element): string | null {
  return (el as HTMLElement).id || el.getAttribute("data-hf-id") || null;
}

interface StartResolverLike {
  resolveStartForElement: (element: Element, fallback?: number) => number;
}

function parseNum(value: string | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function durationFromTimeline(
  el: Element,
  registry: Record<string, RuntimeTimelineLike | undefined>,
): number | null {
  const compId = el.getAttribute("data-composition-id");
  if (!compId) return null;
  const d = Number(registry[compId]?.duration?.());
  return Number.isFinite(d) && d > 0 ? d : null;
}

function durationFromMedia(el: Element): number | null {
  if (!(el instanceof HTMLMediaElement) || !Number.isFinite(el.duration)) return null;
  const mediaStart =
    parseNum(el.getAttribute("data-playback-start")) ??
    parseNum(el.getAttribute("data-media-start")) ??
    0;
  return el.duration > mediaStart ? el.duration - mediaStart : null;
}

// Used only to filter out zero-duration (decorative) elements at build time.
function resolveDuration(
  el: Element,
  timelineRegistry: Record<string, RuntimeTimelineLike | undefined>,
  rootDuration: number,
  absoluteStart: number,
): number {
  const attr = parseNum(el.getAttribute("data-duration"));
  if (attr != null && attr > 0) return attr;
  return (
    durationFromTimeline(el, timelineRegistry) ??
    durationFromMedia(el) ??
    Math.max(0, rootDuration - absoluteStart)
  );
}

function linkParentChild(elementToNode: Map<Element, MutableClipNode>): void {
  for (const [el, node] of elementToNode) {
    let cursor = el.parentElement;
    while (cursor) {
      const parentNode = elementToNode.get(cursor);
      if (parentNode) {
        node.parentId = parentNode.id;
        parentNode.children.push(node);
        break;
      }
      cursor = cursor.parentElement;
    }
  }
}

export function createClipTree(params: {
  startResolver: StartResolverLike;
  timelineRegistry: Record<string, RuntimeTimelineLike | undefined>;
  rootDuration: number;
}): ClipTree {
  const { startResolver, timelineRegistry, rootDuration } = params;
  const elementToNode = new Map<Element, MutableClipNode>();

  const root = document.querySelector("[data-composition-id]");
  let ordinal = 0;

  for (const el of document.querySelectorAll("[data-start]")) {
    if (el === root || DECORATIVE_TAGS.has(el.tagName)) continue;
    const absoluteStart = startResolver.resolveStartForElement(el, 0);
    if (resolveDuration(el, timelineRegistry, rootDuration, absoluteStart) <= 0) continue;
    const node: MutableClipNode = {
      id: stableClipId(el) ?? `__clip-${ordinal++}`,
      element: el,
      parentId: null,
      children: [],
    };
    elementToNode.set(el, node);
  }

  linkParentChild(elementToNode);

  return {
    roots: Array.from(elementToNode.values()).filter((n) => n.parentId === null),
  };
}
