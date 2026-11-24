/**
 * Grade groups: one colour grade for a whole lane. An inert `<hf-color-group>`
 * holds the grade in `data-color-grading`; each `<video>`, `<img>` or `<canvas>`
 * joins with `data-color-group` naming the group's id. Membership is held by the
 * member, as with audio groups, so a camera cut into hundreds of clips is graded
 * by editing one attribute.
 */

import { COLOR_GROUP_ATTR, COLOR_GROUP_TAG } from "@hyperframes/parsers/color-grading-contract";
import { HF_COLOR_GRADING_ATTR, HF_COLOR_GRADING_SOURCE_TAGS } from "./colorGrading";

export const HF_COLOR_GROUP_TAG = COLOR_GROUP_TAG;
export const HF_COLOR_GROUP_ATTR = COLOR_GROUP_ATTR;

type GroupLookupRoot = Pick<Document, "getElementById"> | null | undefined;

/**
 * The group a gradable element belongs to, or null. `data-color-group=""` is no
 * group. Tolerant of partial `Element` doubles, as `audioGroupOf` is.
 */
export function colorGroupOf(el: Element): string | null {
  if (typeof el.tagName !== "string" || typeof el.getAttribute !== "function") return null;
  if (!(HF_COLOR_GRADING_SOURCE_TAGS as readonly string[]).includes(el.tagName.toLowerCase())) {
    return null;
  }
  return el.getAttribute(HF_COLOR_GROUP_ATTR) || null;
}

/**
 * The `<hf-color-group>` for an id, or null. Ids are unique only per
 * composition file, so a member's own composition is searched first, as audio
 * groups pair per composition; then the document. Tag-checked so an unrelated
 * element sharing the id is never read as a lane's grade.
 */
export function resolveColorGroupElement(
  root: GroupLookupRoot,
  groupId: string,
  member?: Element,
): Element | null {
  const scope =
    typeof member?.closest === "function" ? member.closest("[data-composition-id]") : null;
  const scoped = scope
    ? Array.from(scope.getElementsByTagName(HF_COLOR_GROUP_TAG)).find((g) => g.id === groupId)
    : undefined;
  if (scoped) return scoped;
  const el = root?.getElementById(groupId) ?? null;
  return el?.tagName.toLowerCase() === HF_COLOR_GROUP_TAG ? el : null;
}

/**
 * The grade that applies to `el`: its own `data-color-grading` when present,
 * else its group element's, else null. A group id with no element is ungrouped.
 */
export function effectiveColorGrading(el: Element, root: GroupLookupRoot): string | null {
  const own = el.getAttribute(HF_COLOR_GRADING_ATTR);
  if (own !== null) return own;
  const groupId = colorGroupOf(el);
  if (!groupId) return null;
  return resolveColorGroupElement(root, groupId, el)?.getAttribute(HF_COLOR_GRADING_ATTR) ?? null;
}

/**
 * Make `<hf-color-group>` inert, once per document: an unknown custom element
 * still makes a box, and a grade must not shift authored layout. `contents`, so
 * anything nested inside one still renders; `!important` because an author rule
 * can outrank a bare type selector.
 */
export function ensureColorGroupInertStyle(doc: Document): void {
  const styleId = "__hf-color-group-inert";
  if (!doc?.head || doc.getElementById(styleId)) return;
  const style = doc.createElement("style");
  style.id = styleId;
  style.textContent = `${HF_COLOR_GROUP_TAG}{display:contents!important}`;
  doc.head.appendChild(style);
}
