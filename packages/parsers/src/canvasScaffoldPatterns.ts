/** Linear-time readers for the canvas dimensions in scaffold CSS and metadata. */
export type CanvasScaffoldMatch = [string, string, string, string, string] & { index: number };

function capture(
  source: string,
  start: number,
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
): CanvasScaffoldMatch {
  const match: [string, string, string, string, string] = [
    source.slice(start, secondEnd),
    source.slice(start, firstStart),
    source.slice(firstStart, firstEnd),
    source.slice(firstEnd, secondStart),
    source.slice(secondStart, secondEnd),
  ];
  return Object.assign(match, { index: start });
}

function findDimensionPair(
  source: string,
  first: "width" | "height",
): [number, number, number, number] | null {
  const dimensions = /(width|height):\s*(\d+)px/gi;
  let firstValue: { start: number; end: number } | undefined;
  let token: RegExpExecArray | null;
  while ((token = dimensions.exec(source))) {
    if (!token[2]) continue;
    const start = token.index + token[0].length - token[2].length - 2;
    const end = start + token[2].length;
    if (token[1]?.toLowerCase() === first) {
      firstValue ??= { start, end };
    } else if (firstValue) {
      return [firstValue.start, firstValue.end, start, end];
    }
  }
  return null;
}

/** Scan each disjoint brace-delimited region once, never retry its suffix. */
function matchBody(source: string, first: "width" | "height"): CanvasScaffoldMatch | null {
  let start = 0;
  while (start < source.length) {
    const close = source.indexOf("}", start);
    const end = close < 0 ? source.length : close;
    const region = source.slice(start, end);
    const header = /html\s*,\s*body\s*\{/i.exec(region);
    if (header) {
      const contentStart = start + header.index + header[0].length;
      const pair = findDimensionPair(source.slice(contentStart, end), first);
      if (pair) {
        return capture(
          source,
          start + header.index,
          contentStart + pair[0],
          contentStart + pair[1],
          contentStart + pair[2],
          contentStart + pair[3],
        );
      }
    }
    start = end + 1;
  }
  return null;
}

export function matchHtmlBodyCssWidthFirst(source: string): CanvasScaffoldMatch | null {
  return matchBody(source, "width");
}

export function matchHtmlBodyCssHeightFirst(source: string): CanvasScaffoldMatch | null {
  return matchBody(source, "height");
}

/** Scan each tag-sized region once, including malformed unterminated tags. */
export function matchViewportMetaSize(source: string): CanvasScaffoldMatch | null {
  let start = 0;
  while (start < source.length) {
    const close = source.indexOf(">", start);
    const end = close < 0 ? source.length : close;
    const region = source.slice(start, end);
    const meta = region.search(/<meta/i);
    if (meta >= 0) {
      const names = /name=["']viewport["']/gi;
      names.lastIndex = meta + 5;
      const name = names.exec(region);
      if (name) {
        const content = /content=["']width=(\d+)(,\s*height=)(\d+)/gi;
        content.lastIndex = name.index + name[0].length;
        const size = content.exec(region);
        if (size && size[1] && size[2] && size[3]) {
          const firstStart = start + size.index + 15;
          const firstEnd = firstStart + size[1].length;
          const secondStart = firstEnd + size[2].length;
          return capture(
            source,
            start + meta,
            firstStart,
            firstEnd,
            secondStart,
            secondStart + size[3].length,
          );
        }
      }
    }
    start = end + 1;
  }
  return null;
}

/** Replace only the captured digits; preserve whitespace, units and surrounding text. */
export function replaceCanvasScaffoldSize(
  source: string,
  match: CanvasScaffoldMatch,
  first: number,
  second: number,
): string {
  return (
    source.slice(0, match.index) +
    match[1] +
    first +
    match[3] +
    second +
    source.slice(match.index + match[0].length)
  );
}
