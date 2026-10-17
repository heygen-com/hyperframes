import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";

export const SYSTEM_FONT_SIZE_LIMIT = 5 * 1024 * 1024;
const FC_MATCH_TIMEOUT_MS = 3000;

export type FontFileFormat = "ttf" | "otf" | "woff2" | "woff" | "ttc";

export interface LocatedFont {
  path: string;
  format: FontFileFormat;
}

export const FONT_EXT_RE = /\.(otf|ttf|ttc|woff2?)$/i;

const FORMAT_PRIORITY: Record<FontFileFormat, number> = {
  woff2: 0,
  otf: 1,
  ttf: 2,
  woff: 3,
  ttc: 4,
};

const STYLE_SUFFIXES = new Set([
  "black",
  "bold",
  "book",
  "condensed",
  "demi",
  "demibold",
  "display",
  "extra",
  "extrabold",
  "hairline",
  "heavy",
  "italic",
  "light",
  "medium",
  "normal",
  "regular",
  "roman",
  "semibold",
  "thin",
  "ultra",
  "ultralight",
]);

const REGULAR_TOKENS = new Set(["regular", "roman", "normal", "book"]);

const cache = new Map<string, LocatedFont | null>();

let allowedDirsCache: string[] | null = null;

function getAllowedFontDirs(): string[] {
  if (allowedDirsCache) return allowedDirsCache;
  allowedDirsCache = fontDirectories()
    .filter((d) => existsSync(d))
    .map((d) => {
      try {
        return realpathSync(d);
      } catch {
        return resolve(d);
      }
    });
  return allowedDirsCache;
}

function isPathBounded(filePath: string): boolean {
  try {
    const real = realpathSync(filePath);
    const allowed = getAllowedFontDirs();
    return allowed.some((dir) => real.startsWith(dir + "/") || real.startsWith(dir + "\\"));
  } catch {
    return false;
  }
}

function isRegularFile(filePath: string): boolean {
  try {
    const lst = lstatSync(filePath);
    if (lst.isSymbolicLink())
      return isPathBounded(filePath) && lstatSync(realpathSync(filePath)).isFile();
    return lst.isFile();
  } catch {
    return false;
  }
}

function normalizeName(name: string): string {
  return name
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .trim()
    .toLowerCase();
}

function extensionToFormat(ext: string): FontFileFormat {
  const lower = ext.toLowerCase().replace(/^\./, "");
  if (lower === "woff2") return "woff2";
  if (lower === "woff") return "woff";
  if (lower === "otf") return "otf";
  if (lower === "ttc") return "ttc";
  return "ttf";
}

export function toFamilyName(fileName: string): string | null {
  const withoutExt = fileName.replace(FONT_EXT_RE, "");
  if (!withoutExt || withoutExt.startsWith(".")) return null;
  const spaced = withoutExt
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  const words = spaced.split(" ").filter(Boolean);
  while (words.length > 1 && STYLE_SUFFIXES.has((words.at(-1) ?? "").toLowerCase())) {
    words.pop();
  }
  const family = words.join(" ").trim();
  return family.length >= 2 ? family : null;
}

function isRegularWeight(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (REGULAR_TOKENS.has(lower.replace(FONT_EXT_RE, "").split(/[-_ ]/).pop() ?? "")) return true;
  return !lower.includes("bold") && !lower.includes("italic") && !lower.includes("light");
}

export function fontDirectories(): string[] {
  const home = homedir();
  if (platform() === "darwin") {
    return [
      join(home, "Library", "Fonts"),
      "/Library/Fonts",
      "/System/Library/Fonts",
      "/System/Library/Fonts/Supplemental",
    ];
  }
  if (platform() === "win32") {
    return [
      join(process.env.WINDIR || "C:\\Windows", "Fonts"),
      join(
        process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
        "Microsoft",
        "Windows",
        "Fonts",
      ),
    ];
  }
  return [
    join(home, ".fonts"),
    join(home, ".local", "share", "fonts"),
    "/usr/local/share/fonts",
    "/usr/share/fonts",
  ];
}

export interface FontFileEntry {
  path: string;
  fileName: string;
  family: string;
}

/**
 * Iterates font files in a directory (up to `depth` 2) and yields each file's
 * path, filename, and derived family name. Shared by the font listing route
 * and the per-family locator to avoid duplicating the directory scan loop.
 */
export function collectFontFileEntries(dir: string, depth = 0): FontFileEntry[] {
  if (!existsSync(dir) || depth > 2) return [];
  const entries: FontFileEntry[] = [];

  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        entries.push(...collectFontFileEntries(fullPath, depth + 1));
        continue;
      }
      if (!FONT_EXT_RE.test(entry.name)) continue;
      if (!isRegularFile(fullPath)) continue;
      const family = toFamilyName(entry.name);
      if (family) entries.push({ path: fullPath, fileName: entry.name, family });
    }
  } catch {
    // Directory read failed — skip
  }

  return entries;
}

