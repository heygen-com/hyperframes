import {
  captureStudioPathOffset,
  restoreStudioPathOffset,
  type StudioPathOffsetSnapshot,
} from "./manualEdits";
import { getOffsetDragGsap, type ManualOffsetDragMember } from "./manualOffsetDrag";
import type { StudioEditRevert } from "../../utils/studioPendingEdits";

interface MemberPosition {
  offset: StudioPathOffsetSnapshot;
  gsap: { x: number; y: number } | null;
}

function readMemberPosition(member: ManualOffsetDragMember): MemberPosition {
  const gsap = member.plainTranslate ? null : getOffsetDragGsap(member.element);
  return {
    offset: captureStudioPathOffset(member.element),
    gsap: gsap && {
      x: Number(gsap.getProperty(member.element, "x")),
      y: Number(gsap.getProperty(member.element, "y")),
    },
  };
}

function showMemberPosition(member: ManualOffsetDragMember, position: MemberPosition): void {
  restoreStudioPathOffset(member.element, position.offset);
  if (position.gsap) getOffsetDragGsap(member.element)?.set(member.element, { ...position.gsap });
}

/** Undo's live revert of a move: its members at gesture start. */
export function manualOffsetMoveRevert(members: ManualOffsetDragMember[]): StudioEditRevert {
  return () => {
    const shown = members.map(readMemberPosition);
    for (const member of members) {
      showMemberPosition(member, {
        offset: member.initialPathOffset,
        gsap: member.plainTranslate ? null : member.baseGsap,
      });
    }
    return () => members.forEach((member, i) => showMemberPosition(member, shown[i]!));
  };
}

export interface StudioElementLook {
  style: string | null;
  gsap: Record<string, number> | null;
}

const GSAP_LOOK_PROPS = ["x", "y", "rotation", "scaleX", "scaleY"];

/** Reads GSAP only for an element it owns: reading a plain one makes GSAP bake its CSS into a transform. */
export function readElementLook(element: HTMLElement, gsapOwned: boolean): StudioElementLook {
  const gsap = gsapOwned ? getOffsetDragGsap(element) : null;
  return {
    style: element.getAttribute("style"),
    gsap:
      gsap &&
      Object.fromEntries(
        GSAP_LOOK_PROPS.map((prop) => [prop, Number(gsap.getProperty(element, prop))]),
      ),
  };
}

function showElementLook(element: HTMLElement, look: StudioElementLook): void {
  if (look.style === null) element.removeAttribute("style");
  else element.setAttribute("style", look.style);
  if (look.gsap) getOffsetDragGsap(element)?.set(element, { ...look.gsap });
}

/** Undo's live revert of a resize or rotate: the element as it looked at press. */
export function elementLookRevert(
  element: HTMLElement,
  start: StudioElementLook,
): StudioEditRevert {
  return () => {
    const shown = readElementLook(element, start.gsap !== null);
    showElementLook(element, start);
    return () => showElementLook(element, shown);
  };
}
