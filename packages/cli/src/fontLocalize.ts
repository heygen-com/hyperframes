export interface FontLocalizeIo {
  readInput(): Promise<string>;
  writeOutput(value: string): void;
  writeError(value: string): void;
}

export interface FontVersions {
  producer: string;
  localizer: string;
}

function safeVersion(version: string): string {
  return version.replace(/[^A-Za-z0-9.+-]/g, "") || "unknown";
}

/**
 * Add post-hoc diagnostics for the producer resolver and the CLI wrapper that ran it.
 * These stamps are traceability metadata, not an enforcement mechanism.
 */
export function stampFontVersions(html: string, versions: FontVersions): string {
  const tags =
    `<meta name="hyperframes-font-compiler-version" content="${safeVersion(versions.producer)}">` +
    `<meta name="hyperframes-font-localizer-version" content="${safeVersion(versions.localizer)}">`;
  const headClose = html.search(/<\/head\s*>/i);
  if (headClose >= 0) return `${html.slice(0, headClose)}${tags}${html.slice(headClose)}`;
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (!doctype) return `${tags}${html}`;
  const insertAt = doctype.index + doctype[0].length;
  return `${html.slice(0, insertAt)}${tags}${html.slice(insertAt)}`;
}

function safeErrorName(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  return /^[A-Za-z][A-Za-z0-9]*$/.test(name) ? name : "Error";
}

const MAX_REPORTED_FAMILIES = 8;
const MAX_FAMILY_NAME_LENGTH = 64;

function unresolvedFamilyList(error: unknown): unknown[] {
  if (!(error instanceof Error) || !("unresolvedFamilies" in error)) return [];
  const families = error.unresolvedFamilies;
  return Array.isArray(families) ? families : [];
}

// URL-shaped names are dropped whole: stripping punctuation would still print the token.
function safeFamilyName(family: unknown): string | null {
  if (typeof family !== "string" || /[:/?#&=%@\\]/.test(family)) return null;
  const safe = family
    .replace(/[^A-Za-z0-9 _-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FAMILY_NAME_LENGTH)
    .trim();
  return safe || null;
}

function unresolvedFamiliesSuffix(error: unknown): string {
  const families = unresolvedFamilyList(error);
  if (families.length === 0) return "";
  const printable = families.map(safeFamilyName).filter((name): name is string => name !== null);
  const distinct = [...new Set(printable)];
  const shown = distinct.slice(0, MAX_REPORTED_FAMILIES);
  const hidden = families.length - printable.length + (distinct.length - shown.length);
  const listed = shown.map((name) => `"${name}"`).join(", ");
  const more = hidden > 0 ? `${listed ? " " : ""}(+${hidden} more)` : "";
  return `: unresolved font families: ${listed}${more}`;
}

/**
 * Machine-only stdin/stdout boundary for deterministic font localization.
 * Source HTML and resolver messages can contain signed URLs, so failures emit
 * only a fixed category, a sanitized error class and sanitized family names.
 */
export async function runFontLocalize(
  io: FontLocalizeIo,
  localize: (html: string) => Promise<string>,
): Promise<number> {
  const html = await io.readInput();
  if (!html.trim()) {
    io.writeError("font localization input is empty\n");
    return 2;
  }

  try {
    const localized = await localize(html);
    if (!localized.trim()) {
      io.writeError("font localization failed (Error): empty output\n");
      return 1;
    }
    io.writeOutput(localized);
    return 0;
  } catch (error) {
    io.writeError(
      `font localization failed (${safeErrorName(error)})${unresolvedFamiliesSuffix(error)}\n`,
    );
    return 1;
  }
}
