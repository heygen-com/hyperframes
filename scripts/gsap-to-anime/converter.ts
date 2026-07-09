import { resolveEase } from "@hyperframes/core";
import { rawText } from "./text.ts";
import type { GsapAnimation, ParsedGsap } from "@hyperframes/parsers";
import { extractGsapLabels } from "@hyperframes/parsers/gsap-parser-acorn";
import { parseAttrWrapper, type AttrEntry } from "./attr.ts";
import {
  parseDirectRegistrationPostamble,
  parseRegistrationPostamble,
  stripLegacyRegistrySetup,
} from "./registration.ts";

interface AnimeProperty {
  key: string;
  code: string;
}

const PROP_RENAMES = new Map([
  ["x", "translateX"],
  ["y", "translateY"],
  ["z", "translateZ"],
  ["rotation", "rotate"],
  ["rotationX", "rotateX"],
  ["rotationY", "rotateY"],
  ["rotationZ", "rotateZ"],
  // anime.js v4 uses transformOrigin and perspective unchanged. GSAP's
  // transformPerspective alias is folded into CSS perspective and warned on.
  ["transformPerspective", "perspective"],
]);

// fallow-ignore-next-line complexity
export function convertGsapScript(script: string, parsed: ParsedGsap): string {
  const registration = parseRegistration(parsed);
  const registrationId = registration?.id ?? "main";
  const rawPreamble = convertPreamble(parsed.preamble, parsed);
  const bodyIndent = wrapperBodyIndent(rawPreamble);
  const preamble = bodyIndent ? indentPreambleBody(rawPreamble, bodyIndent) : rawPreamble;
  const markerLines = renderTimelineMarkers(parsed);
  const registrationCall = `${indentBlock(
    renderRegistration(registrationId, parsed.timelineVar, extractGsapLabels(script)),
    bodyIndent,
  )}${renderTrailingCloser(registration?.trailing ?? "")}`;
  const lines = [
    preamble,
    ...(markerLines.length > 0 ? [indentBlock(NOOP_TARGET_DECL, bodyIndent)] : []),
    ...renderTimelineEntries(parsed, markerLines).map((line) => indentBlock(line, bodyIndent)),
    registrationCall,
  ];
  return `\n${lines.filter((line) => line.length > 0).join("\n")}\n`;
}

function convertPreamble(preamble: string, parsed: ParsedGsap): string {
  const withoutRegistry = stripLegacyRegistrySetup(preamble).trim();
  const rewrittenUtils = rewriteGsapToArray(withoutRegistry);
  const timelineVar = parsed.timelineVar;
  if (parsed.sourceTimelineVar) {
    const directTimelineDecl = new RegExp(
      `${escapeRegExp(parsed.sourceTimelineVar)}\\s*=\\s*gsap\\.timeline\\s*\\([^;]*\\)\\s*;?`,
    );
    return rewrittenUtils
      .replace(
        directTimelineDecl,
        `const ${timelineVar} = anime.createTimeline({ autoplay: false });`,
      )
      .split("\n")
      .map((line) => line.trimStart())
      .join("\n");
  }
  const timelineDecl = new RegExp(
    `\\b(const|let|var)\\s+${escapeRegExp(timelineVar)}\\s*=\\s*gsap\\.timeline\\s*\\([^;]*\\)\\s*;?`,
  );
  const converted = rewrittenUtils.replace(
    timelineDecl,
    `const ${timelineVar} = anime.createTimeline({ autoplay: false });`,
  );
  return converted
    .split("\n")
    .map((line) => line.trimStart())
    .join("\n");
}

function parseRegistration(parsed: ParsedGsap) {
  if (parsed.registrationId) {
    return parseDirectRegistrationPostamble(parsed.postamble, parsed.registrationId);
  }
  return parseRegistrationPostamble(parsed.postamble, parsed.timelineVar);
}

