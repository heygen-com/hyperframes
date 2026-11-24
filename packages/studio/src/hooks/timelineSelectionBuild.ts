import type { TimelineElement } from "../player";
import {
  findElementForTimelineElement,
  type DomEditSelection,
} from "../components/editor/domEditing";
import { findOpaqueTimelineElement } from "../components/editor/previewSelection";
import type { PreviewElement } from "../player/lib/previewElements";
import { reapplyPositionEditsAfterSeek } from "../components/editor/manualEdits";
import { holdScenesOf } from "../utils/sceneHold";
import type { ResolveDomSelectionOptions } from "./useDomSelectionTypes";

type TimelineSelectionBuild = (
  element: TimelineElement,
  iframe: HTMLIFrameElement | null,
) => Promise<DomEditSelection | null>;

type TargetSelectionBuild = (
  target: HTMLElement | PreviewElement,
  options: ResolveDomSelectionOptions,
  iframe?: HTMLIFrameElement | null,
) => Promise<DomEditSelection | null>;

// fallow-ignore-next-line complexity
export async function buildTimelineSelection(
  element: TimelineElement,
  iframe: HTMLIFrameElement | null,
  lookup: Parameters<typeof findElementForTimelineElement>[2],
  buildFromTarget: TargetSelectionBuild,
): Promise<DomEditSelection | null> {
  let doc: Document | null = null;
  try {
    doc = iframe?.contentDocument ?? null;
  } catch {
    return null;
  }
  if (!doc) {
    await holdScenesOf(iframe, element);
    const found = await findOpaqueTimelineElement(iframe, element, lookup);
    return found ? buildFromTarget(found, { preferClipAncestor: false }, iframe) : null;
  }

  const held = holdScenesOf(iframe, element);
  if (held) await held;
  reapplyPositionEditsAfterSeek(doc);

  const targetElement = findElementForTimelineElement(doc, element, lookup);
  return targetElement ? buildFromTarget(targetElement, { preferClipAncestor: false }) : null;
}

export function sharingRunningBuilds(
  build: TimelineSelectionBuild,
  iframeRef: { current: HTMLIFrameElement | null },
): (element: TimelineElement) => Promise<DomEditSelection | null> {
  const running = new Map<
    string,
    { iframe: HTMLIFrameElement | null; built: Promise<DomEditSelection | null> }
  >();
  return (element) => {
    const key = element.key ?? element.id;
    const iframe = iframeRef.current;
    const shared = running.get(key);
    if (shared?.iframe === iframe) return shared.built;
    const built = build(element, iframe).finally(() => {
      if (running.get(key)?.built === built) running.delete(key);
    });
    running.set(key, { iframe, built });
    return built;
  };
}
