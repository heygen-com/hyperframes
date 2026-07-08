import { parseGsapScriptAcorn } from "@hyperframes/parsers/gsap-parser-acorn";
import { classifyGsapScript } from "./classifier.ts";
import { convertGsapScript } from "./converter.ts";
import { findGsapScriptBlock, replaceScriptBlock } from "./html.ts";
import type { TransformResult } from "./types.ts";

export type {
  ClassificationNote,
  CodemodClassification,
  CodemodStatus,
  RegistryFileReport,
  RegistryItemReport,
  RegistryReport,
  TransformResult,
} from "./types.ts";
export { classifyGsapScript } from "./classifier.ts";

export function transformHtml(html: string): TransformResult {
  const block = findGsapScriptBlock(html);
  if (block === null) {
    return {
      html,
      changed: false,
      classification: { status: "converted", reasons: [], warnings: [] },
    };
  }

  const parsed = parseGsapScriptAcorn(block.scriptText);
  const classification = classifyGsapScript(block.scriptText, parsed);
  if (classification.status === "manual") {
    return { html, changed: false, classification };
  }

  const script = preserveClosingIndent(
    convertGsapScript(block.scriptText, parsed),
    block.scriptText,
  );
  const nextHtml = replaceScriptBlock(html, block, script);
  return { html: nextHtml, changed: nextHtml !== html, classification };
}

// fallow-ignore-next-line complexity
function preserveClosingIndent(script: string, previousScript: string): string {
  const codeIndent = /\n([ \t]*)\S/.exec(previousScript)?.[1] ?? "";
  const closingIndent = /\n([ \t]*)$/.exec(previousScript)?.[1] ?? "";
  const lines = trimCommonIndent(script.trim().split("\n"));
  return `\n${lines.map((line) => `${codeIndent}${line}`).join("\n")}\n${closingIndent}`;
}

function trimCommonIndent(lines: string[]): string[] {
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0);
  const common = indents.length > 0 ? Math.min(...indents) : 0;
  return common > 0 ? lines.map((line) => line.slice(common)) : lines;
}