function rewriteGsapToArray(source: string): string {
  return source.replace(
    /gsap\.utils\.toArray\s*\(\s*(["'][^"']+["'])\s*\)/g,
    "[...document.querySelectorAll($1)]",
  );
}

function wrapperBodyIndent(preamble: string): string {
  const firstLine = preamble.split("\n").find((line) => line.trim().length > 0);
  return firstLine?.trimEnd().endsWith("{") ? "  " : "";
}

function indentPreambleBody(preamble: string, indent: string): string {
  const lines = preamble.split("\n");
  return lines
    .map((line, index) => (index === 0 || line.trim().length === 0 ? line : `${indent}${line}`))
    .join("\n");
}

function indentBlock(block: string, indent: string): string {
  if (indent.length === 0) return block;
  return block
    .split("\n")
    .map((line) => (line.trim().length === 0 ? line : `${indent}${line}`))
    .join("\n");
}

function convertAnimation(animation: GsapAnimation, timelineVar: string): string {
  const target = JSON.stringify(animation.targetSelector);
  const properties = buildProperties(animation);
  const position = milliseconds(animation.resolvedStart ?? 0);
  return renderAddCall(timelineVar, target, properties, position);
}

const NOOP_TARGET_DECL = "const __hfNoopTarget = { value: 0 };";

function renderTimelineMarkers(parsed: ParsedGsap): Array<{ order: number; code: string }> {
  return (parsed.timelineMarkers ?? []).map((marker) => ({
    order: marker.order,
    code: `${parsed.timelineVar}.add(__hfNoopTarget, { value: 0, duration: 0 }, ${milliseconds(marker.resolvedStart ?? 0)});`,
  }));
}

function renderTimelineEntries(
  parsed: ParsedGsap,
  markers: Array<{ order: number; code: string }>,
): string[] {
  const lines: string[] = [];
  let markerIndex = 0;
  const sortedMarkers = [...markers].sort((a, b) => a.order - b.order);
  parsed.animations.forEach((animation, index) => {
    while (markerIndex < sortedMarkers.length && sortedMarkers[markerIndex]!.order <= index) {
      lines.push(sortedMarkers[markerIndex]!.code);
      markerIndex += 1;
    }
    lines.push(convertAnimation(animation, parsed.timelineVar));
  });
  while (markerIndex < sortedMarkers.length) {
    lines.push(sortedMarkers[markerIndex]!.code);
    markerIndex += 1;
  }
  return lines;
}

// fallow-ignore-next-line complexity
function buildProperties(animation: GsapAnimation): AnimeProperty[] {
  const entries: AnimeProperty[] = [];
  for (const [key, value] of Object.entries(animation.properties)) {
    pushConvertedProperty(entries, animation, key, value);
  }
  entries.push({ key: "duration", code: String(durationMs(animation)) });
  if (animation.ease)
    entries.push({ key: "ease", code: JSON.stringify(resolveEase(animation.ease).animeEase) });
  const stagger = renderStagger(animation.extras?.stagger);
  if (stagger) entries.push({ key: "delay", code: stagger });
  const repeat = renderRepeat(animation.extras?.repeat);
  if (repeat) entries.push({ key: "loop", code: repeat });
  if (rawBoolean(animation.extras?.yoyo) === true) entries.push({ key: "alternate", code: "true" });
  return entries;
}

function pushConvertedProperty(
  entries: AnimeProperty[],
  animation: GsapAnimation,
  key: string,
  value: number | string,
): void {
  if (key === "attr") {
    pushAttrProperties(entries, animation, value);
    return;
  }
  if (key === "autoAlpha") {
    pushAutoAlpha(entries, animation, value);
    return;
  }
  const animeKey = PROP_RENAMES.get(key) ?? key;
  entries.push({ key: animeKey, code: renderTweenValue(animation, key, value) });
}

