import {
  parse,
  MediaFeatureLT,
  MediaFeatureGT,
  MediaFeatureEQ,
  isMediaQueryInvalid,
  isMediaQueryWithType,
  isMediaQueryWithoutType,
  isMediaCondition,
  isMediaNot,
  isMediaInParens,
  isMediaConditionListWithAnd,
  isMediaConditionListWithOr,
  isGeneralEnclosed,
  isMediaFeature,
  isMediaFeatureBoolean,
  isMediaFeaturePlain,
  isMediaFeatureRangeNameValue,
  isMediaFeatureRangeValueName,
  isMediaFeatureRangeValueNameValue,
  type MediaQuery,
  type MediaCondition,
  type MediaNot,
  type MediaInParens,
  type MediaConditionListWithAnd,
  type MediaConditionListWithOr,
  type GeneralEnclosed,
  type MediaFeature,
  type MediaFeatureValue,
  type MediaFeatureComparison,
} from "@csstools/media-query-list-parser";
import {
  isTokenWhiteSpaceOrComment,
  isTokenIdent,
  isTokenNumber,
  isTokenDimension,
  isTokenDelim,
} from "@csstools/css-tokenizer";
import type { FontMediaContext } from "./fontMediaContext.js";

export type MediaTruth = boolean | "unknown";

type RangeFeature = {
  kind: "range";
  value: number;
  unit: "length" | "resolution" | "ratio" | "integer";
};
type DiscreteFeature = {
  kind: "discrete";
  value: string | number;
  choices: readonly (string | number)[];
};
type Feature = RangeFeature | DiscreteFeature;
type Term =
  | MediaCondition
  | MediaNot
  | MediaInParens
  | MediaConditionListWithAnd
  | MediaConditionListWithOr
  | GeneralEnclosed
  | MediaFeature;

function headlessScreenFeatures(context: FontMediaContext) {
  const { width, height } = context.viewport;
  // test-font-media-parity.ts checks these defaults through the engine's real launcher.
  // Capture modes disagree on device-* values. Leave them unknown: discovery offers
  // their fonts, but a conditional face cannot suppress deterministic injection.
  return {
    width: { kind: "range", value: width, unit: "length" },
    height: { kind: "range", value: height, unit: "length" },
    "aspect-ratio": { kind: "range", value: width / height, unit: "ratio" },
    resolution: { kind: "range", value: context.deviceScaleFactor, unit: "resolution" },
    color: { kind: "range", value: 8, unit: "integer" },
    "color-index": { kind: "range", value: 0, unit: "integer" },
    monochrome: { kind: "range", value: 0, unit: "integer" },
    grid: { kind: "discrete", value: 0, choices: [0, 1] },
    orientation: {
      kind: "discrete",
      value: height >= width ? "portrait" : "landscape",
      choices: ["portrait", "landscape"],
    },
    "prefers-color-scheme": { kind: "discrete", value: "light", choices: ["light", "dark"] },
    "prefers-reduced-motion": {
      kind: "discrete",
      value: "no-preference",
      choices: ["no-preference", "reduce"],
    },
    "prefers-contrast": {
      kind: "discrete",
      value: "no-preference",
      choices: ["no-preference", "less", "more", "custom"],
    },
    "prefers-reduced-transparency": {
      kind: "discrete",
      value: "no-preference",
      choices: ["no-preference", "reduce"],
    },
    "forced-colors": { kind: "discrete", value: "none", choices: ["none", "active"] },
    hover: { kind: "discrete", value: "none", choices: ["none", "hover"] },
    "any-hover": { kind: "discrete", value: "none", choices: ["none", "hover"] },
    pointer: { kind: "discrete", value: "none", choices: ["none", "coarse", "fine"] },
    "any-pointer": { kind: "discrete", value: "none", choices: ["none", "coarse", "fine"] },
    "color-gamut": { kind: "discrete", value: "srgb", choices: ["srgb", "p3", "rec2020"] },
    "dynamic-range": { kind: "discrete", value: "standard", choices: ["standard", "high"] },
    update: { kind: "discrete", value: "fast", choices: ["none", "slow", "fast"] },
    "overflow-block": { kind: "discrete", value: "scroll", choices: ["none", "scroll", "paged"] },
    "overflow-inline": { kind: "discrete", value: "scroll", choices: ["none", "scroll"] },
    "display-mode": {
      kind: "discrete",
      value: "browser",
      choices: [
        "browser",
        "fullscreen",
        "standalone",
        "minimal-ui",
        "window-controls-overlay",
        "picture-in-picture",
      ],
    },
    scripting: { kind: "discrete", value: "enabled", choices: ["none", "initial-only", "enabled"] },
    "horizontal-viewport-segments": { kind: "range", value: 1, unit: "integer" },
    "vertical-viewport-segments": { kind: "range", value: 1, unit: "integer" },
  } satisfies Record<string, Feature>;
}

