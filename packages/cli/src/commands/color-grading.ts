import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  HF_COLOR_GRADING_ADJUST_KEYS,
  HF_COLOR_GRADING_ATTR,
  HF_COLOR_GRADING_DETAIL_KEYS,
  HF_COLOR_GRADING_EFFECT_KEYS,
  HF_COLOR_GRADING_LUT_KEYS,
  HF_COLOR_GRADING_TOP_LEVEL_KEYS,
  getHfColorGradingCapabilities,
  isHfColorGradingActive,
  isPathInside,
  normalizeHfColorGrading,
  serializeHfColorGrading,
  type HfColorGradingActiveEffectKey,
  type HfColorGradingCapabilities,
} from "@hyperframes/core";
import { patchElementInHtml } from "@hyperframes/studio-server/source-mutation";
import { defineCommand } from "citty";
import { parseHTML } from "linkedom";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";
import { failCommand } from "../utils/commandResult.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
import { readOptionalString } from "../utils/pathArgs.js";
import { resolveProject } from "../utils/project.js";
import { withMeta } from "../utils/updateCheck.js";

type EffectFamilyId = "essentials" | "retro-glitch" | "print" | "art";

const EFFECT_DISCOVERY_ROWS = [
  ["blur", "essentials", "Blur", "Defocus or soften a full media layer."],
  ["pixelate", "essentials", "Pixelate", "Turn a media layer into a block mosaic."],
  ["bloom", "essentials", "Bloom", "Add thresholded glow around bright image regions."],
  ["chromaBleed", "retro-glitch", "Chroma Softening", "Smear color like low-bandwidth video."],
  ["tapeDamage", "retro-glitch", "Tape Damage", "Add moving tracking errors and tape noise."],
  ["filmArtifacts", "retro-glitch", "Film Artifacts", "Add deterministic dust and film wear."],
  ["scanlines", "retro-glitch", "Scanlines", "Overlay configurable horizontal display lines."],
  ["crtCurvature", "retro-glitch", "CRT Curvature", "Warp media toward curved CRT geometry."],
  ["chromaticAberration", "retro-glitch", "Channel Separation", "Offset color channels by angle."],
  ["digitalGlitch", "retro-glitch", "Digital Glitch", "Compose tears, blocks, and color splits."],
  ["halftone", "print", "Halftone", "Render source color through a print-dot raster."],
  ["twoInkPrint", "print", "Two-Ink Print", "Reduce media to a two-ink print treatment."],
  ["dither", "print", "Ordered Dither", "Quantize media into an ordered limited palette."],
  ["monoScreen", "print", "Mono Screen", "Build monochrome dot, shape, or line artwork."],
  ["ascii", "art", "ASCII", "Render media as configurable procedural glyph cells."],
  ["engraving", "art", "Engraving", "Translate luminance into directional engraved lines."],
  ["crosshatch", "art", "Crosshatch", "Translate media into layered hand-hatched lines."],
  ["kuwahara", "art", "Kuwahara Paint", "Apply edge-preserving painterly smoothing."],
] as const satisfies readonly [HfColorGradingActiveEffectKey, EffectFamilyId, string, string][];

const EFFECT_DISCOVERY = EFFECT_DISCOVERY_ROWS.map(([key, family, label, description]) => ({
  key,
  family,
  label,
  description,
}));

const EFFECT_FAMILY_ROWS = [
  ["essentials", "Essentials", "Common optical, focus, and privacy-oriented primitives."],
  [
    "retro-glitch",
    "Retro & Glitch",
    "Tape, film, CRT, channel separation, and digital disruption.",
  ],
  ["print", "Print", "Halftone, limited-ink, dither, and screen-print rendering."],
  ["art", "Art", "ASCII, engraved, crosshatched, and painterly rendering."],
] as const satisfies readonly [EffectFamilyId, string, string][];

const EFFECT_FAMILIES = EFFECT_FAMILY_ROWS.map(([id, label, description]) => ({
  id,
  label,
  description,
}));

