/**
 * Single source of truth for the deterministic font alias map. Both the
 * producer's @font-face injector and the core lint rules import from here,
 * eliminating manual drift between the two.
 *
 * Keys are lowercase font family names. Values are canonical font slugs
 * matching CANONICAL_FONTS keys in the producer's deterministicFonts module.
 */
export const FONT_ALIAS_MAP = {
  // ── Canonical bundled fonts (self-referencing) ────────────────────────
  inter: "inter",
  montserrat: "montserrat",
  outfit: "outfit",
  nunito: "nunito",
  oswald: "oswald",
  "league gothic": "league-gothic",
  "archivo black": "archivo-black",
  "space mono": "space-mono",
  "ibm plex mono": "ibm-plex-mono",
  "jetbrains mono": "jetbrains-mono",
  "eb garamond": "eb-garamond",
  "playfair display": "playfair-display",
  "source code pro": "source-code-pro",
  "noto sans jp": "noto-sans-jp",
  roboto: "roboto",
  "open sans": "open-sans",
  lato: "lato",
  poppins: "poppins",

  // ── Common aliases → nearest canonical ────────────────────────────────
  "helvetica neue": "inter",
  helvetica: "inter",
  arial: "inter",
  "helvetica bold": "inter",
  futura: "montserrat",
  "din alternate": "montserrat",
  "arial black": "montserrat",
  "bebas neue": "league-gothic",
  "courier new": "jetbrains-mono",
  courier: "jetbrains-mono",
  garamond: "eb-garamond",
  "noto sans japanese": "noto-sans-jp",
  "segoe ui": "roboto",

  // ── macOS sans-serif system fonts → inter ─────────────────────────────
  "sf pro": "inter",
  "sf pro display": "inter",
  "sf pro text": "inter",
  "sf pro rounded": "inter",
  avenir: "inter",
  "avenir next": "inter",
  "lucida grande": "inter",
  geneva: "inter",
  optima: "inter",

  // ── Windows sans-serif system fonts → inter ───────────────────────────
  verdana: "inter",
  tahoma: "inter",
  "trebuchet ms": "inter",
  calibri: "inter",
  candara: "inter",
  corbel: "inter",
  "lucida sans": "inter",
  "lucida sans unicode": "inter",

  // ── Linux sans-serif system fonts → inter ─────────────────────────────
  "noto sans": "inter",
  "dejavu sans": "inter",
  "liberation sans": "inter",

  // ── Monospace system fonts → jetbrains-mono ───────────────────────────
  "sf mono": "jetbrains-mono",
  menlo: "jetbrains-mono",
  monaco: "jetbrains-mono",
  consolas: "jetbrains-mono",
  "lucida console": "jetbrains-mono",
  "lucida sans typewriter": "jetbrains-mono",
  "andale mono": "jetbrains-mono",
  "dejavu sans mono": "jetbrains-mono",
  "liberation mono": "jetbrains-mono",

  // ── Serif system fonts → eb-garamond ──────────────────────────────────
  georgia: "eb-garamond",
  palatino: "eb-garamond",
  "palatino linotype": "eb-garamond",
  "book antiqua": "eb-garamond",
  cambria: "eb-garamond",
  times: "eb-garamond",
  "times new roman": "eb-garamond",
  "dejavu serif": "eb-garamond",
  "liberation serif": "eb-garamond",
} satisfies Readonly<Record<string, string>>;

export const FONT_ALIAS_KEYS: ReadonlySet<string> = new Set(Object.keys(FONT_ALIAS_MAP));

/**
 * Human-readable display names for canonical font slugs. Used by the lint
 * rule to tell authors what their aliased font will render as.
 */
export const CANONICAL_FONT_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  inter: "Inter",
  montserrat: "Montserrat",
  outfit: "Outfit",
  nunito: "Nunito",
  oswald: "Oswald",
  "league-gothic": "League Gothic",
  "archivo-black": "Archivo Black",
  "space-mono": "Space Mono",
  "ibm-plex-mono": "IBM Plex Mono",
  "jetbrains-mono": "JetBrains Mono",
  "eb-garamond": "EB Garamond",
  "playfair-display": "Playfair Display",
  "source-code-pro": "Source Code Pro",
  "noto-sans-jp": "Noto Sans JP",
  roboto: "Roboto",
  "open-sans": "Open Sans",
  lato: "Lato",
  poppins: "Poppins",
};

/**
 * Resolve a font alias to its canonical display name, or undefined if the
 * alias is not in the map.
 */
export function resolveAliasDisplayName(alias: string): string | undefined {
  const slug = (FONT_ALIAS_MAP as Record<string, string>)[alias.toLowerCase()];
  if (!slug) return undefined;
  return CANONICAL_FONT_DISPLAY_NAMES[slug];
}
