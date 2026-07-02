/**
 * Browser-only editing-affordance resolver. Reads live layout (getComputedStyle)
 * from a rendered element and combines it with the SDK model element to call the
 * pure core resolver. MUST NOT be imported on the static/Node SDK path — it
 * touches getComputedStyle and only resolves meaningfully against a laid-out DOM.
 */

import { resolveEditingAffordances, type EditingAffordances } from "@hyperframes/core/editing";
import type { HyperFramesElement } from "../types.js";

export interface AffordanceContext {
  /** Studio-app concepts; default false for a generic consumer with no such notion. */
  isCompositionHost?: boolean;
  isCompositionRoot?: boolean;
  isInsideLockedComposition?: boolean;
  isMasterView?: boolean;
}

type ModelFacts = Pick<HyperFramesElement, "text" | "animationIds" | "start">;

export function resolveElementAffordances(
  liveEl: HTMLElement,
  modelEl: ModelFacts | null,
  ctx: AffordanceContext = {},
): EditingAffordances {
  const view = liveEl.ownerDocument.defaultView;
  const cs = view ? view.getComputedStyle(liveEl) : null;
  const computedStyles: Record<string, string> | undefined = cs
    ? {
        position: cs.getPropertyValue("position"),
        left: cs.getPropertyValue("left"),
        top: cs.getPropertyValue("top"),
        width: cs.getPropertyValue("width"),
        height: cs.getPropertyValue("height"),
        transform: cs.getPropertyValue("transform"),
      }
    : undefined;

  // Core reads position only from computedStyles; inlineStyles supplies the
  // authored left/top/width/height that override the computed layout.
  const inlineStyles: Record<string, string> = {
    left: liveEl.style.getPropertyValue("left"),
    top: liveEl.style.getPropertyValue("top"),
    width: liveEl.style.getPropertyValue("width"),
    height: liveEl.style.getPropertyValue("height"),
  };

  return resolveEditingAffordances({
    hasStableTarget: true,
    tag: liveEl.tagName.toLowerCase(),
    inlineStyles,
    computedStyles,
    isCompositionHost: ctx.isCompositionHost ?? false,
    isCompositionRoot: ctx.isCompositionRoot ?? false,
    isInsideLockedComposition: ctx.isInsideLockedComposition ?? false,
    isMasterView: ctx.isMasterView ?? false,
    existsInSource: modelEl != null,
    hasEditableText: modelEl?.text != null,
    hasTimingStart: modelEl ? modelEl.start != null : liveEl.hasAttribute("data-start"),
    animationCount: modelEl?.animationIds.length ?? 0,
  });
}
