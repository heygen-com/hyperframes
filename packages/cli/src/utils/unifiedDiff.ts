const CONTEXT = 3;
// Past this many changed lines Myers' trace grows quadratically; the middle is then shown as one replace.
const MAX_EDIT_LINES = 4000;

type Op = { kind: " " | "-" | "+"; text: string };

/** Lines of `text` with a marker on a last line that has no newline, so "A" and "A\n" differ as in git. */
function linesOf(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  else lines[lines.length - 1] += "\0";
  return lines;
}

const display = (line: string): string =>
  line.endsWith("\0") ? `${line.slice(0, -1)}\n\\ No newline at end of file` : line;

/** Edit script turning `a` into `b` (Myers), after the shared head and tail are set aside. */
function editScript(a: string[], b: string[]): Op[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  const same = (lines: string[]): Op[] => lines.map((text) => ({ kind: " ", text }));
  return [...same(a.slice(0, head)), ...middle(x, y), ...same(a.slice(a.length - tail))];
}

const replaceAll = (a: string[], b: string[]): Op[] => [
  ...a.map((text): Op => ({ kind: "-", text })),
  ...b.map((text): Op => ({ kind: "+", text })),
];

/** Whether diagonal `k` of round `d` is reached by moving down (an insert) from the one before it. */
const movesDown = (v: Int32Array, offset: number, k: number, d: number) =>
  k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!);

/** How far along diagonal `k` of round `d` the walk gets in `a`, taking every shared line it meets. */
function reach(v: Int32Array, offset: number, k: number, d: number, a: string[], b: string[]) {
  let x = movesDown(v, offset, k, d) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
  while (x < a.length && x - k < b.length && a[x] === b[x - k]) x++;
  return x;
}

function middle(a: string[], b: string[]): Op[] {
  if (a.length + b.length > MAX_EDIT_LINES) return replaceAll(a, b);
  const offset = a.length + b.length;
  const v = new Int32Array(2 * offset + 2);
  const trace: Int32Array[] = [];
  for (let d = 0; ; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const x = reach(v, offset, k, d, a, b);
      v[offset + k] = x;
      if (x >= a.length && x - k >= b.length) return backtrack(trace, a, b, offset, d);
    }
  }
}

/** Pushes the shared lines of `a` from index `x` back down to `to`, and returns `to`. */
function slideBack(ops: Op[], a: string[], x: number, to: number) {
  for (; x > to; x--) ops.push({ kind: " ", text: a[x - 1]! });
  return to;
}

function backtrack(trace: Int32Array[], a: string[], b: string[], offset: number, last: number) {
  const ops: Op[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = last; d > 0; d--) {
    const k = x - y;
    const down = movesDown(trace[d]!, offset, k, d);
    const prevX = trace[d]![offset + (down ? k + 1 : k - 1)]!;
    x = slideBack(ops, a, x, down ? prevX : prevX + 1);
    y = x - k;
    if (down) ops.push({ kind: "+", text: b[--y]! });
    else ops.push({ kind: "-", text: a[--x]! });
  }
  slideBack(ops, a, x, 0);
  return ops.reverse();
}

/** A git-style unified diff of one text file, `after` empty for a deleted file and `before` empty for an added one. */
export function unifiedDiff(path: string, before: string, after: string): string {
  const ops = editScript(linesOf(before), linesOf(after));
  const changed = ops.flatMap((op, index) => (op.kind === " " ? [] : [index]));
  if (changed.length === 0) return "";
  const out = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];
  let from = 0;
  while (from < changed.length) {
    let to = from;
    while (to + 1 < changed.length && changed[to + 1]! - changed[to]! <= 2 * CONTEXT + 1) to++;
    const start = Math.max(0, changed[from]! - CONTEXT);
    const end = Math.min(ops.length, changed[to]! + CONTEXT + 1);
    const hunk = ops.slice(start, end);
    const before0 = ops.slice(0, start).filter((op) => op.kind !== "+").length;
    const after0 = ops.slice(0, start).filter((op) => op.kind !== "-").length;
    const oldLen = hunk.filter((op) => op.kind !== "+").length;
    const newLen = hunk.filter((op) => op.kind !== "-").length;
    const range = (first: number, length: number) =>
      length === 1 ? `${first + 1}` : `${length === 0 ? first : first + 1},${length}`;
    out.push(`@@ -${range(before0, oldLen)} +${range(after0, newLen)} @@`);
    for (const op of hunk) out.push(`${op.kind}${display(op.text)}`);
    from = to + 1;
  }
  return out.join("\n");
}
