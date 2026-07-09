import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import type { CommitMutation } from "./gsapScriptCommitTypes";
import { isAnimeEditableAnimation } from "./animeAnimationAdapter";

function animeAnimations(animations: GsapAnimation[]) {
  return animations.filter(isAnimeEditableAnimation);
}

function positionAnimation(animations: GsapAnimation[]) {
  return (
    animeAnimations(animations).find((anim) => anim.propertyGroup === "position") ??
    animeAnimations(animations).find(
      (anim) => "translateX" in anim.properties || "translateY" in anim.properties,
    ) ??
    null
  );
}

export async function tryAnimeDragIntercept(
  selection: DomEditSelection,
  offset: { x: number; y: number },
  animations: GsapAnimation[],
  commitMutation: CommitMutation | null,
): Promise<boolean> {
  if (!commitMutation) return false;
  const anim = positionAnimation(animations);
  if (!anim) return false;
  await commitMutation(
    selection,
    {
      type: "update-properties",
      animationId: anim.id,
      properties: { translateX: offset.x, translateY: offset.y },
    },
    {
      label: "Move anime.js layer",
      softReload: true,
      coalesceKey: `animejs:position:${anim.id}`,
    },
  );
  return true;
}

export async function tryAnimeResizeIntercept(
  selection: DomEditSelection,
  size: { width: number; height: number },
  animations: GsapAnimation[],
  commitMutation: CommitMutation | null,
): Promise<boolean> {
  if (!commitMutation) return false;
  const anim =
    animeAnimations(animations).find((candidate) => candidate.propertyGroup === "size") ??
    animeAnimations(animations).find(
      (candidate) => "width" in candidate.properties || "height" in candidate.properties,
    ) ??
    null;
  if (!anim) return false;
  await commitMutation(
    selection,
    {
      type: "update-properties",
      animationId: anim.id,
      properties: { width: Math.round(size.width), height: Math.round(size.height) },
    },
    { label: "Resize anime.js layer", softReload: true, coalesceKey: `animejs:size:${anim.id}` },
  );
  return true;
}

export async function tryAnimeRotationIntercept(
  selection: DomEditSelection,
  angle: number,
  animations: GsapAnimation[],
  commitMutation: CommitMutation | null,
): Promise<boolean> {
  if (!commitMutation) return false;
  const anim =
    animeAnimations(animations).find((candidate) => candidate.propertyGroup === "rotation") ??
    animeAnimations(animations).find((candidate) => "rotate" in candidate.properties) ??
    null;
  if (!anim) return false;
  await commitMutation(
    selection,
    { type: "update-property", animationId: anim.id, property: "rotate", value: Math.round(angle) },
    { label: "Rotate anime.js layer", softReload: true },
  );
  return true;
}
