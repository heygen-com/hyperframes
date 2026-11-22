import { markupOutsideAllowlist } from "@hyperframes/core/html-attr-safety";

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
