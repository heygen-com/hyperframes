import { parseHTML } from "linkedom";
import { EMBEDDED_FONT_DATA } from "./fontData.generated.js";

type FontFaceSpec = {
  weight: string;
  style?: "normal" | "italic";
};

type CanonicalFontSpec = {
  packageName: string;
  faces: FontFaceSpec[];
};

const GENERIC_FAMILIES = new Set([
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "emoji",
  "math",
  "fangsong",
  "-apple-system",
  "blinkmacsystemfont",
]);

const CANONICAL_FONTS: Record<string, CanonicalFontSpec> = {
  inter: {
    packageName: "@fontsource/inter",
    faces: [{ weight: "400" }, { weight: "700" }, { weight: "900" }],
  },
  montserrat: {
    packageName: "@fontsource/montserrat",
    faces: [{ weight: "400" }, { weight: "700" }, { weight: "900" }],
  },
  outfit: {
    packageName: "@fontsource/outfit",
    faces: [{ weight: "400" }, { weight: "700" }, { weight: "900" }],
  },
  nunito: {
    packageName: "@fontsource/nunito",
    faces: [{ weight: "400" }, { weight: "700" }, { weight: "900" }],
  },
  oswald: {
    packageName: "@fontsource/oswald",
    faces: [{ weight: "400" }, { weight: "700" }],
  },
  "league-gothic": {
    packageName: "@fontsource/league-gothic",
    faces: [{ weight: "400" }],
  },
  "archivo-black": {
    packageName: "@fontsource/archivo-black",
    faces: [{ weight: "400" }],
  },
  "space-mono": {
    packageName: "@fontsource/space-mono",
    faces: [{ weight: "400" }, { weight: "700" }],
  },
  "ibm-plex-mono": {
    packageName: "@fontsource/ibm-plex-mono",
    faces: [{ weight: "400" }, { weight: "700" }],
  },
  "jetbrains-mono": {
    packageName: "@fontsource/jetbrains-mono",
    faces: [{ weight: "400" }, { weight: "700" }],
  },
  "eb-garamond": {
    packageName: "@fontsource/eb-garamond",
    faces: [{ weight: "400" }, { weight: "700" }],
  },
  "playfair-display": {
    packageName: "@fontsource/playfair-display",
    faces: [{ weight: "400" }, { weight: "700" }, { weight: "900" }],
  },
  "source-code-pro": {
    packageName: "@fontsource/source-code-pro",
    faces: [{ weight: "400" }, { weight: "700" }],
  },
  "noto-sans-jp": {
    packageName: "@fontsource/noto-sans-jp",
    faces: [{ weight: "400" }, { weight: "700" }],
  },
  roboto: {
    packageName: "@fontsource/roboto",
    faces: [{ weight: "400" }, { weight: "700" }, { weight: "900" }],
  },
  "open-sans": {
    packageName: "@fontsource/open-sans",
    faces: [{ weight: "400" }, { weight: "700" }],
  },
  lato: {
    packageName: "@fontsource/lato",
    faces: [{ weight: "400" }, { weight: "700" }, { weight: "900" }],
  },
  poppins: {
    packageName: "@fontsource/poppins",
    faces: [{ weight: "400" }, { weight: "700" }, { weight: "900" }],
  },
};

const FONT_ALIASES: Record<string, keyof typeof CANONICAL_FONTS> = {
  inter: "inter",
  "helvetica neue": "inter",
  helvetica: "inter",
  arial: "inter",
  "helvetica bold": "inter",
  montserrat: "montserrat",
  futura: "montserrat",
  "din alternate": "montserrat",
  "arial black": "montserrat",
  outfit: "outfit",
  nunito: "nunito",
  oswald: "oswald",
  "bebas neue": "league-gothic",
  "league gothic": "league-gothic",
  "archivo black": "archivo-black",
  "space mono": "space-mono",
  "ibm plex mono": "ibm-plex-mono",
  "jetbrains mono": "jetbrains-mono",
  "courier new": "jetbrains-mono",
  courier: "jetbrains-mono",
  "eb garamond": "eb-garamond",
  garamond: "eb-garamond",
  "playfair display": "playfair-display",
  "source code pro": "source-code-pro",
  "noto sans jp": "noto-sans-jp",
  "noto sans japanese": "noto-sans-jp",
  roboto: "roboto",
  "open sans": "open-sans",
  lato: "lato",
  poppins: "poppins",
  "segoe ui": "roboto",
};

function normalizeFamilyName(family: string): string {
  return family
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .trim()
    .toLowerCase();
}

function fontDataUri(
  packageName: string,
  weight: string,
  style: "normal" | "italic" = "normal",
): string {
  const key = `${packageName}:${weight}:${style}`;
  const uri = EMBEDDED_FONT_DATA.get(key);
  if (!uri) {
    throw new Error(
      `No embedded font data for ${key}. Regenerate with: tsx scripts/generate-font-data.ts`,
    );
  }
  return uri;
}

