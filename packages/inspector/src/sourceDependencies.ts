import { parse } from "acorn";
import { analyze } from "eslint-scope";

export interface SourceRange {
  start: number;
  end: number;
}

export function sourceDependencies(text: string): (range: SourceRange) => SourceRange[] {
  try {
    const ast = parse(text, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowReturnOutsideFunction: true,
      ranges: true,
    });
    const scopes = analyze(ast as Parameters<typeof analyze>[0], {
      ecmaVersion: 2022,
      sourceType: "module",
      optimistic: false,
    });
    const references = scopes.scopes.flatMap((scope) =>
      scope.references.flatMap((reference) => {
        const location = reference.identifier.range;
        if (!reference.isRead() || !location) return [];
        const definitions = (reference.resolved?.defs ?? []).flatMap((definition) => {
          const node =
            definition.type === "Variable"
              ? definition.parent
              : definition.type === "FunctionName"
                ? definition.node
                : null;
          return node?.range ? [{ start: node.range[0], end: node.range[1] }] : [];
        });
        return definitions.length ? [{ start: location[0], end: location[1], definitions }] : [];
      }),
    );
    return (range) => {
      const pending = [range];
      const found = new Map<string, SourceRange>();
      for (let index = 0; index < pending.length; index++) {
        const current = pending[index];
        for (const reference of references) {
          if (reference.start < current.start || reference.end > current.end) continue;
          for (const { start, end } of reference.definitions) {
            if (start >= range.start && end <= range.end) continue;
            const key = `${start}:${end}`;
            if (found.has(key)) continue;
            const dependency = { start, end };
            found.set(key, dependency);
            pending.push(dependency);
          }
        }
      }
      return [...found.values()].sort((a, b) => a.start - b.start);
    };
  } catch {
    return () => [];
  }
}
