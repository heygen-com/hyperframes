/** Linkedom keeps template contents in a DocumentFragment that is not part of
 * the document query tree. Project-level rules must still see elements inside
 * templates (sub-composition shells wrap their root in one), so walk each
 * template's content recursively without falling back to regex parsing. */
export function querySelectorAllIncludingTemplates(root: ParentNode, selector: string): Element[] {
  const matches: Element[] = [...root.querySelectorAll(selector)];
  for (const template of root.querySelectorAll("template")) {
    const content = (template as HTMLTemplateElement).content;
    if (content) matches.push(...querySelectorAllIncludingTemplates(content, selector));
  }
  return matches;
}
