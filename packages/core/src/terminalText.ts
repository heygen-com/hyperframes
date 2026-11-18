const isControlCode = (code: number) =>
  (code < 0x20 && code !== 0x09) || (code >= 0x7f && code <= 0x9f);

export function terminalText(text: string): string {
  let shown = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    shown += isControlCode(code) ? `\\x${code.toString(16).padStart(2, "0")}` : ch;
  }
  return shown;
}

export function terminalLines(text: string): string {
  return text.split("\n").map(terminalText).join("\n");
}

const isPlainObject = (value: object) => {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

export function terminalTextDeep<T>(value: T): T {
  if (typeof value === "string") return terminalText(value) as T;
  if (Array.isArray(value)) return value.map(terminalTextDeep) as T;
  if (value !== null && typeof value === "object" && isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [terminalText(key), terminalTextDeep(item)]),
    ) as T;
  }
  return value;
}
