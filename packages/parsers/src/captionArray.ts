import { parseExpressionAt, type Expression, type Node, type ObjectExpression } from "acorn";

/**
 * Caption word arrays written into composition scripts, such as
 * `const TRANSCRIPT = [{ "text": "Hello", "start": 0.1, "end": 0.4 }, ...];`.
 *
 * Caption spans are built by script at runtime, so the array is the only place a word can carry a
 * link back to its narration line (`line: "l2"`). These helpers find the arrays, read their words,
 * and edit them in place: every element outside the edited range stays byte-identical.
 */

export const CAPTION_ARRAY_NAMES = ["script", "TRANSCRIPT"] as const;
export type CaptionArrayName = (typeof CAPTION_ARRAY_NAMES)[number];

export interface CaptionArrayWord {
  /** Source offsets of the element's object literal. */
  start: number;
  end: number;
  text: string;
  startTime: number;
  endTime: number;
  id?: string;
  line?: string;
  /** Source offsets of the start and end numbers, for shifting a word in place. */
  startTimeSpan: [number, number];
  endTimeSpan: [number, number];
}

export interface CaptionArrayLocation {
  name: CaptionArrayName;
  keyword: "const" | "let" | "var";
  /** Offsets of the `[` ... `]` array literal. */
  arrayStart: number;
  arrayEnd: number;
  words: CaptionArrayWord[];
  /** False when an element is not a plain object of literals; such arrays are read-only. */
  editable: boolean;
}