// The <number>, <ratio>, <resolution> and <length> value grammars of a media feature.
// fallow-ignore-next-line complexity
function numericValue(
  value: MediaFeatureValue,
  unit: RangeFeature["unit"],
  context: FontMediaContext,
): number | null {
  const tokens = value.tokens().filter((token) => !isTokenWhiteSpaceOrComment(token));
  const [token] = tokens;
  if (
    unit === "ratio" &&
    tokens.length === 3 &&
    isTokenNumber(token) &&
    isTokenDelim(tokens[1]) &&
    tokens[1][4].value === "/" &&
    isTokenNumber(tokens[2])
  ) {
    if (token[4].value < 0 || tokens[2][4].value < 0) return null;
    const ratio = token[4].value / tokens[2][4].value;
    // Chrome orders a degenerate 0/0 ratio like 1/0: above every viewport ratio.
    return Number.isNaN(ratio) ? Number.POSITIVE_INFINITY : ratio;
  }
  if (tokens.length !== 1) return null;
  if (isTokenNumber(token)) {
    if (unit === "ratio") return token[4].value < 0 ? null : token[4].value;
    if (unit === "integer" && token[4].type === "integer") return token[4].value;
    return unit === "length" && token[4].value === 0 ? 0 : null;
  }
  if (!isTokenDimension(token)) return null;
  if (unit === "resolution" && token[4].value < 0) return null;
  const { width, height } = context.viewport;
  const lengthUnits = {
    px: 1,
    in: 96,
    cm: 96 / 2.54,
    mm: 96 / 25.4,
    q: 96 / 101.6,
    pt: 96 / 72,
    pc: 16,
    em: 16,
    rem: 16,
    vw: width / 100,
    vh: height / 100,
    vmin: Math.min(width, height) / 100,
    vmax: Math.max(width, height) / 100,
  } satisfies Record<string, number>;
  const resolutionUnits = { dppx: 1, x: 1, dpi: 1 / 96, dpcm: 2.54 / 96 } satisfies Record<
    string,
    number
  >;
  const units: Readonly<Record<string, number>> =
    unit === "resolution" ? resolutionUnits : lengthUnits;
  if (unit !== "length" && unit !== "resolution") return null;
  const factor = units[token[4].unit.toLowerCase()];
  return factor === undefined ? null : token[4].value * factor;
}

function compare(
  left: number,
  operator: MediaFeatureComparison | false,
  right: number,
): MediaTruth {
  switch (operator) {
    case MediaFeatureLT.LT:
      return left < right;
    case MediaFeatureLT.LT_OR_EQ:
      return left <= right;
    case MediaFeatureGT.GT:
      return left > right;
    case MediaFeatureGT.GT_OR_EQ:
      return left >= right;
    case MediaFeatureEQ.EQ:
      return left === right;
    case false:
      return "unknown";
    default: {
      const exhaustive: never = operator;
      throw new Error(`Unexpected media comparison: ${exhaustive}`);
    }
  }
}

function negate(value: MediaTruth): MediaTruth {
  return value === "unknown" ? "unknown" : !value;
}

