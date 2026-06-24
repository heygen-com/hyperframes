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
  // Strip HTML comments before scanning. Use a fixpoint loop, not a single global
  // pass: removing one comment can re-form a marker from a nested/partial pair
  // (e.g. <!--<!---->-->), which one pass misses — CodeQL flags the lone replace
  // as incomplete multi-character sanitization. The loop terminates: each pass that
  // changes `source` removed a comment, and a pass that matches nothing leaves it
  // equal to `prev`. Mirrors the skill captions.mjs fixpoint strip.
  let source = rawSource;
  for (let prev = ""; prev !== source; ) {
    prev = source;
    source = source.replace(/<!--[\s\S]*?-->/g, "");
  }
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
