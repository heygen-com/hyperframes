import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const THEME = "packages/studio/src/styles/theme.css";
const BASELINE = "scripts/token-parity-baseline.json";
const ALLOWLIST = "scripts/token-parity-allowlist.json";
const COLOR = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)/gi;
const TOKEN = /var\(\s*(--[\w-]+)(?:\s*,\s*([^()]*|(?:rgba?|hsla?)\([^)]*\)))?\s*\)/g;

function hexChannels(text) {
  let hex = text.slice(1);
  if ([3, 4].includes(hex.length)) hex = [...hex].map((c) => c + c).join("");
  if (![6, 8].includes(hex.length)) throw new Error(`Unsupported colour: ${text}`);
  const channels = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return [...channels, hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1];
}
function hueDegrees(hue) {
  const n = parseFloat(hue);
  if (hue.endsWith("turn")) return n * 360;
  if (hue.endsWith("grad")) return n * 0.9;
  if (hue.endsWith("rad")) return (n * 180) / Math.PI;
  return n;
}
function hslChannels(parts) {
  const h = (((hueDegrees(parts[0]) % 360) + 360) % 360) / 30;
  const saturation = parseFloat(parts[1]) / 100;
  const lightness = parseFloat(parts[2]) / 100;
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  return [0, 8, 4].map(
    (n) =>
      255 *
      (lightness - amplitude * Math.max(-1, Math.min(((n + h) % 12) - 3, 9 - ((n + h) % 12), 1))),
  );
}
function functionalChannels(text) {
  const parts = text
    .slice(text.indexOf("(") + 1, -1)
    .split(/[\s,/]+/)
    .filter(Boolean);
  const alpha = parts[3] ?? "1";
  const opacity = parseFloat(alpha) / (alpha.endsWith("%") ? 100 : 1);
  const channels = text.startsWith("rgb")
    ? parts.slice(0, 3).map((p) => parseFloat(p) * (p.endsWith("%") ? 2.55 : 1))
    : hslChannels(parts);
  return [...channels, opacity];
}
export function normalizeColor(value) {
  const text = value.toLowerCase().trim();
  const channels = text.startsWith("#") ? hexChannels(text) : functionalChannels(text);
  if (channels.length !== 4 || channels.some((n) => !Number.isFinite(n)))
    throw new Error(`Unsupported colour: ${value}`);
  return channels
    .map((n, i) => Number(Math.max(0, Math.min(i === 3 ? 1 : 255, n)).toFixed(12)))
    .join(",");
}

function canonical(line) {
  return line
    .replace(
      /\b([\w:-]+)-(white|black)(?:\/(\d+(?:\.\d+)?))?\b/g,
      (_, prefix, color, alpha = "100") => {
        const n = color === "white" ? 255 : 0;
        return `${prefix}-[rgba(${n},${n},${n},${Number(alpha) / 100})]`;
      },
    )
    .replace(COLOR, (color) => `COLOR(${normalizeColor(color)})`)
    .replace(/\s+/g, "");
}

export function tokenValues(css) {
  const values = new Map();
  for (const [, name, value] of css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (values.has(name)) throw new Error(`Ambiguous token default: ${name}`);
    values.set(name, value.trim());
  }
  return values;
}

function expandTokens(line, values, seen = []) {
  return line.replace(TOKEN, (reference, name, fallback) => {
    if (!values.has(name)) return fallback ?? reference;
    if (seen.includes(name)) throw new Error(`Cyclic token alias: ${name}`);
    return expandTokens(values.get(name), values, [...seen, name]);
  });
}

function quotedEnd(line, start) {
  let end = start + 1;
  while (end < line.length) {
    if (line[end] === line[start] && line[end - 1] !== "\\") return end + 1;
    end++;
  }
  return end;
}
function scalarEnd(line, start) {
  let depth = 0;
  for (let end = start; end < line.length; end++) {
    if (depth === 0 && /[,;}]/.test(line[end])) return end;
    depth += Number(line[end] === "(") - Number(line[end] === ")");
  }
  return line.length;
}

