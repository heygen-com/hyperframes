import { markupOutsideAllowlist } from "@hyperframes/core/html-attr-safety";
import { knownCompositionFile } from "../components/editor/domEditingDom";

export function copiedFile(
  claimed: string | undefined,
  activeCompositionPath: string | null,
): string {
  const file = knownCompositionFile(claimed, activeCompositionPath);
  if (file) return file;
  throw new Error("Couldn't use this element: its file isn't one of this project's compositions.");
}

/** Every clipboard write: only markup Studio itself read from the file it writes to skips the allowlist. */
export function refuseUnlistedMarkup(
  doc: Document,
  readFrom: string | null | undefined,
  writeTo: string | null,
): void {
  if (readFrom && readFrom === writeTo) return;
  if (markupOutsideAllowlist(doc.documentElement).length > 0) {
    throw new Error("Couldn't paste: the copied element holds markup that can't be pasted here.");
  }
}
