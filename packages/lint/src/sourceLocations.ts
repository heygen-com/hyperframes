import { Parser } from "htmlparser2";
import type { HyperframeLintFinding } from "./types";
import { parseHtmlStructure, readDecodedAttr } from "./utils";

type Location = Pick<HyperframeLintFinding, "line" | "column">;

function normalized(source: string): { text: string; offsets: number[] } {
  // An array, not +=: V8 flattens a += string on every endsWith, which made this quadratic.
  const chars: string[] = [];
  const offsets: number[] = [];
  let lastWasSpace = false;
  for (let i = 0; i < source.length; i++) {
    const isSpace = /\s/.test(source[i]!);
    if (isSpace && lastWasSpace) continue;
    chars.push(isSpace ? " " : source[i]!);
    offsets.push(i);
    lastWasSpace = isSpace;
  }
  return { text: chars.join(""), offsets };
}

/** Resolve against original bytes, not the comment-stripped/template-unwrapped rule input.
 * Ambiguous snippets/IDs deliberately have no coordinates rather than pointing at the wrong copy. */
export function createSourceLocator(source: string): (finding: HyperframeLintFinding) => Location {
  const tags = parseHtmlStructure(source).tags;
  const searchable = source.split("");
  const parser = new Parser({
    oncomment() {
      searchable.fill("\0", parser.startIndex, parser.endIndex + 1);
    },
  });
  parser.write(source);
  parser.end();
  const normalizedSource = normalized(searchable.join(""));
  const at = (offset: number): Location => {
    const before = source.slice(0, offset);
    return {
      line: before.split(/\r\n|\r|\n/).length,
      column: offset - Math.max(before.lastIndexOf("\n"), before.lastIndexOf("\r")),
    };
  };
  return (finding) => {
    if (finding.line !== undefined) return { line: finding.line, column: finding.column };
    if (finding.snippet) {
      const offset = snippetOffset(normalizedSource, finding.snippet);
      return offset === undefined ? {} : at(offset);
    }
    const id = finding.elementId ?? /^#([\w-]+)$/.exec(finding.selector ?? "")?.[1];
    if (!id) return {};
    const matches = tags.filter((tag) => readDecodedAttr(tag.raw, "id") === id);
    return matches.length === 1 ? at(matches[0]!.index) : {};
  };
}

export function sourceLocationFor(source: string, finding: HyperframeLintFinding): Location {
  return createSourceLocator(source)(finding);
}

function snippetOffset(source: ReturnType<typeof normalized>, snippet: string): number | undefined {
  const needle = snippet
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.\.\.$/, "");
  if (!needle) return undefined;
  const index = source.text.indexOf(needle);
  if (index < 0 || source.text.indexOf(needle, index + 1) >= 0) return undefined;
  return source.offsets[index];
}
