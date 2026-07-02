import type { HyperframeLintFinding, HyperframeLinterOptions } from "./types";
import {
  extractBlocks,
  extractOpenTags,
  findRootTag,
  collectCompositionIds,
  readAttr,
  stripHtmlComments,
  STYLE_BLOCK_PATTERN,
  SCRIPT_BLOCK_PATTERN,
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
  const sourceWithoutTemplates = source.replace(
    /<template\b[^>]*>[\s\S]*?<\/template(?:\s[^>]*)?>/gi,
    " ",
  );
  const templateMatch = source.match(/<template[^>]*>([\s\S]*)<\/template>/i);
  // Some sub-composition files are HTML shells whose real root lives inside a
  // <template>. Keep nested templates intact when the visible document already
  // has a composition root; only unwrap when no root exists outside templates.
  if (templateMatch?.[1] && !findRootTag(sourceWithoutTemplates)) source = templateMatch[1];

  const tags = extractOpenTags(source);
  const styles = [
    ...extractBlocks(source, STYLE_BLOCK_PATTERN),
    ...(options.externalStyles ?? []).map((style) => ({
      attrs: `href="${style.href}"`,
      content: style.content,
      raw: style.content,
      index: -1,
    })),
  ];
  const scripts = extractBlocks(source, SCRIPT_BLOCK_PATTERN);
  const compositionIds = collectCompositionIds(tags);
  const rootTag = findRootTag(source);
  const rootCompositionId = readAttr(rootTag?.raw || "", "data-composition-id");

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
