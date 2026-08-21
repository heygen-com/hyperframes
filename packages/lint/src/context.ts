import type { HyperframeLintFinding, HyperframeLinterOptions } from "./types";
import {
  parseHtmlStructure,
  findRootTag,
  collectCompositionIds,
  readDecodedAttr,
  stripHtmlComments,
} from "./utils";
import type { OpenTag, ExtractedBlock } from "./utils";

export type { OpenTag, ExtractedBlock };

export type LintContext = {
  source: string;
  rawSource: string;
  tags: OpenTag[];
  styles: ExtractedBlock[];
  scripts: ExtractedBlock[];
  compositionIds: Set<string>;
  rootTag: OpenTag | null;
  rootCompositionId: string | null;
  options: HyperframeLinterOptions;
};

// Re-export for convenience so rule modules only need one import for the finding type
export type { HyperframeLintFinding };

export function buildLintContext(html: string, options: HyperframeLinterOptions = {}): LintContext {
  const rawSource = html || "";
  // Strip HTML comments before scanning so a commented-out <template> or tag can't
  // hijack the boundary match below. Linear + fixpoint (see stripHtmlComments) to
  // stay ReDoS-free and catch markers that re-form when a comment is removed.
  let source = stripHtmlComments(rawSource);
  const initialStructure = parseHtmlStructure(source);
  const templateTags = initialStructure.tags.filter(
    (tag) => tag.name === "template" && tag.closeIndex != null,
  );
  let sourceWithoutTemplates = source;
  for (const template of [...templateTags].reverse()) {
    const end = template.endIndex ?? template.index;
    sourceWithoutTemplates =
      sourceWithoutTemplates.slice(0, template.index) +
      " ".repeat(end - template.index) +
      sourceWithoutTemplates.slice(end);
  }
  // Some sub-composition files are HTML shells whose real root lives inside a
  // <template>. Keep nested templates intact when the visible document already
  // has a composition root; only unwrap when no root exists outside templates.
  const template = templateTags[0];
  let structure = initialStructure;
  if (template && !findRootTag(sourceWithoutTemplates)) {
    source = source.slice(template.index + template.raw.length, template.closeIndex);
    structure = parseHtmlStructure(source);
  }

  const tags = structure.tags;
  const styles = [
    ...structure.styles,
    ...(options.externalStyles ?? []).map((style) => ({
      attrs: `href="${style.href}"`,
      content: style.content,
      raw: style.content,
      index: -1,
    })),
  ];
  const scripts = structure.scripts;
  const compositionIds = collectCompositionIds(tags);
  const rootTag = findRootTag(source, tags);
  const rootCompositionId = readDecodedAttr(rootTag?.raw || "", "data-composition-id");

  return {
    source,
    rawSource,
    tags,
    styles,
    scripts,
    compositionIds,
    rootTag,
    rootCompositionId,
    options,
  };
}
