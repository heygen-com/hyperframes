import { EDITING_ELEMENT_HANDLE, type EditingElementHandle } from "./editingElement";

/** `keep-size` drops the drawn translate and keeps the drawn size.
 * An end naming an older `draft` than the element has does nothing. */
export type EditingDraftEnd =
  | { handle: EditingElementHandle; end: "keep" | "restore" }
  | { handle: EditingElementHandle; end: "keep" | "restore" | "keep-size"; draft: number };

/** `drafts` numbers each element still drawn, for the end that names its draft. */
export type EditingDraftReply = { drawn: number; drafts: Record<EditingElementHandle, number> };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === "[object Object]";

export function parseDraftEnd(value: unknown): EditingDraftEnd | null {
  if (!isRecord(value)) return null;
  const { handle, end, draft } = value;
  if (typeof handle !== "string" || !EDITING_ELEMENT_HANDLE.test(handle)) return null;
  const keys = Object.keys(value).sort().join();
  if (keys === "end,handle") return end === "keep" || end === "restore" ? { handle, end } : null;
  if (keys !== "draft,end,handle" || !Number.isSafeInteger(draft) || (draft as number) < 1)
    return null;
  return end === "keep" || end === "restore" || end === "keep-size"
    ? { handle, end, draft: draft as number }
    : null;
}
