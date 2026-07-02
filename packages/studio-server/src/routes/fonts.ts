import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import type { Hono } from "hono";
import {
  collectFontFileEntries,
  fontDirectories,
  getSystemProfilerFamilies,
  locateSystemFont,
  SYSTEM_FONT_SIZE_LIMIT,
} from "@hyperframes/core/fonts/system-locator";

const MAX_FONT_RESULTS = 2000;
const GOOGLE_FONTS_METADATA_URL = "https://fonts.google.com/metadata/fonts";
const GOOGLE_FONTS_FETCH_TIMEOUT_MS = 3000;
let cachedFonts: string[] | null = null;
let cachedGoogleFonts: string[] | null = null;

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

function collectFontsFromDir(dir: string): string[] {
  return collectFontFileEntries(dir).map((e) => e.family);
}

function listInstalledFontFamilies(): string[] {
  if (cachedFonts) return cachedFonts;
  const families = new Set<string>();

  for (const family of getSystemProfilerFamilies()) {
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

  // fallow-ignore-next-line complexity
  api.get("/fonts/file", (c) => {
    const family = c.req.query("family");
    if (!family) return c.json({ error: "family parameter required" }, 400);

    const located = locateSystemFont(family);
    if (!located) return c.json({ error: "font not found" }, 404);

    let fd: number;
    try {
      fd = openSync(located.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      return c.json({ error: "font file not accessible" }, 404);
    }
    try {
      const stat = fstatSync(fd);
      if (stat.size > SYSTEM_FONT_SIZE_LIMIT) {
        return c.json({ error: "font file too large" }, 413);
      }
      const buffer = Buffer.alloc(stat.size);
      readSync(fd, buffer, 0, stat.size, 0);
      const mimeType =
        located.format === "otf"
          ? "font/otf"
          : located.format === "woff2"
            ? "font/woff2"
            : located.format === "woff"
              ? "font/woff"
              : located.format === "ttc"
                ? "font/collection"
                : "font/ttf";

      const fileName = `${family.replace(/[^a-zA-Z0-9 -]/g, "")}.${located.format}`;
      return new Response(buffer, {
        headers: {
          "Content-Type": mimeType,
          "Content-Disposition": `attachment; filename="${fileName}"`,
        },
      });
    } catch {
      return c.json({ error: "failed to read font file" }, 500);
    } finally {
      closeSync(fd);
    }
  });
}
