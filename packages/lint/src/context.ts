import { mappedHtmlSource, sourcePosition, type SourceLocation } from "./sourceCoordinates";
import type { HyperframeLintFinding, HyperframeLinterOptions } from "./types";
import { parseHtmlStructure, findRootTag, collectCompositionIds, readDecodedAttr } from "./utils";
import type { OpenTag, ExtractedBlock } from "./utils";

export type { OpenTag, ExtractedBlock };

export type LintContext = {
  locate: (block: ExtractedBlock, offset: number | undefined) => SourceLocation;
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
  const mapped = mappedHtmlSource(rawSource);
  let source = mapped.source;
  let sourceStart = 0;
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
    sourceStart = template.index + template.raw.length;
    source = source.slice(sourceStart, template.closeIndex);
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
      file: style.file ?? style.href,
    })),
  ];
  const scripts = structure.scripts;
  const compositionIds = collectCompositionIds(tags);
  const rootTag = findRootTag(source, tags);
  const rootCompositionId = readDecodedAttr(rootTag?.raw || "", "data-composition-id");

  const locate = (block: ExtractedBlock, offset: number | undefined): SourceLocation => {
    if (offset === undefined || offset < 0 || offset > block.content.length) return {};
    if (block.index === -1) return sourcePosition(block.content, offset, block.file);
    if (block.contentStart === undefined) return {};
    const originalOffset = mapped.originalOffset(sourceStart + block.contentStart + offset);
    return originalOffset === undefined
      ? {}
      : sourcePosition(rawSource, originalOffset, options.filePath);
  };
  return {
    locate,
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
