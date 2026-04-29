import type { HyperframeLintFinding, HyperframeLinterOptions } from "./types";
import {
  extractBlocks,
  extractOpenTags,
  findRootTag,
  collectCompositionIds,
  readAttr,
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
  let source = rawSource;
  const templateMatch = source.match(/<template[^>]*>([\s\S]*)<\/template>/i);
  if (templateMatch?.[1]) source = templateMatch[1];

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