function pushAttrProperties(
  entries: AnimeProperty[],
  animation: GsapAnimation,
  value: number | string,
): void {
  const attrs = parseAttrWrapper(value);
  if (attrs === null) return;
  const fromAttrs = parseAttrWrapper(animation.fromProperties?.attr);
  for (const attr of attrs) {
    entries.push({ key: attr.key, code: renderAttrTweenValue(animation.method, attr, fromAttrs) });
  }
}

function renderAttrTweenValue(
  method: GsapAnimation["method"],
  attr: AttrEntry,
  fromAttrs: AttrEntry[] | null,
): string {
  const from = fromAttrs?.find((entry) => entry.key === attr.key);
  if (method === "fromTo" && from) return serializeArray([from.value, attr.value]);
  if (method === "from") return serializeArray([attr.value, identityValue(attr.key)]);
  return serializeValue(attr.value);
}

function pushAutoAlpha(
  entries: AnimeProperty[],
  animation: GsapAnimation,
  value: number | string,
): void {
  const from = animation.fromProperties?.autoAlpha;
  if (typeof from === "number" || typeof from === "string") {
    entries.push({ key: "opacity", code: serializeArray([from, value]) });
    entries.push({
      key: "visibility",
      code: serializeArray([visibilityFor(from), visibilityFor(value)]),
    });
    return;
  }
  entries.push({ key: "opacity", code: serializeValue(value) });
  entries.push({ key: "visibility", code: serializeValue(visibilityFor(value)) });
}

// fallow-ignore-next-line complexity
function renderTweenValue(animation: GsapAnimation, key: string, value: number | string): string {
  if (animation.method === "fromTo") {
    const fromValue = animation.fromProperties?.[key];
    return fromValue === undefined ? serializeValue(value) : serializeArray([fromValue, value]);
  }
  if (animation.method === "from") {
    return serializeArray([value, identityValue(key)]);
  }
  if (animation.method === "to") {
    const fromValue = animation.fromProperties?.[key];
    return fromValue === undefined ? serializeValue(value) : serializeArray([fromValue, value]);
  }
  return serializeValue(value);
}

// fallow-ignore-next-line complexity
function identityValue(key: string): number | string {
  if (key === "opacity" || key === "autoAlpha") return 1;
  if (key === "visibility") return "visible";
  if (key.startsWith("scale")) return 1;
  return 0;
}

// fallow-ignore-next-line complexity
function visibilityFor(value: number | string): string {
  if (typeof value === "number") return value <= 0 ? "hidden" : "visible";
  return value === "0" || value === "hidden" ? "hidden" : "visible";
}

function durationMs(animation: GsapAnimation): number {
  if (animation.method === "set") return 0;
  return milliseconds(animation.duration ?? 0.5);
}

function milliseconds(seconds: number): number {
  return Math.round(seconds * 1000);
}

// fallow-ignore-next-line complexity
function renderStagger(value: unknown): string | null {
  const raw = rawText(value);
  if (!raw) return null;
  if (/function|=>/.test(raw)) return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return `anime.stagger(${milliseconds(numeric)})`;
  if (!raw.trim().startsWith("{")) return null;
  return renderObjectStagger(raw);
}

const STAGGER_KEYS = ["each", "amount", "from", "grid", "axis", "start", "ease"];

function staggerKeysAllowed(raw: string): boolean {
  const keys = [...raw.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map((match) => match[1] ?? "");
  return keys.every((key) => STAGGER_KEYS.includes(key));
}

// fallow-ignore-next-line complexity
function staggerOptions(raw: string): string[] {
  const options: string[] = [];
  const grid = /\bgrid\s*:\s*(\[[^\]]+\])/.exec(raw)?.[1];
  const from = /\bfrom\s*:\s*("[^"]+"|'[^']+'|[A-Za-z_$][\w$]*)/.exec(raw)?.[1];
  const axis = /\baxis\s*:\s*("[^"]+"|'[^']+'|[A-Za-z_$][\w$]*)/.exec(raw)?.[1];
  const start = numericField(raw, "start");
  const ease = /\bease\s*:\s*("[^"]+"|'[^']+')/.exec(raw)?.[1];
  if (grid) options.push(`grid: ${grid}`);
  if (from) options.push(`from: ${normalizeStringLiteral(from)}`);
  if (axis) options.push(`axis: ${normalizeStringLiteral(axis)}`);
  if (start !== null) options.push(`start: ${milliseconds(start)}`);
  if (ease) options.push(`ease: ${normalizeStringLiteral(ease)}`);
  return options;
}