interface FontCandidate {
  path: string;
  format: FontFileFormat;
  isRegular: boolean;
}

function collectCandidatesFromDir(dir: string, targetFamily: string, depth = 0): FontCandidate[] {
  return collectFontFileEntries(dir, depth)
    .filter((e) => normalizeName(e.family) === targetFamily)
    .map((e) => {
      const ext = e.fileName.match(FONT_EXT_RE)?.[1] ?? "ttf";
      return {
        path: e.path,
        format: extensionToFormat(ext),
        isRegular: isRegularWeight(e.fileName),
      };
    });
}

function pickBestCandidate(candidates: FontCandidate[]): LocatedFont | null {
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.isRegular !== b.isRegular) return a.isRegular ? -1 : 1;
    return (FORMAT_PRIORITY[a.format] ?? 9) - (FORMAT_PRIORITY[b.format] ?? 9);
  });
  const best = candidates[0]!;
  return { path: best.path, format: best.format };
}

// fallow-ignore-next-line complexity
function locateViaFcMatch(targetFamily: string): LocatedFont | null {
  if (platform() !== "linux") return null;
  try {
    const result = execFileSync("fc-match", [targetFamily, "--format=%{file}"], {
      encoding: "utf8",
      timeout: FC_MATCH_TIMEOUT_MS,
    }).trim();
    if (!result || !isRegularFile(result) || !isPathBounded(result)) return null;
    const fileName = result.split("/").pop() ?? "";
    const derivedFamily = toFamilyName(fileName);
    if (!derivedFamily || normalizeName(derivedFamily) !== targetFamily) return null;
    const ext = fileName.match(FONT_EXT_RE)?.[1] ?? "ttf";
    return { path: result, format: extensionToFormat(ext) };
  } catch {
    return null;
  }
}

export function locateSystemFont(family: string): LocatedFont | null {
  const normalized = normalizeName(family);
  if (!normalized) return null;

  const cached = cache.get(normalized);
  if (cached !== undefined) return cached;

  let result = locateViaFcMatch(normalized);

  if (!result) {
    const allCandidates: FontCandidate[] = [];
    for (const dir of fontDirectories()) {
      allCandidates.push(...collectCandidatesFromDir(dir, normalized));
    }
    result = pickBestCandidate(allCandidates);
  }

  cache.set(normalized, result);
  return result;
}

export interface LocatedFontVariant extends LocatedFont {
  weight: string;
  style: "normal" | "italic";
}

const WEIGHT_TOKENS: Record<string, string> = {
  thin: "100",
  hairline: "100",
  ultralight: "200",
  extralight: "200",
  light: "300",
  regular: "400",
  normal: "400",
  book: "400",
  roman: "400",
  medium: "500",
  demibold: "600",
  semibold: "600",
  bold: "700",
  extrabold: "800",
  ultrabold: "800",
  heavy: "800",
  black: "900",
  ultrablack: "950",
};

const WEIGHT_TOKENS_SORTED = Object.entries(WEIGHT_TOKENS).sort(([a], [b]) => b.length - a.length);

function inferWeightAndStyle(fileName: string): { weight: string; style: "normal" | "italic" } {
  const lower = fileName.toLowerCase().replace(FONT_EXT_RE, "");
  const style = lower.includes("italic") || lower.includes("oblique") ? "italic" : "normal";
  for (const [token, weight] of WEIGHT_TOKENS_SORTED) {
    if (lower.includes(token)) return { weight, style };
  }
  return { weight: "400", style };
}

export function locateSystemFontVariants(family: string): LocatedFontVariant[] {
  const normalized = normalizeName(family);
  if (!normalized) return [];

  const variants: LocatedFontVariant[] = [];
  const allCandidates: FontCandidate[] = [];
  for (const dir of fontDirectories()) {
    allCandidates.push(...collectCandidatesFromDir(dir, normalized));
  }
  for (const c of allCandidates) {
    const { weight, style } = inferWeightAndStyle(c.path);
    variants.push({ path: c.path, format: c.format, weight, style });
  }
  return dedupeVariants(variants);
}

function dedupeVariants(variants: LocatedFontVariant[]): LocatedFontVariant[] {
  const seen = new Map<string, LocatedFontVariant>();
  for (const v of variants) {
    const key = `${v.weight}:${v.style}`;
    if (!seen.has(key)) seen.set(key, v);
  }
  return Array.from(seen.values());
}

export function clearSystemFontCache(): void {
  cache.clear();
  allowedDirsCache = null;
}