export function getMediaTreatmentCapabilityOverview(
  capabilities: HfColorGradingCapabilities = getHfColorGradingCapabilities(),
) {
  const family = (id: string, label: string, description: string, items: readonly unknown[]) => ({
    id,
    label,
    description,
    items,
  });

  return {
    version: capabilities.version,
    targetTags: capabilities.targetTags,
    colorSpace: capabilities.colorSpace,
    families: [
      family(
        "correction",
        "Adjust",
        "Fix exposure, tonal balance, color casts, and saturation.",
        capabilities.adjustments.map(({ key }) => key),
      ),
      family(
        "presets",
        "Presets",
        "Apply a tested starting point, then tune only when the source or intent requires it.",
        capabilities.presets.map(({ id }) => id),
      ),
      family(
        "finishing",
        "Finish",
        "Shape vignette and deterministic film grain.",
        capabilities.finishing.map(({ key }) => key),
      ),
      ...EFFECT_FAMILIES.map(({ id, label, description }) =>
        family(
          id,
          label,
          description,
          EFFECT_DISCOVERY.filter((effect) => effect.family === id).map(
            ({ key, label: effectLabel, description: effectDescription }) => ({
              id: key,
              label: effectLabel,
              description: effectDescription,
            }),
          ),
        ),
      ),
      family(
        "palettes",
        "Palettes",
        "Reusable two-to-six-color palettes for compatible art effects.",
        capabilities.palettes.map(({ id }) => id),
      ),
      family(
        "animation",
        "Animation",
        "Seek-safe CSS properties that registered GSAP timelines may animate.",
        capabilities.animatable.map(({ path }) => path),
      ),
      family("lut", "Custom LUT", "Apply a user-owned 3D .cube LUT.", ["3d-cube"]),
      {
        id: "overlays",
        label: "Overlays",
        description: "Install authored HUD, light-leak, flash, or freeze-frame overlay blocks.",
        items: [
          "camcorder-hud",
          "editorial-flash-overlay",
          "organic-light-leak-overlay",
          "freeze-frame-cutout",
        ],
        owner: "registry",
      },
    ],
    discovery: {
      detail: "Use --capability <family-or-item> for exact controls and examples.",
      full: "Use --all only for tooling or exhaustive inspection.",
    },
  };
}

