import type { HyperframeLintFinding, HyperframeLinterOptions } from "./types";
import { findRootTag, collectCompositionIds, readAttr, resolveRootStructure } from "./utils";
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
  isTemplateWrappedRoot: boolean;
  options: HyperframeLinterOptions;
};

// Re-export for convenience so rule modules only need one import for the finding type
export type { HyperframeLintFinding };

export function buildLintContext(html: string, options: HyperframeLinterOptions = {}): LintContext {
  const rawSource = html || "";
  const { source, structure, isTemplateWrappedRoot } = resolveRootStructure(rawSource);

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
    isTemplateWrappedRoot,
    options,
  };
}
