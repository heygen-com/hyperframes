// fallow-ignore-file code-duplication complexity
import type { LintContext } from "../context";
import type { HyperframeLintFinding, LintRule } from "../types";
import {
  ANIME_HFANIME_ASSIGN_PATTERN,
  ANIME_REGISTER_CALL_PATTERN,
  extractScriptTextsAndSrcs,
  readAttr,
  stripJsComments,
  truncateSnippet,
} from "../utils";

type AnimeMethod = "createTimeline" | "animate";

type AnimeCall = {
  method: AnimeMethod;
  raw: string;
  optionObjects: string[];
};

const ANIME_SCRIPT_SRC_PATTERN = /(?:^|[/.@-])anime(?:js)?(?:[/.@-]|$)|anime\.umd/i;
const ANIME_USAGE_PATTERN = /\banime\s*\.\s*(?:createTimeline|animate)\s*\(/;
const ANIME_CALL_PATTERN = /\banime\s*\.\s*(createTimeline|animate)\s*\(/g;

function toAnimeMethod(value: string | undefined): AnimeMethod | null {
  if (value === "createTimeline" || value === "animate") return value;
  return null;
}

function isSubCompositionContext(ctx: LintContext): boolean {
  return Boolean(
    ctx.options.isSubComposition || ctx.rawSource.trimStart().toLowerCase().startsWith("<template"),
  );
}

function collectScriptSignals(scripts: LintContext["scripts"]): {
  texts: string[];
  srcs: string[];
} {
  const { texts, srcs } = extractScriptTextsAndSrcs(scripts);
  return {
    texts: texts.map((text) => stripJsComments(text)),
    srcs,
  };
}

function hasAnimeSignal(texts: string[], srcs: string[]): boolean {
  return (
    srcs.some((src) => ANIME_SCRIPT_SRC_PATTERN.test(src)) ||
    texts.some((text) => ANIME_USAGE_PATTERN.test(text))
  );
}

function hasAnimeRegistration(texts: string[]): boolean {
  return texts.some(
    (text) => ANIME_REGISTER_CALL_PATTERN.test(text) || ANIME_HFANIME_ASSIGN_PATTERN.test(text),
  );
}

function findMatchingDelimiter(
  source: string,
  openIndex: number,
  openChar: string,
  closeChar: string,
): number {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;

  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i] ?? "";

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === openChar) depth += 1;
    if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function splitTopLevelArgs(argsSource: string): string[] {
  const args: string[] = [];
  let start = 0;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;

  for (let i = 0; i < argsSource.length; i += 1) {
    const ch = argsSource[i] ?? "";

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") parenDepth += 1;
    if (ch === ")") parenDepth -= 1;
    if (ch === "{") braceDepth += 1;
    if (ch === "}") braceDepth -= 1;
    if (ch === "[") bracketDepth += 1;
    if (ch === "]") bracketDepth -= 1;
    if (ch !== "," || parenDepth !== 0 || braceDepth !== 0 || bracketDepth !== 0) continue;

    const arg = argsSource.slice(start, i).trim();
    if (arg) args.push(arg);
    start = i + 1;
  }

  const finalArg = argsSource.slice(start).trim();
  if (finalArg) args.push(finalArg);
  return args;
}

function leadingObjectLiteral(arg: string | undefined): string | null {
  const trimmed = arg?.trim();
  if (!trimmed || !trimmed.startsWith("{")) return null;
  const end = findMatchingDelimiter(trimmed, 0, "{", "}");
  if (end < 0) return null;
  return trimmed.slice(0, end + 1);
}

function optionObjectsForCall(method: AnimeMethod, args: string[]): string[] {
  if (method === "createTimeline") {
    const object = leadingObjectLiteral(args[0]);
    return object ? [object] : [];
  }

  return args
    .map((arg) => leadingObjectLiteral(arg))
    .filter((object): object is string => object !== null);
}

function extractAnimeCalls(text: string): AnimeCall[] {
  const calls: AnimeCall[] = [];
  const pattern = new RegExp(ANIME_CALL_PATTERN.source, ANIME_CALL_PATTERN.flags);
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const method = toAnimeMethod(match[1]);
    if (!method) continue;
    const openParenIndex = pattern.lastIndex - 1;
    const closeParenIndex = findMatchingDelimiter(text, openParenIndex, "(", ")");
    if (closeParenIndex < 0) continue;
    const argsSource = text.slice(openParenIndex + 1, closeParenIndex);
    const args = splitTopLevelArgs(argsSource);
    calls.push({
      method,
      raw: text.slice(match.index, closeParenIndex + 1),
      optionObjects: optionObjectsForCall(method, args),
    });
    pattern.lastIndex = closeParenIndex + 1;
  }

  return calls;
}

