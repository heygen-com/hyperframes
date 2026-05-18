import postcss from "postcss";
import type { DomEditSelection } from "../components/editor/domEditing";
import { escapeCssIdentifier } from "../components/editor/domEditingDom";

export interface AuthoredCssRuleMatch {
  selectorText: string;
  ruleText: string;
  start: number;
  end: number;
  sourceStart: number;
  continuationIndent: string;
}

interface StyleBlockMatch {
  content: string;
  contentStart: number;
}

function extractSimpleSelectorTokens(selector: string): string[] {
  const tokens: string[] = [];
  const tokenRegex = /[.#](?:\\.|[A-Za-z0-9_-])+/g;
  for (const match of selector.matchAll(tokenRegex)) {
    const token = match[0]?.trim();
    if (token) tokens.push(token);
  }
  return tokens;
}

function selectorMatchesCandidates(selector: string, candidateSet: ReadonlySet<string>): boolean {
  for (const token of extractSimpleSelectorTokens(selector)) {
    if (candidateSet.has(token)) return true;
  }
  return false;
}

function collectStyleBlocks(html: string): StyleBlockMatch[] {
  const matches: StyleBlockMatch[] = [];
  const styleBlockRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;

  for (const match of html.matchAll(styleBlockRegex)) {
    const fullMatch = match[0];
    const cssContent = match[1];
    if (typeof fullMatch !== "string" || typeof cssContent !== "string") continue;
    const matchIndex = match.index ?? -1;
    if (matchIndex < 0) continue;
    const contentOffsetInMatch = fullMatch.indexOf(cssContent);
    if (contentOffsetInMatch < 0) continue;
    matches.push({
      content: cssContent,
      contentStart: matchIndex + contentOffsetInMatch,
    });
  }

  return matches;
}

function buildLineOffsets(input: string): number[] {
  const offsets = [0];
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] === "\n") offsets.push(index + 1);
  }
  return offsets;
}

function getOffsetFromPosition(
  lineOffsets: number[],
  position: { line: number; column: number } | undefined,
): number | null {
  if (!position) return null;
  const lineStart = lineOffsets[position.line - 1];
  if (lineStart == null) return null;
  return lineStart + position.column - 1;
}

function buildRuleMatch(
  cssContent: string,
  contentStart: number,
  selectorText: string,
  startOffset: number,
  endOffsetInclusive: number,
): AuthoredCssRuleMatch | null {
  const ruleText = cssContent.slice(startOffset, endOffsetInclusive + 1);
  return {
    selectorText,
    ruleText,
    start: contentStart + startOffset,
    end: contentStart + endOffsetInclusive + 1,
    sourceStart: contentStart + startOffset,
    continuationIndent: measureAuthoredCssRuleContinuationIndent(ruleText),
  };
}

export function measureAuthoredCssRuleContinuationIndent(ruleText: string): string {
  const lines = ruleText.split("\n").slice(1);
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  if (nonEmptyLines.length === 0) return "";

  const indents = nonEmptyLines.map((line) => (line.match(/^[\t ]*/) ?? [""])[0]);
  let prefix = indents[0] ?? "";
  for (const indent of indents.slice(1)) {
    while (!indent.startsWith(prefix) && prefix.length > 0) {
      prefix = prefix.slice(0, -1);
    }
    if (prefix.length === 0) return "";
  }
  return prefix;
}

export function getAuthoredCssSelectorCandidates(selection: DomEditSelection): string[] {
  const candidates: string[] = [];
  const idValue = selection.element.id.trim();
  if (idValue) {
    candidates.push(`#${escapeCssIdentifier(idValue)}`);
  }

  for (const className of Array.from(selection.element.classList)) {
    const trimmed = className.trim();
    if (!trimmed) continue;
    candidates.push(`.${escapeCssIdentifier(trimmed)}`);
  }

  return Array.from(new Set(candidates));
}

export function findFirstAuthoredCssRuleInHtml(
  html: string,
  selectors: readonly string[],
): AuthoredCssRuleMatch | null {
  return findAuthoredCssRulesInHtml(html, selectors)[0] ?? null;
}

export function findAuthoredCssRulesInHtml(
  html: string,
  selectors: readonly string[],
): AuthoredCssRuleMatch[] {
  if (selectors.length === 0) return [];
  const selectorSet = new Set(selectors.map((selector) => selector.trim()).filter(Boolean));
  const matches: AuthoredCssRuleMatch[] = [];

  for (const styleBlock of collectStyleBlocks(html)) {
    let root: postcss.Root;
    try {
      root = postcss.parse(styleBlock.content);
    } catch {
      continue;
    }

    const lineOffsets = buildLineOffsets(styleBlock.content);
    root.walkRules((rule) => {
      const selectorItems = rule.selectors.map((selector) => selector.trim());
      if (!selectorItems.some((selector) => selectorMatchesCandidates(selector, selectorSet))) {
        return;
      }
      const startOffset = getOffsetFromPosition(lineOffsets, rule.source?.start);
      const endOffsetInclusive = getOffsetFromPosition(lineOffsets, rule.source?.end);
      if (startOffset == null || endOffsetInclusive == null) return;

      const nextMatch = buildRuleMatch(
        styleBlock.content,
        styleBlock.contentStart,
        rule.selector.trim(),
        startOffset,
        endOffsetInclusive,
      );
      if (!nextMatch) return;
      matches.push(nextMatch);
    });
  }

  return matches.sort((a, b) => a.sourceStart - b.sourceStart);
}

export function replaceAuthoredCssRuleText(
  html: string,
  match: AuthoredCssRuleMatch,
  nextRuleText: string,
): string {
  return `${html.slice(0, match.start)}${nextRuleText}${html.slice(match.end)}`;
}

export function normalizeAuthoredCssRuleText(match: AuthoredCssRuleMatch): string {
  if (!match.continuationIndent) return match.ruleText;
  const [firstLine = "", ...rest] = match.ruleText.split("\n");
  const normalizedRest = rest.map((line) =>
    line.startsWith(match.continuationIndent) ? line.slice(match.continuationIndent.length) : line,
  );
  return [firstLine, ...normalizedRest].join("\n");
}

export function denormalizeAuthoredCssRuleText(
  editedRuleText: string,
  match: AuthoredCssRuleMatch,
): string {
  if (!match.continuationIndent) return editedRuleText;
  const [firstLine = "", ...rest] = editedRuleText.split("\n");
  const restoredRest = rest.map((line) =>
    line.trim().length === 0
      ? line
      : `${match.continuationIndent}${
          line.startsWith(match.continuationIndent)
            ? line.slice(match.continuationIndent.length)
            : line
        }`,
  );
  return [firstLine, ...restoredRest].join("\n");
}
