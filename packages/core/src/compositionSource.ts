export const COMPOSITION_SRC_ATTR = "data-composition-src";

export const CODE_LOADING_ATTRS: ReadonlySet<string> = new Set([COMPOSITION_SRC_ATTR]);

const COMPOSITION_FILE_ATTR = "data-composition-file";
export const SOURCE_HOST_ATTRS = [COMPOSITION_FILE_ATTR, COMPOSITION_SRC_ATTR] as const;

export const COMPOSITION_ROOT_ATTRS = [
  "data-composition-id",
  "data-hf-original-composition-id",
] as const;

/** Only the build may stamp data-composition-file: Studio writes an element's edits to the file it names, so a
 * mark authored in a file's markup would pick another file for them. Removes every one under root, templates too. */
export function dropAuthoredCompositionFiles(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll(`[${COMPOSITION_FILE_ATTR}], template`))) {
    el.removeAttribute(COMPOSITION_FILE_ATTR);
    const content = (el as { content?: ParentNode | null }).content;
    if (el.localName === "template" && content) dropAuthoredCompositionFiles(content);
  }
}