/** What a new caption word carries; extra keys (`id`, `line`, ...) are written as given. */
export interface CaptionWordInput {
  text: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

const DECLARATION = /\b(const|let|var)\s+(script|TRANSCRIPT)\s*=\s*\[/g;

type Literal = { value: string | number; span: [number, number] };

function literalOf(node: Node): Literal | null {
  if (node.type === "Literal") {
    const { value } = node as Node & { value: unknown };
    if (typeof value === "string" || typeof value === "number") {
      return { value, span: [node.start, node.end] };
    }
    return null;
  }
  if (node.type === "UnaryExpression") {
    const unary = node as Node & { operator: string; argument: Node };
    const inner = unary.operator === "-" ? literalOf(unary.argument) : null;
    if (inner && typeof inner.value === "number") {
      return { value: -inner.value, span: [node.start, node.end] };
    }
  }
  return null;
}

function keyOf(property: Node & { key: Node; computed: boolean }): string | null {
  if (property.computed) return null;
  if (property.key.type === "Identifier") return (property.key as Node & { name: string }).name;
  const literal = literalOf(property.key);
  return literal && typeof literal.value === "string" ? literal.value : null;
}

/** The object's keys and literal values, or null when any property is not a plain literal. */
function literalFields(node: ObjectExpression): Map<string, Literal> | null {
  const fields = new Map<string, Literal>();
  for (const property of node.properties) {
    const key = property.type === "Property" ? keyOf(property) : null;
    const value = key === null ? null : literalOf((property as { value: Node }).value);
    if (key === null || value === null) return null;
    fields.set(key, value);
  }
  return fields;
}

const stringField = (fields: Map<string, Literal>, key: string) => {
  const value = fields.get(key)?.value;
  return typeof value === "string" ? value : undefined;
};

const numberField = (fields: Map<string, Literal>, key: string) => {
  const field = fields.get(key);
  return typeof field?.value === "number" ? { value: field.value, span: field.span } : undefined;
};

/** The optional string tags a word carries: its `id` and its narration `line`. */
const wordTags = (fields: Map<string, Literal>) =>
  Object.fromEntries(
    (["id", "line"] as const).flatMap((key) => {
      const value = stringField(fields, key);
      return value === undefined ? [] : [[key, value]];
    }),
  ) as Pick<CaptionArrayWord, "id" | "line">;

function wordFrom(node: ObjectExpression, fields: Map<string, Literal>): CaptionArrayWord | null {
  const text = stringField(fields, "text");
  const start = numberField(fields, "start");
  const end = numberField(fields, "end");
  if (text === undefined || !start || !end) return null;
  return {
    start: node.start,
    end: node.end,
    text,
    startTime: start.value,
    endTime: end.value,
    ...wordTags(fields),
    startTimeSpan: start.span,
    endTimeSpan: end.span,
  };
}

function readWord(node: ObjectExpression): CaptionArrayWord | null {
  const fields = literalFields(node);
  return fields ? wordFrom(node, fields) : null;
}

function readArray(source: string, at: number): Omit<CaptionArrayLocation, "name" | "keyword"> {
  const array = parseExpressionAt(source, at, { ecmaVersion: "latest" }) as Expression;
  if (array.type !== "ArrayExpression") throw new Error("not an array");
  const words: CaptionArrayWord[] = [];
  let editable = true;
  for (const element of array.elements) {
    const word = element?.type === "ObjectExpression" ? readWord(element) : null;
    if (word) words.push(word);
    else editable = false;
  }
  return { arrayStart: array.start, arrayEnd: array.end, words, editable };
}

/** Every `script` / `TRANSCRIPT` caption array in `source` (a script or a whole HTML file). */
export function locateCaptionArrays(source: string): CaptionArrayLocation[] {
  const found: CaptionArrayLocation[] = [];
  for (const match of source.matchAll(DECLARATION)) {
    const at = match.index + match[0].length - 1;
    try {
      found.push({
        name: match[2] as CaptionArrayName,
        keyword: match[1] as CaptionArrayLocation["keyword"],
        ...readArray(source, at),
      });
    } catch {
      // Not a parseable literal array: leave it to the composition.
    }
  }
  return found;
}

/** The array a caller means: `name` when given, else `script` before `TRANSCRIPT`, as transcribe patches them. */
export function pickCaptionArray(
  arrays: CaptionArrayLocation[],
  name?: string,
): CaptionArrayLocation | undefined {
  if (name) return arrays.find((array) => array.name === name);
  return arrays.find((array) => array.name === "script") ?? arrays[0];
}

function formatNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** The text between two neighbouring elements, and the indent of the first one, as the array writes them. */
function arrayStyle(source: string, location: CaptionArrayLocation) {
  const [first, second] = location.words;
  const separator = first && second ? source.slice(first.end, second.start) : ", ";
  const lineStart = first ? source.lastIndexOf("\n", first.start) + 1 : 0;
  const indent = first ? source.slice(lineStart, first.start).replace(/\S.*$/, "") : "";
  const multiline = first ? source.slice(first.start, first.end).includes("\n") : false;
  const quotedKeys = first ? /^\{\s*"/.test(source.slice(first.start, first.end)) : true;
  return { separator, indent, multiline, quotedKeys };
}

function serializeWord(word: CaptionWordInput, style: ReturnType<typeof arrayStyle>): string {
  const entries = Object.entries(word)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      const name = style.quotedKeys ? JSON.stringify(key) : key;
      const text =
        typeof value === "number"
          ? formatNumber(value)
          : JSON.stringify(value).replace(/</g, "\\u003c");
      return `${name}: ${text}`;
    });
  if (!style.multiline)
    return style.quotedKeys ? `{${entries.join(", ")}}` : `{ ${entries.join(", ")} }`;
  const inner = entries.map((entry) => `${style.indent}  ${entry}`).join(",\n");
  return `{\n${inner}\n${style.indent}}`;
}

/**
 * Replaces `deleteCount` words starting at `index` with `words`, written in the array's own style.
 * Elements outside that range, and the text between them, are left exactly as they were.
 */
export function spliceCaptionWords(
  source: string,
  location: CaptionArrayLocation,
  index: number,
  deleteCount: number,
  words: CaptionWordInput[],
): string {
  if (!location.editable) throw new Error(`The ${location.name} array is not plain data`);
  const total = location.words.length;
  if (index < 0 || index > total || deleteCount < 0 || index + deleteCount > total) {
    throw new RangeError(`Cannot replace words ${index}..${index + deleteCount} of ${total}`);
  }
  const style = arrayStyle(source, location);
  const text = words.map((word) => serializeWord(word, style)).join(style.separator);
  const removed = location.words.slice(index, index + deleteCount);
  if (removed.length > 0) {
    const from = removed[0]!.start;
    const to = removed.at(-1)!.end;
    if (text) return source.slice(0, from) + text + source.slice(to);
    // Removing words outright: take one separator with them.
    const before = location.words[index - 1];
    const after = location.words[index + deleteCount];
    if (after) return source.slice(0, from) + source.slice(after.start);
    if (before) return source.slice(0, before.end) + source.slice(to);
    return source.slice(0, location.arrayStart + 1) + source.slice(location.arrayEnd - 1);
  }
  if (!text) return source;
  const next = location.words[index];
  if (next) return source.slice(0, next.start) + text + style.separator + source.slice(next.start);
  const previous = location.words[index - 1];
  if (previous)
    return source.slice(0, previous.end) + style.separator + text + source.slice(previous.end);
  return `${source.slice(0, location.arrayStart + 1)}${text}${source.slice(location.arrayEnd - 1)}`;
}

/** Moves every word from `fromIndex` on by `delta` seconds, rewriting only their start and end numbers. */
export function shiftCaptionWords(
  source: string,
  location: CaptionArrayLocation,
  fromIndex: number,
  delta: number,
): string {
  if (delta === 0) return source;
  if (!location.editable) throw new Error(`The ${location.name} array is not plain data`);
  const edits = location.words.slice(fromIndex).flatMap((word) => [
    { span: word.startTimeSpan, value: word.startTime + delta },
    { span: word.endTimeSpan, value: word.endTime + delta },
  ]);
  // Last offset first, so each edit leaves the offsets before it valid.
  edits.sort((a, b) => b.span[0] - a.span[0]);
  let out = source;
  for (const { span, value } of edits) {
    out = out.slice(0, span[0]) + formatNumber(value) + out.slice(span[1]);
  }
  return out;
}
