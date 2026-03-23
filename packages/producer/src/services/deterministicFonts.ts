import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { parseHTML } from "linkedom";

const require = createRequire(import.meta.url);

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
};

const PACKAGE_ROOT_CACHE = new Map<string, string>();
const FONT_DATA_URI_CACHE = new Map<string, string>();

function normalizeFamilyName(family: string): string {
  return family
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .trim()
    .toLowerCase();
}

function packageRoot(packageName: string): string {
  const cached = PACKAGE_ROOT_CACHE.get(packageName);
  if (cached) {
    return cached;
  }

  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  const root = dirname(packageJsonPath);
  PACKAGE_ROOT_CACHE.set(packageName, root);
  return root;
}

function resolveFontFile(
  packageName: string,
  weight: string,
  style: "normal" | "italic" = "normal",
): string {
  const root = packageRoot(packageName);
  const filesDir = join(root, "files");
  const slug = packageName.replace("@fontsource/", "");
  const files = readdirSync(filesDir);

  const exact = `${slug}-latin-${weight}-${style}.woff2`;
  if (files.includes(exact)) {
    return join(filesDir, exact);
  }

  const relaxed = files.find((file) => {
    return file.endsWith(`-${weight}-${style}.woff2`) && file.includes("-latin-");
  });
  if (relaxed) {
    return join(filesDir, relaxed);
  }

  throw new Error(
    `No deterministic font asset found for ${packageName} weight=${weight} style=${style}`,
  );
}

function fontDataUri(
  packageName: string,
  weight: string,
  style: "normal" | "italic" = "normal",
): string {
  const key = `${packageName}:${weight}:${style}`;
  const cached = FONT_DATA_URI_CACHE.get(key);
  if (cached) {
    return cached;
  }

  const fontPath = resolveFontFile(packageName, weight, style);
  const content = readFileSync(fontPath);
  const uri = `data:font/woff2;base64,${content.toString("base64")}`;
  FONT_DATA_URI_CACHE.set(key, uri);
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
      console.warn(`[Compiler] No deterministic font mapping for: ${unresolved.join(", ")}`);
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
    console.warn(`[Compiler] Unresolved font families left dynamic: ${unresolved.join(", ")}`);
  }

  return document.toString();
}
