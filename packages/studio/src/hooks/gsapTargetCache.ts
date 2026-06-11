import { STUDIO_GSAP_DRAG_INTERCEPT_ENABLED } from "../components/editor/manualEditingAvailability";

type TimelineLike = { getChildren?: (nested: boolean) => Array<{ targets?: () => Element[] }> };

let _gsapCachedTimelines: Record<string, TimelineLike> | undefined;
let _gsapTargetIds: Set<string> | undefined;
let _gsapTargetNodes: WeakSet<Element> | undefined;

function addTargetsFromTimeline(tl: TimelineLike, ids: Set<string>, nodes: WeakSet<Element>): void {
  const children = tl.getChildren?.(true);
  if (!children) return;
  for (const child of children) {
    const targets = child.targets?.();
    if (!targets) continue;
    for (const t of targets) {
      nodes.add(t);
      if (t.id) ids.add(t.id);
    }
  }
}

function collectGsapTargets(timelines: Record<string, TimelineLike>): {
  ids: Set<string>;
  nodes: WeakSet<Element>;
} {
  const ids = new Set<string>();
  const nodes = new WeakSet<Element>();
  for (const tl of Object.values(timelines)) {
    if (!tl) continue;
    try {
      addTargetsFromTimeline(tl, ids, nodes);
    } catch {
      /* teardown race */
    }
  }
  return { ids, nodes };
}

function readTimelines(iframe: HTMLIFrameElement | null): Record<string, TimelineLike> | undefined {
  if (!iframe?.contentWindow) return undefined;
  try {
    return (iframe.contentWindow as Window & { __timelines?: Record<string, TimelineLike> })
      .__timelines;
  } catch {
    return undefined;
  }
}

export function isElementGsapTargeted(
  iframe: HTMLIFrameElement | null,
  element: HTMLElement,
): boolean {
  if (!STUDIO_GSAP_DRAG_INTERCEPT_ENABLED) return false;
  const timelines = readTimelines(iframe);
  if (!timelines) return false;

  if (timelines !== _gsapCachedTimelines) {
    const cache = collectGsapTargets(timelines);
    _gsapTargetIds = cache.ids;
    _gsapTargetNodes = cache.nodes;
    _gsapCachedTimelines = timelines;
  }

  return _gsapTargetNodes!.has(element) || !!(element.id && _gsapTargetIds!.has(element.id));
}