export function getMediaTreatmentCapabilityDetail(
  id: string,
  capabilities: HfColorGradingCapabilities = getHfColorGradingCapabilities(),
): unknown {
  const animation = (path: string) => {
    const property = capabilities.animatable.find((candidate) => candidate.path === path);
    if (!property) return null;
    return {
      property,
      initial: `style="${property.name}: <start>"`,
      tween: `timeline.to("<selector>", { "${property.name}": <end>, duration: <seconds> })`,
      rules: [
        "Author the initial value inline on the media element.",
        "Use finite keyframes on a paused timeline registered in window.__timelines.",
        "Do not use a frame-zero set, timers, random values, or onUpdate callbacks.",
      ],
    };
  };

  const effectMeta = EFFECT_DISCOVERY.find((effect) => effect.key === id);
  if (effectMeta) {
    const effect = capabilities.effects.find(({ key }) => key === effectMeta.key);
    if (!effect) throw new Error(`Missing canonical capability: ${id}`);
    return {
      id,
      family: effectMeta.family,
      label: effectMeta.label,
      description: effectMeta.description,
      renderLane: effect.renderLane,
      supportsPalette: effect.supportsPalette,
      apply: { effects: effect.apply },
      controls: effect.controls,
      animation: animation(`effects.${id}`),
    };
  }

  const effectFamily = EFFECT_FAMILIES.find((family) => family.id === id);
  if (effectFamily) {
    return {
      ...effectFamily,
      effects: EFFECT_DISCOVERY.filter((effect) => effect.family === id).map((effect) => {
        const capability = capabilities.effects.find(({ key }) => key === effect.key);
        return {
          id: effect.key,
          label: effect.label,
          description: effect.description,
          renderLane: capability?.renderLane,
          supportsPalette: capability?.supportsPalette,
          animatable: capabilities.animatable.some(({ path }) => path === `effects.${effect.key}`),
        };
      }),
    };
  }

  const adjustment = capabilities.adjustments.find(({ key }) => key === id);
  if (adjustment) {
    return {
      id,
      family: "correction",
      description: `Adjust ${id} within the canonical correction range.`,
      control: adjustment,
      apply: { adjust: { [id]: adjustment.identity } },
      animation: animation(`adjust.${id}`),
    };
  }

  const finishing = capabilities.finishing.find(({ key }) => key === id);
  if (finishing) {
    return {
      id,
      family: "finishing",
      description: `Adjust ${id} within the canonical finishing range.`,
      control: finishing,
      apply: { details: { [id]: finishing.identity } },
    };
  }

  const preset = capabilities.presets.find((candidate) => candidate.id === id);
  if (preset) {
    return {
      id: preset.id,
      label: preset.label,
      description: "Tested built-in media preset.",
      apply: { preset: preset.id, intensity: preset.intensity },
    };
  }

  const palette = capabilities.palettes.find((candidate) => candidate.id === id);
  if (palette) return { ...palette, apply: { palette: palette.colors } };

  const details = {
    correction: {
      id,
      description: "Fix exposure, tonal balance, color casts, and saturation.",
      controls: capabilities.adjustments,
    },
    presets: {
      id,
      description: "Tested starting points for color and stylized media effects.",
      presets: capabilities.presets,
    },
    finishing: {
      id,
      description: "Vignette and deterministic film-grain controls.",
      controls: capabilities.finishing,
    },
    palettes: {
      id,
      description: "Named palettes plus the custom palette contract.",
      contract: capabilities.palette,
      palettes: capabilities.palettes,
    },
    animation: {
      id,
      description: "Seek-safe CSS properties for registered GSAP timelines.",
      properties: capabilities.animatable,
    },
    lut: {
      id,
      description: "User-owned 3D .cube LUT support.",
      contract: capabilities.lut,
    },
    overlays: {
      id,
      description: "Authored overlay blocks owned by the HyperFrames Registry.",
      discover: "hyperframes catalog",
      apply: "hyperframes add <overlay> --dir <project> --no-clipboard --json",
    },
  } as const;

  const detail = Object.hasOwn(details, id) ? Reflect.get(details, id) : undefined;
  if (detail) return detail;
  throw new Error(`Unknown media-treatment capability: ${id}`);
}

export const examples: Example[] = [
  [
    "Discover the complete treatment surface without loading every control",
    `hyperframes media-treatment --capabilities --json`,
  ],
  [
    "Inspect one relevant effect in detail",
    `hyperframes media-treatment --capabilities --capability kuwahara --json`,
  ],
  [
    "Inspect the exhaustive machine-readable catalog",
    `hyperframes media-treatment --capabilities --all --json`,
  ],
  [
    "Apply a resolved treatment to one media element",
    `hyperframes media-treatment --selector '#hero' --grading '{"preset":"skin-soft","intensity":0.6}'`,
  ],
  [
    "Preview the exact mutation without writing",
    `hyperframes media-treatment --file compositions/scene.html --selector 'video' --grading '{"preset":"warm-daylight"}' --dry-run --json`,
  ],
  ["Remove a treatment", `hyperframes media-treatment --selector '#hero' --clear`],
];

interface ApplyColorGradingOptions {
  selector: string;
  selectorIndex?: number;
  grading?: unknown;
  clear?: boolean;
}

const GRADING_KEYS = new Set<string>(HF_COLOR_GRADING_TOP_LEVEL_KEYS);
const ADJUST_KEYS = new Set<string>(HF_COLOR_GRADING_ADJUST_KEYS);
const DETAIL_KEYS = new Set<string>(HF_COLOR_GRADING_DETAIL_KEYS);
const EFFECT_KEYS = new Set<string>(HF_COLOR_GRADING_EFFECT_KEYS);
const LUT_KEYS = new Set<string>(HF_COLOR_GRADING_LUT_KEYS);

export interface ApplyColorGradingResult {
  html: string;
  changed: boolean;
  tag: "img" | "video";
  value: string | null;
}

function parseSourceDocument(source: string): Document {
  if (/<!doctype|<html[\s>]/i.test(source)) return parseHTML(source).document;
  return parseHTML(`<!DOCTYPE html><html><body>${source}</body></html>`).document;
}

