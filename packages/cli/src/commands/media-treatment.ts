import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  HF_COLOR_GRADING_ATTR,
  getHfColorGradingCapabilities,
  hasHfColorGradingAuthoredValues,
  isPathInside,
  normalizeHfColorGrading,
  serializeHfColorGrading,
} from "@hyperframes/core";
import {
  isColorGradingVariableRef,
  validateColorGradingContract,
} from "@hyperframes/parsers/color-grading-contract";
import {
  cleanAssetUrl,
  isRemoteOrInlineUrl,
  resolveExistingLocalAsset,
} from "@hyperframes/parsers/asset-resolution";
import { rewriteAssetPath } from "@hyperframes/parsers/asset-paths";
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
import { analyzeMediaTreatment } from "./media-treatment-analysis.js";

export function getMediaTreatmentCapabilityOverview() {
  const capabilities = getHfColorGradingCapabilities();
  const family = (id: string, label: string, description: string) => ({
    id,
    label,
    description,
  });

  return {
    version: capabilities.version,
    targetTags: capabilities.targetTags,
    colorSpace: capabilities.colorSpace,
    families: [
      family("correction", "Adjust", "Fix exposure, tonal balance, color casts, and saturation."),
      family(
        "grading",
        "Color Grading",
        "Shape tonal color with wheels, RGB and hue curves, and selective HSL correction.",
      ),
      family(
        "presets",
        "Presets",
        "Apply a tested starting point, then tune only when the source or intent requires it.",
      ),
      family("finishing", "Finish", "Shape vignette and deterministic film grain."),
      ...capabilities.effectFamilies,
      family(
        "palettes",
        "Palettes",
        "Reusable two-to-six-color palettes for compatible art effects.",
      ),
      family(
        "animation",
        "Animation",
        "Seek-safe CSS properties that registered GSAP timelines may animate.",
      ),
      family("lut", "Custom LUT", "Apply a user-owned 3D .cube LUT."),
      {
        id: "overlays",
        label: "Overlays",
        description: "Install authored HUD, light-leak, flash, or freeze-frame overlay blocks.",
        owner: "registry",
      },
    ],
    discovery: {
      detail: "Use --capability <family-or-item> for exact controls and examples.",
      full: "Use --all only for tooling or exhaustive inspection.",
    },
  };
}