// One branch per media feature value type: Media Queries 4, "Evaluating Media Features".
// fallow-ignore-next-line complexity
function evaluateFeature(
  node: MediaFeature,
  features: Readonly<Record<string, Feature>>,
  context: FontMediaContext,
): MediaTruth {
  const feature = node.feature;
  let name = feature.getName().toLowerCase();
  let prefix: "min" | "max" | null = null;
  if (isMediaFeaturePlain(feature)) {
    if (name.startsWith("min-")) {
      prefix = "min";
      name = name.slice(4);
    } else if (name.startsWith("max-")) {
      prefix = "max";
      name = name.slice(4);
    }
  }
  const state = Object.hasOwn(features, name) ? features[name] : undefined;
  if (!state) return "unknown";
  if (isMediaFeatureBoolean(feature))
    return state.value !== 0 && state.value !== "none" && state.value !== "no-preference";
  if (isMediaFeaturePlain(feature)) {
    if (state.kind === "discrete") {
      if (prefix) return "unknown";
      const tokens = feature.value.tokens().filter((token) => !isTokenWhiteSpaceOrComment(token));
      const [token] = tokens;
      if (tokens.length !== 1) return "unknown";
      let actual: string | number;
      if (isTokenIdent(token)) actual = token[4].value.toLowerCase();
      else if (isTokenNumber(token) && token[4].type === "integer") actual = token[4].value;
      else return "unknown";
      return state.choices.includes(actual) ? state.value === actual : "unknown";
    }
    const value = numericValue(feature.value, state.unit, context);
    if (value === null) return "unknown";
    if (prefix === "min") return state.value >= value;
    if (prefix === "max") return state.value <= value;
    return state.value === value;
  }
  if (state.kind !== "range") return "unknown";
  if (isMediaFeatureRangeNameValue(feature)) {
    const value = numericValue(feature.value, state.unit, context);
    return value === null ? "unknown" : compare(state.value, feature.operatorKind(), value);
  }
  if (isMediaFeatureRangeValueName(feature)) {
    const value = numericValue(feature.value, state.unit, context);
    return value === null ? "unknown" : compare(value, feature.operatorKind(), state.value);
  }
  if (isMediaFeatureRangeValueNameValue(feature)) {
    const left = numericValue(feature.valueOne, state.unit, context);
    const right = numericValue(feature.valueTwo, state.unit, context);
    if (left === null || right === null) return "unknown";
    const first = compare(left, feature.valueOneOperatorKind(), state.value);
    const second = compare(state.value, feature.valueTwoOperatorKind(), right);
    if (first === "unknown" || second === "unknown") return "unknown";
    return first && second;
  }
  const exhaustive: never = feature;
  throw new Error(`Unexpected media feature: ${exhaustive}`);
}

// One branch per <media-in-parens> production: Media Queries 4, "Evaluating Media Queries".
// fallow-ignore-next-line complexity
function evaluateTerm(
  node: Term,
  features: Readonly<Record<string, Feature>>,
  context: FontMediaContext,
): MediaTruth {
  if (isGeneralEnclosed(node)) return "unknown";
  if (isMediaFeature(node)) return evaluateFeature(node, features, context);
  if (isMediaCondition(node) || isMediaInParens(node))
    return evaluateTerm(node.media, features, context);
  if (isMediaNot(node)) return negate(evaluateTerm(node.media, features, context));
  if (isMediaConditionListWithAnd(node) || isMediaConditionListWithOr(node)) {
    const conjunction = isMediaConditionListWithAnd(node);
    let unknown = false;
    for (const child of [node.leading, ...node.list.map((entry) => entry.media)]) {
      const value = evaluateTerm(child, features, context);
      if (value === "unknown") unknown = true;
      else if (conjunction && !value) return false;
      else if (!conjunction && value) return true;
    }
    return unknown ? "unknown" : conjunction;
  }
  const exhaustive: never = node;
  throw new Error(`Unexpected media term: ${exhaustive}`);
}

function evaluateQuery(
  query: MediaQuery,
  features: Readonly<Record<string, Feature>>,
  context: FontMediaContext,
): MediaTruth {
  if (isMediaQueryInvalid(query)) return false;
  if (isMediaQueryWithoutType(query)) return evaluateTerm(query.media, features, context);
  if (isMediaQueryWithType(query)) {
    const mediaType = query.getMediaType().toLowerCase();
    let value: MediaTruth = mediaType === "screen" || mediaType === "all";
    if (value && query.media) value = evaluateTerm(query.media, features, context);
    return query.getModifier().toLowerCase() === "not" ? negate(value) : value;
  }
  const exhaustive: never = query;
  throw new Error(`Unexpected media query: ${exhaustive}`);
}

export function createFontMediaEvaluator(
  context: FontMediaContext,
): (media: string | null) => MediaTruth {
  const features = headlessScreenFeatures(context);
  const cache = new Map<string, MediaTruth>();
  return (media) => {
    if (!media?.trim()) return true;
    const cached = cache.get(media);
    if (cached !== undefined) return cached;
    let result: MediaTruth = false;
    for (const query of parse(media, { preserveInvalidMediaQueries: true })) {
      const value = evaluateQuery(query, features, context);
      if (value === true) {
        result = true;
        break;
      }
      if (value === "unknown") result = "unknown";
    }
    cache.set(media, result);
    return result;
  };
}