function valueEnd(line, start) {
  return /["'`]/.test(line[start]) ? quotedEnd(line, start) : scalarEnd(line, start);
}

function propertySlots(line) {
  const result = [];
  const properties = /([\w-]+)["']?\s*[:=]\s*/g;
  for (let match = properties.exec(line); match; match = properties.exec(line)) {
    if (line[properties.lastIndex] === "{") continue;
    const end = valueEnd(line, properties.lastIndex);
    const value = line.slice(properties.lastIndex, end).replace(/^["'`]|["'`]$/g, "");
    result.push({ key: match[1], value });
    properties.lastIndex = end;
  }
  return result;
}
function classSlots(line) {
  const result = [];
  const classes = [
    ...line.matchAll(
      /([\w:-]+)-(white|black)(?:\/(\d+(?:\.\d+)?))?\b|([\w:-]+)-\[((?:var|rgba?|hsla?)\([^)]*\)|#[\da-f]{3,8})\]/g,
    ),
  ];
  for (const match of classes) {
    const key = match[1] ?? match[4];
    result.push({ key: `class:${key}`, value: match[0] });
  }
  return result;
}
function slots(line) {
  const properties = propertySlots(line).filter(
    (slot) => !["class", "className"].includes(slot.key),
  );
  const scope = line.match(/^\s*([^{}<>]+)\s*\{/);
  const prefix = scope ? scope[1].trim() : "";
  const result = [...properties, ...classSlots(line)].map((slot) => ({
    ...slot,
    key: `${prefix}|${slot.key}`,
  }));
  return result.length ? result : [{ key: "line", value: line }];
}

function literalSlot(slot) {
  return /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?)\(|-(?:white|black)(?:\/\d+)?\b/i.test(slot.value);
}
function replacementMatch(before, candidates, slot, values, names) {
  const ambiguous = new Set(candidates.map((old) => canonical(old.value))).size > 1;
  const literal = candidates.find(literalSlot);
  if (!literal) return undefined;
  if (ambiguous) return { before: literal, equal: false, names };
  const expanded = canonical(expandTokens(slot.value, values));
  return { before, equal: canonical(before.value) === expanded, names };
}
function matchReplacement(slot, oldSlots, values) {
  const candidates = oldSlots.filter((old) => old.key === slot.key);
  const index = oldSlots.findIndex((old) => old.key === slot.key);
  if (index < 0) return undefined;
  const [before] = oldSlots.splice(index, 1);
  const names = [...slot.value.matchAll(TOKEN)].map((match) => match[1]);
  if (!names.length) return undefined;
  return replacementMatch(before, candidates, slot, values, names);
}
function compareSlot(file, line, slot, oldSlots, values, allowlist) {
  const match = matchReplacement(slot, oldSlots, values);
  if (!match) return [];
  if (match.equal) return [];
  const entry = { file, before: match.before.line.trim(), after: line.trim() };
  if (allowedReplacement(entry, allowlist)) return [];
  return [{ ...entry, tokens: match.names, message: "token default changes the replaced value" }];
}

function replacementIssues(file, removed, added, values, allowlist) {
  const oldSlots = removed.flatMap((line) => slots(line).map((slot) => ({ ...slot, line })));
  const issues = [];
  for (const line of added) {
    for (const slot of slots(line)) {
      issues.push(...compareSlot(file, line, slot, oldSlots, values, allowlist));
    }
  }
  return issues;
}
function allowedReplacement(entry, allowlist) {
  return allowlist.some((rule) => {
    if (typeof rule.reason !== "string") return false;
    return [
      rule.file === entry.file,
      rule.before === entry.before,
      rule.after === entry.after,
      rule.reason.trim(),
    ].every(Boolean);
  });
}

function diffLineKind(line) {
  if (line.startsWith("+++ b/")) return "file";
  if (/^(?:--- |\+\+\+ )/.test(line)) return "skip";
  return { "-": "removed", "+": "added" }[line[0]] ?? "context";
}
function finishesBlock(kind, block) {
  if (["file", "context"].includes(kind)) return true;
  return kind === "removed" && block.added.length > 0;
}
function recordLine(block, kind, line) {
  if (kind === "file") block.file = line.slice(6);
  if (["added", "removed"].includes(kind)) block[kind].push(line.slice(1));
}
function diffBlocks(diff) {
  const blocks = [];
  let block = { file: "", removed: [], added: [] };
  for (const line of diff.split("\n")) {
    const kind = diffLineKind(line);
    if (finishesBlock(kind, block)) {
      blocks.push(block);
      block = { file: block.file, removed: [], added: [] };
    }
    recordLine(block, kind, line);
  }
  return [...blocks, block];
}

export function findTokenParityIssues(diff, css, allowlist = []) {
  const values = tokenValues(css);
  return diffBlocks(diff).flatMap(({ file, removed, added }) =>
    replacementIssues(file, removed, added, values, allowlist),
  );
}

function baselineError(file, count, counts, previous) {
  const allowed = previous.files[file] ?? 0;
  const current = counts[file] ?? 0;
  if (![count <= allowed, count === current].every(Boolean))
    return [{ file, message: "baseline must only shrink and bank improvements" }];
  return [];
}
export function parityVerdict(issues, baseline, previous = baseline) {
  const counts = issues.reduce((counts, issue) => {
    counts[issue.file] = (counts[issue.file] ?? 0) + 1;
    return counts;
  }, {});
  const errors = issues.filter((issue) => counts[issue.file] > (baseline.files[issue.file] ?? 0));
  errors.push(
    ...Object.entries(baseline.files).flatMap(([file, count]) =>
      baselineError(file, count, counts, previous),
    ),
  );
  if (baseline.total !== Object.values(baseline.files).reduce((a, b) => a + b, 0))
    throw new Error("Incorrect baseline total");
  return errors;
}

function baseRef(base) {
  if (!base || base.startsWith("-"))
    throw new Error("Usage: node scripts/check-token-parity.mjs <base-ref>");
  return base;
}

function main() {
  const base = baseRef(process.argv[2]);
  const git = (args) =>
    execFileSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const diff = git(["diff", "--no-ext-diff", "--no-color", "--unified=3", `${base}...HEAD`, "--"]);
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const previous = git(["ls-tree", "--name-only", base, "--", BASELINE]).trim()
    ? JSON.parse(git(["show", `${base}:${BASELINE}`]))
    : baseline;
  const issues = findTokenParityIssues(
    diff,
    readFileSync(THEME, "utf8"),
    JSON.parse(readFileSync(ALLOWLIST, "utf8")),
  );
  const errors = parityVerdict(issues, baseline, previous);
  if (errors.length) {
    console.error(JSON.stringify(errors, null, 2));
    process.exitCode = 1;
  } else console.log(`Token value parity verified: ${issues.length} baselined migrations.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