function objectHasProperty(objectSource: string, propertyName: string): boolean {
  return new RegExp(`(?:^|[{,])\\s*${propertyName}\\s*:`).test(objectSource);
}

function objectPropertyIsTrue(objectSource: string, propertyName: string): boolean {
  return new RegExp(`(?:^|[{,])\\s*${propertyName}\\s*:\\s*true\\b`).test(objectSource);
}

function objectPropertyIsInfiniteLoop(objectSource: string): boolean {
  return /(?:^|[{,])\s*loop\s*:\s*(?:true|-1)\b/.test(objectSource);
}

function autoplayNeedsWarning(call: AnimeCall): boolean {
  if (call.method === "animate") {
    return call.optionObjects.some((object) => objectPropertyIsTrue(object, "autoplay"));
  }

  const options = call.optionObjects[0];
  if (!options) return true;
  if (!objectHasProperty(options, "autoplay")) return true;
  return objectPropertyIsTrue(options, "autoplay");
}

function hasInfiniteLoop(call: AnimeCall): boolean {
  return call.optionObjects.some((object) => objectPropertyIsInfiniteLoop(object));
}

export const animejsRules: LintRule<LintContext>[] = [
  // animejs_script_not_registered
  (ctx) => {
    if (isSubCompositionContext(ctx)) return [];
    const { texts, srcs } = collectScriptSignals(ctx.scripts);
    if (!hasAnimeSignal(texts, srcs) || hasAnimeRegistration(texts)) return [];

    return [
      {
        code: "animejs_script_not_registered",
        severity: "error",
        message:
          "anime.js is present but no instance is registered with HyperFrames. The runtime needs an explicit registration call to connect anime.js to the master clock and infer duration.",
        fixHint:
          "After creating a finite anime.js instance, call `hyperframesAnime.register(id, instance, { labels })` using the composition's data-composition-id.",
      },
    ];
  },

  // animejs_autoplay_not_disabled
  ({ scripts }) => {
    const { texts } = collectScriptSignals(scripts);
    const findings: HyperframeLintFinding[] = [];

    for (const text of texts) {
      for (const call of extractAnimeCalls(text)) {
        if (!autoplayNeedsWarning(call)) continue;
        findings.push({
          code: "animejs_autoplay_not_disabled",
          severity: "warning",
          message:
            "anime.js timelines must be paused for HyperFrames. A playing timeline breaks deterministic seek-based rendering.",
          fixHint: "Set `autoplay: false` in the `createTimeline`/`animate` options.",
          snippet: truncateSnippet(call.raw),
        });
      }
    }

    return findings;
  },

  // animejs_infinite_loop_missing_duration
  (ctx) => {
    if (isSubCompositionContext(ctx)) return [];
    if (!ctx.rootTag || readAttr(ctx.rootTag.raw, "data-duration") !== null) return [];
    const { texts } = collectScriptSignals(ctx.scripts);
    const findings: HyperframeLintFinding[] = [];

    for (const text of texts) {
      for (const call of extractAnimeCalls(text)) {
        if (!hasInfiniteLoop(call)) continue;
        findings.push({
          code: "animejs_infinite_loop_missing_duration",
          severity: "error",
          message:
            "anime.js uses an infinite loop but the root composition has no data-duration. Infinite loops make total render length undeterminable without an explicit duration.",
          fixHint:
            'Add data-duration="<seconds>" to the root element with the intended total length.',
          snippet: truncateSnippet(call.raw),
        });
      }
    }

    return findings;
  },
];