function assertKnownKeys(value: unknown, path: string, allowed: ReadonlySet<string>): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return;
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length === 0) return;
  const suggestion = path === "grading" && unknown.includes("adjustments") ? '; use "adjust"' : "";
  const scope = path === "grading" ? "top-level color-grading" : `color-grading ${path}`;
  throw new Error(`Unknown ${scope} key: ${unknown.join(", ")}${suggestion}`);
}

function assertKnownGradingShape(value: unknown): void {
  assertKnownKeys(value, "grading", GRADING_KEYS);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return;
  assertKnownKeys(Reflect.get(value, "adjust"), "adjust", ADJUST_KEYS);
  assertKnownKeys(Reflect.get(value, "details"), "details", DETAIL_KEYS);
  assertKnownKeys(Reflect.get(value, "effects"), "effects", EFFECT_KEYS);
  assertKnownKeys(Reflect.get(value, "lut"), "lut", LUT_KEYS);
}

function queryIncludingTemplates(root: Document | Element, selector: string): Element[] {
  const matches = Array.from(root.querySelectorAll(selector));
  if (matches.length > 0) return matches;
  for (const template of root.querySelectorAll("template")) {
    const nested = queryIncludingTemplates(template, selector);
    if (nested.length > 0) return nested;
  }
  return [];
}

export function applyColorGradingToHtml(
  source: string,
  options: ApplyColorGradingOptions,
): ApplyColorGradingResult {
  const document = parseSourceDocument(source);
  let matches: Element[];
  try {
    matches = queryIncludingTemplates(document, options.selector);
  } catch {
    throw new Error(`Invalid selector: ${options.selector}`);
  }
  if (matches.length === 0) throw new Error(`Selector did not match: ${options.selector}`);
  if (options.selectorIndex === undefined && matches.length > 1) {
    throw new Error(
      `Selector matched ${matches.length} elements; use a unique selector or --selector-index`,
    );
  }

  const selectorIndex = options.selectorIndex ?? 0;
  const element = matches[selectorIndex];
  if (!element) {
    throw new Error(`--selector-index ${selectorIndex} is outside ${matches.length} matches`);
  }
  const tag = element.tagName.toLowerCase();
  if (tag !== "img" && tag !== "video") {
    throw new Error(`Color grading requires an <img> or <video>; selector matched <${tag}>`);
  }

  let value: string | null = null;
  if (!options.clear) {
    assertKnownGradingShape(options.grading);
    const normalized = normalizeHfColorGrading(options.grading);
    if (!normalized) throw new Error("--grading must be valid HyperFrames color-grading JSON");
    if (isHfColorGradingActive(normalized)) value = serializeHfColorGrading(normalized);
  }

  const changed = element.getAttribute(HF_COLOR_GRADING_ATTR) !== value;
  if (!changed) return { html: source, changed: false, tag, value };

  const patched = patchElementInHtml(source, { selector: options.selector, selectorIndex }, [
    { type: "attribute", property: HF_COLOR_GRADING_ATTR, value },
  ]);
  if (!patched.matched) throw new Error(`Could not persist selector: ${options.selector}`);
  return { html: patched.html, changed: true, tag, value };
}

function parseSelectorIndex(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("--selector-index must be a non-negative integer");
  }
  return value;
}

