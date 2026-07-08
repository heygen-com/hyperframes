export interface AttrEntry {
  key: string;
  value: number | string;
}

export function parseAttrWrapper(value: unknown): AttrEntry[] | null {
  const raw = rawText(value);
  if (!raw?.startsWith("{") || !raw.endsWith("}")) return null;
  const body = raw.slice(1, -1).trim();
  if (body.length === 0) return [];

  const entries: AttrEntry[] = [];
  for (const part of splitTopLevel(body, ",")) {
    const property = splitProperty(part);
    if (property === null) return null;
    const key = parseKey(property.key.trim());
    const parsedValue = parseValue(property.value.trim());
    if (key === null || parsedValue === null) return null;
    entries.push({ key, value: parsedValue });
  }
  return entries;
}

function splitProperty(source: string): { key: string; value: string } | null {
  const colon = findTopLevelColon(source);
  if (colon === null) return null;
  return {
    key: source.slice(0, colon),
    value: source.slice(colon + 1),
  };
}

function splitTopLevel(source: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{" || char === "[" || char === "(") depth += 1;
    if (char === "}" || char === "]" || char === ")") depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts.filter((part) => part.length > 0);
}

function findTopLevelColon(source: string): number | null {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{" || char === "[" || char === "(") depth += 1;
    if (char === "}" || char === "]" || char === ")") depth -= 1;
    if (char === ":" && depth === 0) return index;
  }
  return null;
}

function parseKey(value: string): string | null {
  if (/^[A-Za-z_$][\w$]*$/.test(value)) return value;
  return parseStringLiteral(value);
}

function parseValue(value: string): number | string | null {
  const numeric = Number(value);
  if (value.length > 0 && Number.isFinite(numeric)) return numeric;
  return parseStringLiteral(value);
}

function parseStringLiteral(value: string): string | null {
  const quote = value[0];
  if ((quote !== "'" && quote !== '"') || value[value.length - 1] !== quote) return null;
  if (quote === '"') {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "string" ? parsed : null;
    } catch {
      return null;
    }
  }
  return value.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
}

function rawText(value: unknown): string | null {
  if (typeof value === "string")
    return value.startsWith("__raw:") ? value.slice(6).trim() : value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}