function extractExistingFontFaces(html: string): Set<string> {
  const families = new Set<string>();
  const fontFaceRegex = /@font-face\s*\{[\s\S]*?font-family\s*:\s*([^;]+);[\s\S]*?\}/gi;
  for (const match of html.matchAll(fontFaceRegex)) {
    const raw = match[1] || "";
    const normalized = normalizeFamilyName(raw);
    if (normalized) {
      families.add(normalized);
    }
  }
  return families;
}

function extractRequestedFontFamilies(html: string): Map<string, string> {
  const requested = new Map<string, string>();
  const addFamilyList = (value: string) => {
    for (const family of value.split(",")) {
      const originalCase = family
        .trim()
        .replace(/^['"]|['"]$/g, "")
        .trim();
      const normalized = originalCase.toLowerCase();
      if (!normalized || GENERIC_FAMILIES.has(normalized)) {
        continue;
      }
      if (!requested.has(normalized)) {
        requested.set(normalized, originalCase);
      }
    }
  };

  const fontFamilyRegex = /font-family\s*:\s*([^;}{]+)[;}]?/gi;
  for (const match of html.matchAll(fontFamilyRegex)) {
    addFamilyList(match[1] || "");
  }

  const dataFontFamilyRegex = /data-font-family=["']([^"']+)["']/gi;
  for (const match of html.matchAll(dataFontFamilyRegex)) {
    addFamilyList(match[1] || "");
  }

  return requested;
}

function buildFontFaceCss(requestedFamilies: Map<string, string>): {
  css: string;
  unresolved: string[];
} {
  const rules: string[] = [];
  const unresolved: string[] = [];

  for (const [normalizedFamily, originalCaseFamily] of requestedFamilies) {
    const canonicalKey = FONT_ALIASES[normalizedFamily];
    if (!canonicalKey) {
      unresolved.push(originalCaseFamily);
      continue;
    }

    const canonical = CANONICAL_FONTS[canonicalKey];
    if (!canonical) continue;
    for (const face of canonical.faces) {
      const style = face.style || "normal";
      const src = fontDataUri(canonical.packageName, face.weight, style);
      rules.push(
        [
          "@font-face {",
          `  font-family: "${originalCaseFamily}";`,
          `  src: url("${src}") format("woff2");`,
          `  font-style: ${style};`,
          `  font-weight: ${face.weight};`,
          "  font-display: block;",
          "}",
        ].join("\n"),
      );
    }
  }

  return {
    css: rules.join("\n\n").trim(),
    unresolved: unresolved.sort(),
  };
}

function warnUnresolvedFonts(unresolved: string[]): void {
  const mapped = Object.entries(FONT_ALIASES)
    .reduce<string[]>((acc, [alias, canonical]) => {
      const display = alias === canonical ? alias : `${alias} → ${canonical}`;
      if (!acc.includes(display)) acc.push(display);
      return acc;
    }, [])
    .sort();
  console.warn(
    `[Compiler] No deterministic font mapping for: ${unresolved.join(", ")}\n` +
      `  Mapped fonts: ${mapped.join(", ")}\n` +
      `  To fix, pick one:\n` +
      `    1. Use a mapped font name instead (see list above)\n` +
      `    2. Add a @font-face block in your HTML with a local or hosted font file\n` +
      `    3. Install the font locally on the render machine (Docker: add to Dockerfile)\n` +
      `    4. Add an alias to FONT_ALIASES in deterministicFonts.ts (for contributors)\n` +
      `  Docs: https://hyperframes.heygen.com/docs/fonts`,
  );
}

export function injectDeterministicFontFaces(html: string): string {
  const existingFaces = extractExistingFontFaces(html);
  const requestedFamilies = extractRequestedFontFamilies(html);
  const pendingFamilies = new Map<string, string>();

  for (const [normalizedFamily, originalCaseFamily] of requestedFamilies) {
    if (!existingFaces.has(normalizedFamily)) {
      pendingFamilies.set(normalizedFamily, originalCaseFamily);
    }
  }

  if (pendingFamilies.size === 0) {
    return html;
  }

  const { css, unresolved } = buildFontFaceCss(pendingFamilies);
  if (!css) {
    if (unresolved.length > 0) {
      warnUnresolvedFonts(unresolved);
    }
    return html;
  }

  const { document } = parseHTML(html);
  const head = document.querySelector("head");
  if (!head) {
    return html;
  }

  const styleEl = document.createElement("style");
  styleEl.setAttribute("data-hyperframes-deterministic-fonts", "true");
  styleEl.textContent = css;
  head.insertBefore(styleEl, head.firstChild);

  console.log(
    `[Compiler] Injected deterministic @font-face rules for ${pendingFamilies.size - unresolved.length} requested font families`,
  );
  if (unresolved.length > 0) {
    warnUnresolvedFonts(unresolved);
  }

  return document.toString();
}
