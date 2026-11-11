import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const UNRESOLVED_FONTS =
  /(?:fonts? that could not be resolved|unresolved font famil(?:y|ies)|unresolved fonts[^:\n]*):\s*([^\n]+)/i;
const SKIPPED_DIRS = new Set(["node_modules", "renders", "dist"]);
const MAX_FILES = 2_000;

/** The families a cloud failure says it could not resolve; empty when it is about something else. */
export function unresolvedFontFamilies(message: string): string[] {
  const listed = UNRESOLVED_FONTS.exec(message)?.[1];
  if (!listed) return [];
  const families = listed
    .replace(/\(\+\d+ more\)/g, "")
    .replace(/\.\s.*$|\.$/, "")
    .split(",")
    .map((family) =>
      family
        .trim()
        .replace(/^["']|["']$/g, "")
        .trim(),
    )
    .filter(Boolean);
  return [...new Set(families)];
}

function styleSources(dir: string, found: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (found.length >= MAX_FILES) break;
    if (entry.name.startsWith(".") || SKIPPED_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) styleSources(path, found);
    else if ([".html", ".htm", ".css"].includes(extname(entry.name).toLowerCase())) {
      found.push(path);
    }
  }
  return found;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Each family with the project files that name it, relative to the project. */
function filesNamingFonts(projectDir: string, families: string[]): Map<string, string[]> {
  const named = new Map<string, string[]>();
  const patterns = families.map(
    (family) => [family, new RegExp(`(^|[^\\w-])${escapeRegExp(family)}(?![\\w-])`, "i")] as const,
  );
  for (const path of styleSources(projectDir)) {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const [family, pattern] of patterns) {
      if (!pattern.test(text)) continue;
      named.set(family, [...(named.get(family) ?? []), relative(projectDir, path)]);
    }
  }
  return named;
}

/** Which project files use each font a cloud render could not resolve, or undefined when none is named. */
export function describeUnresolvedFontUse(
  failureMessage: string,
  projectDir: string,
): string | undefined {
  const families = unresolvedFontFamilies(failureMessage);
  if (families.length === 0) return undefined;
  const named = filesNamingFonts(projectDir, families);
  const lines = families.map((family) => {
    const files = named.get(family);
    return files?.length
      ? `${family}: used in ${files.join(", ")}`
      : `${family}: not found in the project files`;
  });
  return (
    `${lines.join("\n")}\n` +
    "Cloud renders cannot use fonts installed on your machine. Ship the font file with an " +
    "@font-face url() source, or switch to a Google Fonts family. `hyperframes lint` flags these."
  );
}
