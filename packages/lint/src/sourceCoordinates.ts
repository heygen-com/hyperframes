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

const countBelow = (sorted: readonly number[], offset: number): number => {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle]! < offset) low = middle + 1;
    else high = middle;
  }
  return low;
};

/** UTF-16 offsets, one-based lines/columns; CRLF counts as one newline. Finds the line breaks once per source. */
export function sourcePositions(source: string): (offset: number, file?: string) => SourceLocation {
  const breaks: number[] = [];
  const lineStarts: number[] = [];
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (code !== 10 && code !== 13) continue;
    breaks.push(i);
    if (code === 13 || source.charCodeAt(i - 1) !== 13) lineStarts.push(i);
  }
  return (offset, file) => {
    if (!Number.isInteger(offset) || offset < 0 || offset > source.length) return {};
    const below = countBelow(breaks, offset);
    return {
      ...(file ? { file } : {}),
      line: countBelow(lineStarts, offset) + 1,
      column: offset - (below > 0 ? breaks[below - 1]! : -1),
    };
  };
}

export function sourcePosition(source: string, offset: number, file?: string): SourceLocation {
  return sourcePositions(source)(offset, file);
}
