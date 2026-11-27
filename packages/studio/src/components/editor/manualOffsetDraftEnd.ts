import { selectorFromSelection } from "../../hooks/gsapShared";
import type { ManualOffsetDragMember } from "./manualOffsetDrag";
import {
  armPreviewDraftEnd,
  endPreviewDraft,
  endPreviewDraftKeepingSizeOnly,
} from "./previewDrafts";

export function armDraftEndOnRelease(member: ManualOffsetDragMember): void {
  if (!member.plainTranslate)
    armPreviewDraftEnd(member.element, selectorFromSelection(member.selection));
}

// Drop the draft's `translate: none` so the soft reload starts clean (#1673). When GSAP owns
// the position it folded any translate into its transform, so one still showing applies twice.
export function settleDraftTranslate(element: HTMLElement, gsapOwnsPosition: boolean): void {
  if (element.style.getPropertyValue("translate") === "none") {
    element.style.removeProperty("translate");
  }
  if (!gsapOwnsPosition) return;
  const view = element.ownerDocument.defaultView;
  const underneath = view?.getComputedStyle(element).getPropertyValue("translate");
  if (underneath && underneath !== "none") element.style.setProperty("translate", "none");
}

export function endDraftKeepingWhatTheSaveWrites(member: ManualOffsetDragMember): void {
  if (member.plainTranslate) endPreviewDraft(member.element, "keep");
  else if (member.sizeSavedAsScale) endPreviewDraft(member.element, "restore");
  else endPreviewDraftKeepingSizeOnly(member.element);
}
