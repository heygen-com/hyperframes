import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";

const FONT_EXT_RE = /\.(otf|ttf|ttc|woff2?)$/i;
const MAX_FONT_RESULTS = 2000;
const GOOGLE_FONTS_METADATA_URL = "https://fonts.google.com/metadata/fonts";
const GOOGLE_FONTS_FETCH_TIMEOUT_MS = 3000;
let cachedFonts: string[] | null = null;
let cachedGoogleFonts: string[] | null = null;

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

const GOOGLE_FONT_FALLBACKS = [
  "Inter",
  "Roboto",
  "Open Sans",
  "Montserrat",
  "Poppins",
  "Lato",
  "Oswald",
  "Raleway",
  "Nunito",
  "Playfair Display",
  "Merriweather",
  "Source Sans 3",
  "Source Serif 4",
  "Source Code Pro",
  "DM Sans",
  "Space Grotesk",
  "Space Mono",
  "Bebas Neue",
  "Outfit",
  "JetBrains Mono",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function fontDirectories(): string[] {
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
    return [join(process.env.WINDIR || "C:\\Windows", "Fonts")];
  }
  return [
    join(home, ".fonts"),
    join(home, ".local", "share", "fonts"),
    "/usr/local/share/fonts",
    "/usr/share/fonts",
  ];
}

function toFamilyName(fileName: string): string | null {
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

function collectMacSystemProfilerFonts(): string[] {
  if (platform() !== "darwin") return [];

  let parsed: unknown;
  try {
    const raw = execFileSync("system_profiler", ["SPFontsDataType", "-json"], {
      encoding: "utf8",
      maxBuffer: 12 * 1024 * 1024,
      timeout: 5000,
    });
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.SPFontsDataType)) return [];
  const fonts: string[] = [];

  for (const fontEntry of parsed.SPFontsDataType) {
    if (!isRecord(fontEntry)) continue;
    const typefaces = fontEntry.typefaces;
    if (!Array.isArray(typefaces)) continue;

    for (const typeface of typefaces) {
      if (!isRecord(typeface)) continue;
      const family = typeface.family;
      const fullName = typeface.fullname;
      const name = typeface._name;
      if (typeof family === "string" && family.trim()) {
        fonts.push(family.trim());
      } else if (typeof fullName === "string" && fullName.trim()) {
        fonts.push(fullName.trim());
      } else if (typeof name === "string" && name.trim()) {
        fonts.push(name.trim());
      }
    }
  }

  return fonts;
}

function collectFontsFromDir(dir: string, depth = 0): string[] {
  if (!existsSync(dir) || depth > 2) return [];
  const fonts: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      fonts.push(...collectFontsFromDir(fullPath, depth + 1));
      continue;
    }
    if (!entry.isFile() || !FONT_EXT_RE.test(entry.name)) continue;
    try {
      if (!statSync(fullPath).isFile()) continue;
    } catch {
      continue;
    }
    const family = toFamilyName(entry.name);
    if (family) fonts.push(family);
  }

  return fonts;
}

function listInstalledFontFamilies(): string[] {
  if (cachedFonts) return cachedFonts;
  const families = new Set<string>();

  for (const family of collectMacSystemProfilerFonts()) {
    families.add(family);
    if (families.size >= MAX_FONT_RESULTS) break;
  }

  for (const dir of fontDirectories()) {
    for (const family of collectFontsFromDir(dir)) {
      families.add(family);
      if (families.size >= MAX_FONT_RESULTS) break;
    }
    if (families.size >= MAX_FONT_RESULTS) break;
  }

  cachedFonts = Array.from(families).sort((a, b) => a.localeCompare(b));
  return cachedFonts;
}

function parseGoogleFontMetadata(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.familyMetadataList)) return [];
  const families: string[] = [];
  for (const entry of value.familyMetadataList) {
    if (!isRecord(entry) || typeof entry.family !== "string") continue;
    families.push(entry.family);
  }
  return families;
}

function stripGoogleJsonGuard(raw: string): string {
  const prefix = ")]}'";
  if (!raw.startsWith(prefix)) return raw;

  let index = prefix.length;
  while (
    index < raw.length &&
    (raw[index] === " " ||
      raw[index] === "\n" ||
      raw[index] === "\r" ||
      raw[index] === "\t" ||
      raw[index] === "\f")
  ) {
    index += 1;
  }

  return raw.slice(index);
}

async function listGoogleFontFamilies(): Promise<string[]> {
  if (cachedGoogleFonts) return cachedGoogleFonts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GOOGLE_FONTS_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(GOOGLE_FONTS_METADATA_URL, { signal: controller.signal });
    if (!response.ok) {
      cachedGoogleFonts = GOOGLE_FONT_FALLBACKS;
      return cachedGoogleFonts;
    }
    const raw = await response.text();
    const jsonText = stripGoogleJsonGuard(raw);
    const families = parseGoogleFontMetadata(JSON.parse(jsonText));
    cachedGoogleFonts = families.length > 0 ? families : GOOGLE_FONT_FALLBACKS;
  } catch {
    cachedGoogleFonts = GOOGLE_FONT_FALLBACKS;
  } finally {
    clearTimeout(timer);
  }

  return cachedGoogleFonts;
}

export function registerFontRoutes(api: Hono): void {
  api.get("/fonts", (c) => c.json({ fonts: listInstalledFontFamilies() }));
  api.get("/fonts/google", async (c) => c.json({ fonts: await listGoogleFontFamilies() }));
}
