import type { HyperframeLintFinding } from "./types";
import { stripHtmlComments } from "./utils";

export type SourceLocation = Pick<HyperframeLintFinding, "file" | "line" | "column">;

/** Keep the existing fixpoint deletion semantics and map only retained UTF-16 units. */
export function mappedHtmlSource(original: string) {
  let offsets: Uint32Array | undefined;
  const source = stripHtmlComments(original, (ranges) => {
    const previous = offsets;
    const length =
      (previous?.length ?? original.length + 1) - ranges.reduce((n, [a, b]) => n + b - a, 0);
    offsets = new Uint32Array(length);
    let target = 0;
    let start = 0;
    const spans: Array<[number, number]> = [
      ...ranges,
      [previous ? previous.length : original.length + 1, 0],
    ];
    for (const [a, b] of spans) {
      for (let i = start; i < a; i++) offsets[target++] = previous ? previous[i]! : i;
      start = b;
    }
  });
  return { source, originalOffset: (index: number) => (offsets ? offsets[index] : index) };
}

/** UTF-16 offsets, one-based lines/columns; CRLF counts as one newline. */
export function sourcePosition(source: string, offset: number, file?: string): SourceLocation {
  if (!Number.isInteger(offset) || offset < 0 || offset > source.length) return {};
  const before = source.slice(0, offset);
  return {
    ...(file ? { file } : {}),
    line: before.split(/\r\n|\r|\n/).length,
    column: offset - Math.max(before.lastIndexOf("\n"), before.lastIndexOf("\r")),
  };
}
