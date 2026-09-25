export function normalizeDomString(value: string): string {
  const parts: string[] = [];
  let unchangedStart = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
      } else {
        parts.push(value.slice(unchangedStart, index), "\ufffd");
        unchangedStart = index + 1;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      parts.push(value.slice(unchangedStart, index), "\ufffd");
      unchangedStart = index + 1;
    }
  }
  if (parts.length === 0) return value;
  parts.push(value.slice(unchangedStart));
  return parts.join("");
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(normalizeDomString(value)).byteLength;
}

export function canonicalStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(normalizeDomString(value));
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON numbers must be finite");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(normalizeDomString(key))}:${canonicalStringify(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError(`Unsupported canonical JSON value: ${typeof value}`);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestInput.buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export type JsonGrammarScanResult =
  | { ok: true }
  | { ok: false; code: "malformed" }
  | { ok: false; code: "duplicate-key"; key: string };

class DuplicateKeyError extends Error {
  constructor(readonly key: string) {
    super(key);
  }
}

class JsonGrammarScanner {
  private index = 0;

  constructor(private readonly source: string) {}

  scan(): void {
    this.skipWhitespace();
    this.value();
    this.skipWhitespace();
    if (this.index !== this.source.length) throw new SyntaxError("Trailing JSON data");
  }

  private value(): void {
    this.skipWhitespace();
    const character = this.source[this.index];
    if (character === "{") this.object();
    else if (character === "[") this.array();
    else if (character === '"') this.string();
    else if (character === "t") this.keyword("true");
    else if (character === "f") this.keyword("false");
    else if (character === "n") this.keyword("null");
    else this.number();
  }

  private object(): void {
    this.index += 1;
    const keys = new Set<string>();
    this.skipWhitespace();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return;
    }
    while (true) {
      this.skipWhitespace();
      if (this.source[this.index] !== '"') throw new SyntaxError("Object key expected");
      const key = this.string();
      if (keys.has(key)) throw new DuplicateKeyError(key);
      keys.add(key);
      this.skipWhitespace();
      if (this.source[this.index] !== ":") throw new SyntaxError("Colon expected");
      this.index += 1;
      this.value();
      this.skipWhitespace();
      const separator = this.source[this.index];
      this.index += 1;
      if (separator === "}") return;
      if (separator !== ",") throw new SyntaxError("Object separator expected");
    }
  }

  private array(): void {
    this.index += 1;
    this.skipWhitespace();
    if (this.source[this.index] === "]") {
      this.index += 1;
      return;
    }
    while (true) {
      this.value();
      this.skipWhitespace();
      const separator = this.source[this.index];
      this.index += 1;
      if (separator === "]") return;
      if (separator !== ",") throw new SyntaxError("Array separator expected");
    }
  }

  private string(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      if (character === '"') {
        this.index += 1;
        return JSON.parse(this.source.slice(start, this.index)) as string;
      }
      if (character === "\\") this.index += 1;
      this.index += 1;
    }
    throw new SyntaxError("Unterminated string");
  }

  private keyword(keyword: string): void {
    if (this.source.slice(this.index, this.index + keyword.length) !== keyword) {
      throw new SyntaxError("Invalid JSON keyword");
    }
    this.index += keyword.length;
  }

  private number(): void {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      this.source.slice(this.index),
    );
    if (!match) throw new SyntaxError("Invalid JSON value");
    this.index += match[0].length;
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.source[this.index] ?? "")) this.index += 1;
  }
}

export function scanJsonGrammar(source: string): JsonGrammarScanResult {
  try {
    new JsonGrammarScanner(source).scan();
    return { ok: true };
  } catch (error) {
    if (error instanceof DuplicateKeyError) {
      return { ok: false, code: "duplicate-key", key: error.key };
    }
    if (error instanceof SyntaxError || error instanceof RangeError) {
      return { ok: false, code: "malformed" };
    }
    throw error;
  }
}
