import { isHtmlElement } from "@hyperframes/core/runtime/dom-realm";
import type { TimelineText } from "../store/timelineElement";
import {
  getCuratedComputedStyles,
  isEditableTextLeaf,
  isTextBearingTag,
} from "../../components/editor/domEditingDom";

/** A layer that is only text (a text tag whose children are all text leaves): its words and look. */
export function readTimelineText(el: Element): TimelineText | undefined {
  if (!isHtmlElement(el) || !isTextBearingTag(el.localName)) return undefined;
  const children = Array.from(el.children);
  if (!children.every((child) => isHtmlElement(child) && isEditableTextLeaf(child)))
    return undefined;
  const value = el.textContent?.replace(/\s+/g, " ").trim();
  if (!value) return undefined;
  const style = getCuratedComputedStyles(el);
  return {
    value,
    fontFamily: style["font-family"],
    fontWeight: style["font-weight"],
    color: style.color,
  };
}
