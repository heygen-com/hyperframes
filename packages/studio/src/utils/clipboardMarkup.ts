import { markupOutsideAllowlist } from "@hyperframes/core/html-attr-safety";

/** Every clipboard write: only markup Studio itself read from the file it writes to skips the allowlist. */
export function refuseUnlistedMarkup(
  doc: Document,
  readFrom: string | null | undefined,
  writeTo: string | null,
): void {
  if (readFrom && readFrom === writeTo) return;
  if (markupOutsideAllowlist(doc.documentElement).length > 0) {
    throw new Error(
      "Couldn't paste: the copied element holds code or markup that can't be pasted here (a script, a handler, a style block or a link)",
    );
  }
}