function parseGrading(raw: string | undefined, clear: boolean): unknown {
  if (clear) {
    if (raw !== undefined) throw new Error("Use either --grading or --clear, not both");
    return undefined;
  }
  if (raw === undefined) throw new Error("--grading <json> is required unless --clear is used");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Could not parse --grading JSON: ${normalizeErrorMessage(error)}`);
  }
}

function mutationVerb(action: "apply" | "clear", changed: boolean, dryRun: boolean): string {
  if (dryRun) return `Would ${action}`;
  if (!changed) return action === "apply" ? "Already applied" : "Already clear";
  return action === "apply" ? "Applied" : "Cleared";
}

export const mediaTreatmentCommand = defineCommand({
  meta: {
    name: "media-treatment",
    description: "Discover, apply, or clear deterministic media treatments",
  },
  args: {
    capabilities: {
      type: "boolean",
      description: "Print a concise agent-readable capability overview",
      default: false,
    },
    capability: {
      type: "string",
      description: "Inspect one family, control, effect, preset, or palette",
    },
    all: {
      type: "boolean",
      description: "Print the exhaustive capability catalog",
      default: false,
    },
    project: { type: "string", description: "Project directory (default: cwd)" },
    file: {
      type: "string",
      description: "Composition file relative to project (default: index.html)",
    },
    selector: {
      type: "string",
      description: "Unique CSS selector for one <img> or <video>",
    },
    "selector-index": {
      type: "string",
      description: "Zero-based match index when the selector is not unique",
    },
    grading: { type: "string", description: "Canonical color-grading JSON payload" },
    clear: { type: "boolean", description: "Remove color grading from the target", default: false },
    "dry-run": {
      type: "boolean",
      description: "Validate and report without writing",
      default: false,
    },
    json: { type: "boolean", description: "Output an agent-friendly JSON result", default: false },
  },
  run({ args }) {
    const runCapabilityQuery = () => {
      const capability = readOptionalString(args.capability);
      if (
        readOptionalString(args.selector) ||
        readOptionalString(args.grading) ||
        args.clear === true ||
        args["dry-run"] === true
      ) {
        throw new Error("--capabilities cannot be combined with mutation options");
      }
      if (args.all === true && capability) {
        throw new Error("Use either --all or --capability, not both");
      }
      const capabilities = args.all
        ? getHfColorGradingCapabilities()
        : capability
          ? getMediaTreatmentCapabilityDetail(capability)
          : getMediaTreatmentCapabilityOverview();
      console.log(JSON.stringify(withMeta({ ok: true, capabilities }), null, 2));
    };

    const resolveMutationFile = () => {
      const project = resolveProject(readOptionalString(args.project));
      const fileArg = readOptionalString(args.file) ?? "index.html";
      const filePath = resolve(project.dir, fileArg);
      if (!isPathInside(filePath, project.dir) || !filePath.toLowerCase().endsWith(".html")) {
        throw new Error("--file must be an HTML file inside the project");
      }
      if (!existsSync(filePath)) throw new Error(`Composition file not found: ${fileArg}`);
      return { project, filePath };
    };

    const prepareMutation = () => {
      const { project, filePath } = resolveMutationFile();
      const selector = readOptionalString(args.selector);
      if (!selector) throw new Error("--selector is required");
      const clear = args.clear === true;
      const selectorIndex = parseSelectorIndex(readOptionalString(args["selector-index"]));
      const result = applyColorGradingToHtml(readFileSync(filePath, "utf8"), {
        selector,
        selectorIndex,
        grading: parseGrading(readOptionalString(args.grading), clear),
        clear,
      });
      const dryRun = args["dry-run"] === true;
      if (result.changed && !dryRun) writeFileSync(filePath, result.html);

      const action: "clear" | "apply" = result.value === null ? "clear" : "apply";
      return {
        action,
        result,
        selector,
        payload: {
          ok: true,
          action,
          file: relative(project.dir, filePath) || "index.html",
          selector,
          selectorIndex: selectorIndex ?? 0,
          tag: result.tag,
          changed: result.changed,
          dryRun,
        },
      };
    };

    try {
      if (args.capabilities === true) return runCapabilityQuery();
      if (readOptionalString(args.capability) || args.all === true) {
        throw new Error("--capability and --all require --capabilities");
      }
      const { action, result, selector, payload } = prepareMutation();
      if (args.json === true) {
        console.log(JSON.stringify(withMeta(payload), null, 2));
      } else {
        const verb = mutationVerb(action, result.changed, payload.dryRun);
        console.log(`${c.success("◇")}  ${verb} media treatment on ${c.accent(selector)}`);
      }
    } catch (error) {
      const message = normalizeErrorMessage(error);
      if (args.json === true) console.log(JSON.stringify(withMeta({ ok: false, error: message })));
      else console.error(`${c.error("✗")} ${message}`);
      failCommand();
    }
  },
});