export function getMediaTreatmentCapabilityDetail(id: string): unknown {
  const capabilities = getHfColorGradingCapabilities();
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

  const effect = capabilities.effects.find(({ key }) => key === id);
  if (effect) {
    return {
      id,
      family: effect.family,
      label: effect.label,
      description: effect.description,
      renderLane: effect.renderLane,
      supportsPalette: effect.supportsPalette,
      apply: { effects: effect.apply },
      controls: effect.controls,
      animation: animation(`effects.${id}`),
    };
  }

  const effectFamily = capabilities.effectFamilies.find((family) => family.id === id);
  if (effectFamily) {
    return {
      ...effectFamily,
      effects: capabilities.effects
        .filter((candidate) => candidate.family === id)
        .map((candidate) => ({
          id: candidate.key,
          label: candidate.label,
          description: candidate.description,
          renderLane: candidate.renderLane,
          supportsPalette: candidate.supportsPalette,
          animatable: capabilities.animatable.some(
            ({ path }) => path === `effects.${candidate.key}`,
          ),
        })),
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
    grading: {
      id,
      description:
        "Shape media after primary correction with wheels, curves, HSL secondaries, and an optional user-owned LUT.",
      order: [
        "adjust",
        "wheels",
        "curves",
        "hueCurves",
        "secondaries",
        "lut",
        "details",
        "effects",
      ],
      discover: ["wheels", "curves", "hue-curves", "secondary", "scopes", "lut"],
    },
    correction: {
      id,
      description: "Fix exposure, tonal balance, color casts, and saturation.",
      controls: capabilities.adjustments,
    },
    wheels: {
      id,
      description: "Shadow, midtone, and highlight color wheels.",
      contract: capabilities.wheels,
      apply: {
        wheels: {
          shadows: { hue: 205, amount: 0.08, level: 0 },
          highlights: { hue: 35, amount: 0.06, level: 0 },
        },
      },
    },
    curves: {
      id,
      description: "Master and per-channel curves using normalized [input, output] points.",
      contract: capabilities.curves,
      apply: {
        curves: {
          master: [
            [0, 0],
            [0.25, 0.2],
            [0.75, 0.82],
            [1, 1],
          ],
        },
      },
    },
    "hue-curves": {
      id,
      description: "Hue-selective curves using [hueDegrees, delta] points.",
      contract: capabilities.hueCurves,
      apply: {
        hueCurves: {
          hueVsSaturation: [
            [180, 0],
            [210, 0.15],
            [240, 0],
          ],
        },
      },
    },
    secondary: {
      id,
      description: "Up to four ordered HSL selections with bounded color correction.",
      contract: capabilities.secondaries,
      apply: {
        secondaries: [
          {
            key: {
              hue: { center: 215, range: 25, softness: 10 },
              saturation: { min: 0.2, max: 1, softness: 0.08 },
              luma: { min: 0.1, max: 0.9, softness: 0.08 },
            },
            correction: { saturation: 0.15, luma: 0.03 },
          },
        ],
      },
    },
    scopes: {
      id,
      description:
        "Deterministic source measurements for agent decisions; visual scopes remain a Studio display.",
      command:
        "hyperframes media-treatment --file compositions/scene.html --selector '#hero' --analyze --json",
      output: [
        "source color metadata and HDR/LOG warnings",
        "luma percentile and clipping evidence",
        "bounded suggested primary correction",
      ],
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
    `hyperframes media-treatment --capability kuwahara --json`,
  ],
  [
    "Inspect the exhaustive machine-readable catalog",
    `hyperframes media-treatment --capabilities --all --json`,
  ],
  [
    "Apply a resolved treatment to one media element",
    `hyperframes media-treatment --selector '#hero' --grading '{"preset":"skin-soft","intensity":0.6}' --apply`,
  ],
  [
    "Preview the exact mutation without writing",
    `hyperframes media-treatment --file compositions/scene.html --selector 'video' --grading '{"preset":"warm-daylight"}' --apply --dry-run --json`,
  ],
  [
    "Measure one local media source before choosing a correction",
    `hyperframes media-treatment --selector '#hero' --analyze --json`,
  ],
  ["Remove a treatment", `hyperframes media-treatment --selector '#hero' --clear`],
];

interface ApplyMediaTreatmentOptions {
  selector: string;
  selectorIndex?: number;
  grading?: unknown;
  clear?: boolean;
}

interface ApplyMediaTreatmentResult {
  html: string;
  changed: boolean;
  tag: "img" | "video";
  value: string | null;
  before: unknown;
  after: unknown;
}

function parseSourceDocument(source: string): Document {
  if (/<!doctype|<html[\s>]/i.test(source)) return parseHTML(source).document;
  return parseHTML(`<!DOCTYPE html><html><body>${source}</body></html>`).document;
}

function assertKnownGradingShape(value: unknown): void {
  const issue = validateColorGradingContract(value)[0];
  if (issue) {
    const hint = issue.hint ? ` ${issue.hint}` : "";
    throw new Error(`Invalid color-grading ${issue.path}: ${issue.message}.${hint}`);
  }
}

function containsColorGradingVariableRef(value: unknown): boolean {
  if (isColorGradingVariableRef(value)) return true;
  if (Array.isArray(value)) return value.some(containsColorGradingVariableRef);
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).some(containsColorGradingVariableRef);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStoredGrading(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function mergeGradingPatch(current: unknown, patch: unknown): unknown {
  if (!isRecord(current) || !isRecord(patch)) return patch;
  const merged = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    merged[key] =
      isRecord(value) && isRecord(merged[key]) ? mergeGradingPatch(merged[key], value) : value;
  }
  return merged;
}

function serializeGradingPatch(before: unknown, patch: unknown): string | null {
  assertKnownGradingShape(patch);
  if (isColorGradingVariableRef(before) && isRecord(patch)) {
    throw new Error("Cannot merge a grading patch into an unresolved whole-grade variable");
  }
  const current =
    typeof before === "string" && !isColorGradingVariableRef(before) ? { preset: before } : before;
  const grading = mergeGradingPatch(current, patch);
  assertKnownGradingShape(grading);
  if (containsColorGradingVariableRef(grading)) {
    return typeof grading === "string" ? grading.trim() : JSON.stringify(grading);
  }
  const normalized = normalizeHfColorGrading(grading);
  if (!normalized) throw new Error("--grading must be valid HyperFrames color-grading JSON");
  return hasHfColorGradingAuthoredValues(normalized) ? serializeHfColorGrading(normalized) : null;
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

function selectMediaElement(
  source: string,
  selector: string,
  selectorIndex?: number,
): { element: Element; selectorIndex: number; tag: "img" | "video" } {
  const document = parseSourceDocument(source);
  let matches: Element[];
  try {
    matches = queryIncludingTemplates(document, selector);
  } catch {
    throw new Error(`Invalid selector: ${selector}`);
  }
  if (matches.length === 0) throw new Error(`Selector did not match: ${selector}`);
  if (selectorIndex === undefined && matches.length > 1) {
    throw new Error(
      `Selector matched ${matches.length} elements; use a unique selector or --selector-index`,
    );
  }

  const resolvedIndex = selectorIndex ?? 0;
  const element = matches[resolvedIndex];
  if (!element) {
    throw new Error(`--selector-index ${resolvedIndex} is outside ${matches.length} matches`);
  }
  const tag = element.tagName.toLowerCase();
  if (tag !== "img" && tag !== "video") {
    throw new Error(`Color grading requires an <img> or <video>; selector matched <${tag}>`);
  }
  return { element, selectorIndex: resolvedIndex, tag };
}

export function applyMediaTreatmentToHtml(
  source: string,
  options: ApplyMediaTreatmentOptions,
): ApplyMediaTreatmentResult {
  const { element, selectorIndex, tag } = selectMediaElement(
    source,
    options.selector,
    options.selectorIndex,
  );
  const before = parseStoredGrading(element.getAttribute(HF_COLOR_GRADING_ATTR));

  const value = options.clear ? null : serializeGradingPatch(before, options.grading);

  const changed = element.getAttribute(HF_COLOR_GRADING_ATTR) !== value;
  const after = parseStoredGrading(value);
  if (!changed) return { html: source, changed: false, tag, value, before, after };

  const patched = patchElementInHtml(source, { selector: options.selector, selectorIndex }, [
    { type: "attribute", property: HF_COLOR_GRADING_ATTR, value },
  ]);
  if (!patched.matched) throw new Error(`Could not persist selector: ${options.selector}`);
  return { html: patched.html, changed: true, tag, value, before, after };
}

function parseSelectorIndex(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("--selector-index must be a non-negative integer");
  }
  return value;
}

function mediaSourceForElement(element: Element): string {
  const src =
    element.getAttribute("src") ??
    (element.tagName.toLowerCase() === "video"
      ? element.querySelector("source")?.getAttribute("src")
      : null);
  if (!src) throw new Error("Selected media has no analyzable src");
  return src;
}

export function resolveMediaTreatmentSource(
  projectDir: string,
  compositionFile: string,
  source: string,
): string {
  const sourceUrl = source.trim();
  if (!sourceUrl) throw new Error("Selected media has no analyzable local src");
  if (isRemoteOrInlineUrl(sourceUrl)) {
    throw new Error(
      "Media analysis requires a local project asset; freeze remote media with media-use first",
    );
  }
  const cleanSource = cleanAssetUrl(sourceUrl);
  if (!cleanSource) throw new Error("Selected media has no analyzable local src");
  const projectRelative = cleanSource.startsWith("/")
    ? cleanSource
    : rewriteAssetPath(compositionFile, cleanSource, (path) => existsSync(join(projectDir, path)));
  const asset = resolveExistingLocalAsset(projectDir, projectRelative);
  if (!asset) throw new Error(`Media file not found: ${source}`);
  return asset.resolved;
}

function parseGrading(raw: string | undefined, apply: boolean, clear: boolean): unknown {
  if (clear) {
    if (raw !== undefined || apply) {
      throw new Error("Use either --apply with --grading or --clear, not both");
    }
    return undefined;
  }
  if (!apply) {
    if (raw !== undefined) throw new Error("--grading requires --apply");
    throw new Error("Use --apply with --grading <json> or --clear");
  }
  if (raw === undefined) throw new Error("--apply requires --grading <json>");
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

interface MediaTreatmentCommandArgs {
  capabilities?: boolean;
  capability?: string;
  all?: boolean;
  project?: string;
  file?: string;
  selector?: string;
  "selector-index"?: string;
  grading?: string;
  apply?: boolean;
  analyze?: boolean;
  clear?: boolean;
  "dry-run"?: boolean;
  json?: boolean;
}

function runCapabilityQuery(args: MediaTreatmentCommandArgs): void {
  const capability = readOptionalString(args.capability);
  const hasMutationOption = [
    readOptionalString(args.selector),
    readOptionalString(args.grading),
    args.clear,
    args["dry-run"],
    args.apply,
    args.analyze,
  ].some(Boolean);
  if (hasMutationOption) throw new Error("--capabilities cannot be combined with mutation options");
  if (args.all === true && capability)
    throw new Error("Use either --all or --capability, not both");

  let capabilities: unknown = getMediaTreatmentCapabilityOverview();
  if (args.all === true) capabilities = getHfColorGradingCapabilities();
  else if (capability) capabilities = getMediaTreatmentCapabilityDetail(capability);
  console.log(JSON.stringify(withMeta({ ok: true, capabilities }), null, 2));
}

function resolveMutationFile(args: MediaTreatmentCommandArgs) {
  const project = resolveProject(readOptionalString(args.project));
  const fileArg = readOptionalString(args.file) ?? "index.html";
  const filePath = resolve(project.dir, fileArg);
  if (!isPathInside(filePath, project.dir) || !filePath.toLowerCase().endsWith(".html")) {
    throw new Error("--file must be an HTML file inside the project");
  }
  if (!existsSync(filePath)) throw new Error(`Composition file not found: ${fileArg}`);
  return { project, filePath };
}

function analyzeTarget(args: MediaTreatmentCommandArgs) {
  const { project, filePath } = resolveMutationFile(args);
  const selector = readOptionalString(args.selector);
  if (!selector) throw new Error("--selector is required");
  if (
    readOptionalString(args.grading) ||
    args.clear === true ||
    args.apply === true ||
    args["dry-run"] === true
  ) {
    throw new Error("--analyze cannot be combined with mutation options");
  }
  const selectorIndex = parseSelectorIndex(readOptionalString(args["selector-index"]));
  const { element, tag } = selectMediaElement(
    readFileSync(filePath, "utf8"),
    selector,
    selectorIndex,
  );
  const source = mediaSourceForElement(element);
  const compositionFile = relative(project.dir, filePath).split("\\").join("/");
  const mediaPath = resolveMediaTreatmentSource(project.dir, compositionFile, source);
  return {
    ok: true,
    action: "analyze",
    file: compositionFile || "index.html",
    selector,
    selectorIndex: selectorIndex ?? 0,
    tag,
    media: source,
    ...analyzeMediaTreatment(mediaPath),
  };
}

function prepareMutation(args: MediaTreatmentCommandArgs) {
  const { project, filePath } = resolveMutationFile(args);
  const selector = readOptionalString(args.selector);
  if (!selector) throw new Error("--selector is required");
  const clear = args.clear === true;
  const apply = args.apply === true;
  const selectorIndex = parseSelectorIndex(readOptionalString(args["selector-index"]));
  const result = applyMediaTreatmentToHtml(readFileSync(filePath, "utf8"), {
    selector,
    selectorIndex,
    grading: parseGrading(readOptionalString(args.grading), apply, clear),
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
      before: result.before,
      after: result.after,
    },
  };
}

function isCapabilityQuery(args: MediaTreatmentCommandArgs): boolean {
  return (
    args.capabilities === true || Boolean(readOptionalString(args.capability)) || args.all === true
  );
}

function printAnalysis(args: MediaTreatmentCommandArgs): void {
  const result = analyzeTarget(args);
  if (args.json === true) {
    console.log(JSON.stringify(withMeta(result), null, 2));
    return;
  }
  console.log(`${c.success("◇")}  Analyzed ${c.accent(result.selector)}`);
  for (const diagnosis of result.diagnosis) console.log(`   ${diagnosis}`);
  for (const warning of result.warnings) console.log(`   ${c.warn(warning)}`);
  console.log(`   suggested patch: ${JSON.stringify(result.suggestedPatch)}`);
}

function printMutation(args: MediaTreatmentCommandArgs): void {
  const { action, result, selector, payload } = prepareMutation(args);
  if (args.json === true) {
    console.log(JSON.stringify(withMeta(payload), null, 2));
    return;
  }
  const verb = mutationVerb(action, result.changed, payload.dryRun);
  console.log(`${c.success("◇")}  ${verb} media treatment on ${c.accent(selector)}`);
}

function printFailure(error: unknown, json: boolean): void {
  const message = normalizeErrorMessage(error);
  if (json) console.log(JSON.stringify(withMeta({ ok: false, error: message })));
  else console.error(`${c.error("✗")} ${message}`);
  failCommand();
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
    grading: { type: "string", description: "Canonical color-grading JSON patch" },
    apply: {
      type: "boolean",
      description: "Apply the validated grading patch (explicit agent form)",
      default: false,
    },
    analyze: {
      type: "boolean",
      description: "Measure selected local media and suggest a bounded primary correction",
      default: false,
    },
    clear: { type: "boolean", description: "Remove color grading from the target", default: false },
    "dry-run": {
      type: "boolean",
      description: "Validate and report without writing",
      default: false,
    },
    json: { type: "boolean", description: "Output an agent-friendly JSON result", default: false },
  },
  run({ args }) {
    try {
      if (isCapabilityQuery(args)) return runCapabilityQuery(args);
      if (args.analyze === true) {
        printAnalysis(args);
        return;
      }
      printMutation(args);
    } catch (error) {
      printFailure(error, args.json === true);
    }
  },
});
