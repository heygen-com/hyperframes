// fallow-ignore-next-line complexity
export function rawText(value: unknown): string | null {
  if (typeof value === "string")
    return value.startsWith("__raw:") ? value.slice(6).trim() : value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}