// fallow-ignore-next-line complexity
function renderObjectStagger(raw: string): string | null {
  if (!staggerKeysAllowed(raw)) return null;
  const seconds = numericField(raw, "each") ?? numericField(raw, "amount");
  if (seconds === null) return null;
  const options = staggerOptions(raw);
  return options.length > 0
    ? `anime.stagger(${milliseconds(seconds)}, { ${options.join(", ")} })`
    : `anime.stagger(${milliseconds(seconds)})`;
}

function numericField(raw: string, key: string): number | null {
  const match = new RegExp(`\\b${key}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`).exec(raw);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

// fallow-ignore-next-line complexity
function renderRepeat(value: unknown): string | null {
  const raw = rawText(value);
  if (!raw) return null;
  if (raw === "-1" || raw === "Infinity") return "true";
  const repeat = Number(raw);
  if (!Number.isFinite(repeat)) return null;
  return String(Math.max(0, Math.floor(repeat)) + 1);
}

function rawBoolean(value: unknown): boolean | null {
  const raw = rawText(value);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

function normalizeStringLiteral(value: string): string {
  if (value.startsWith("'") && value.endsWith("'")) return JSON.stringify(value.slice(1, -1));
  return value;
}

function renderRegistration(
  id: string,
  timelineVar: string,
  labels: Array<{ name: string; position: number }>,
): string {
  if (labels.length === 0)
    return `hyperframesAnime.register(${JSON.stringify(id)}, ${timelineVar});`;
  const labelEntries = labels.map(
    (label) => `${safeKey(label.name)}: ${formatNumber(label.position)}`,
  );
  return `hyperframesAnime.register(${JSON.stringify(id)}, ${timelineVar}, { labels: { ${labelEntries.join(", ")} } });`;
}

function renderTrailingCloser(trailing: string): string {
  const closer = trailing.trim();
  return closer.length === 0 ? "" : `\n${closer}`;
}

function serializeProperties(properties: AnimeProperty[]): string {
  return `{ ${properties.map((property) => `${safeKey(property.key)}: ${property.code}`).join(", ")} }`;
}

// fallow-ignore-next-line complexity
function renderAddCall(
  timelineVar: string,
  target: string,
  properties: AnimeProperty[],
  position: number,
): string {
  const props = serializeProperties(properties);
  const oneLine = `${timelineVar}.add(${target}, ${props}, ${position});`;
  if (properties.some((property) => property.code.startsWith("[")) && oneLine.length > 95) {
    return `${timelineVar}.add(\n  ${target},\n  ${props},\n  ${position},\n);`;
  }
  if (oneLine.length <= 95) return oneLine;
  if (properties.some((property) => property.code.includes("anime.stagger"))) {
    const propLines = properties.map(
      (property) => `    ${safeKey(property.key)}: ${property.code},`,
    );
    return `${timelineVar}.add(\n  ${target},\n  {\n${propLines.join("\n")}\n  },\n  ${position},\n);`;
  }
  return `${timelineVar}.add(\n  ${target},\n  ${props},\n  ${position},\n);`;
}

function serializeArray(values: Array<number | string>): string {
  return `[${values.map(serializeValue).join(", ")}]`;
}

function serializeValue(value: number | string): string {
  return typeof value === "number" ? formatNumber(value) : JSON.stringify(value);
}

function safeKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 100000) / 100000;
  return String(rounded);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
