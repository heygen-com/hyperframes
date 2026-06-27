/**
 * Resolving the selected element and the animation whose path is editable.
 * Shared by the overlay and its diagnostics (kept here to avoid a circular
 * import between the two).
 */
import type { GsapAnimation } from "@hyperframes/parsers/gsap-parser";
import type { DomEditSelection } from "./domEditing";

export function selectorFor(sel: DomEditSelection | null): string | null {
  if (!sel) return null;
  if (sel.id) return `#${CSS.escape(sel.id)}`;
  return sel.selector ?? null;
}

/** The animation whose path is editable on-canvas: literal, statically resolved,
 *  and matching the rendered geometry kind. Returns null when the path can only
 *  be displayed (dynamic/helper tweens) — those nodes stay read-only. */
export function editableAnimationId(
  animations: GsapAnimation[],
  kind: "linear" | "arc",
): string | null {
  const ok = (a: GsapAnimation) =>
    !a.hasUnresolvedKeyframes && !a.hasUnresolvedSelector && !a.provenance;
  if (kind === "arc") return animations.find((a) => a.arcPath?.enabled && ok(a))?.id ?? null;
  const a = animations.find(
    (anim) =>
      anim.keyframes &&
      ok(anim) &&
      (anim.propertyGroup === "position" ||
        anim.keyframes.keyframes.some((k) => "x" in k.properties || "y" in k.properties)),
  );
  return a?.id ?? null;
}
