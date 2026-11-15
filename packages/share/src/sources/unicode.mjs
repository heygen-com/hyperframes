// @ts-check
// Use the bundled Unicode 15.1 tables so path comparison is independent of the runtime Unicode version.
import { readContract } from "./contract.mjs";

export const UNICODE_VERSION = "15.1.0";

/** @typedef {{ unicode_version: string, casefold: Record<string, string>, combining: Record<string, number>,
 *   decomposition: Record<string, number[]>, composition: Record<string, number>,
 *   assigned_ranges: [number, number][] }} UnicodeTableFile */

const HANGUL_BASE = 0xac00;
const HANGUL_COUNT = 11172;
const L_BASE = 0x1100;
const V_BASE = 0x1161;
const T_BASE = 0x11a7;
const L_COUNT = 19;
const V_COUNT = 21;
const T_COUNT = 28;
const N_COUNT = V_COUNT * T_COUNT;

/** The table re-keyed by code point, decompositions fully expanded. @param {UnicodeTableFile} raw */
function tablesOf(raw) {
  if (raw.unicode_version !== UNICODE_VERSION)
    throw new Error(`unicode table is ${raw.unicode_version}, expected ${UNICODE_VERSION}`);
  const hex = (/** @type {string} */ code) => Number.parseInt(code, 16);
  const casefold = new Map(Object.entries(raw.casefold).map(([code, to]) => [hex(code), to]));
  const combining = new Map(Object.entries(raw.combining).map(([code, cc]) => [hex(code), cc]));
  const direct = new Map(Object.entries(raw.decomposition).map(([code, seq]) => [hex(code), seq]));
  /** @param {number} code @returns {number[]} */
  const expand = (code) => direct.get(code)?.flatMap(expand) ?? [code];
  const decomposition = new Map([...direct.keys()].map((code) => [code, expand(code)]));
  const composition = new Map(
    Object.entries(raw.composition).map(([pair, composite]) => {
      const [first = "", second = ""] = pair.split(",");
      return [`${hex(first)},${hex(second)}`, composite];
    }),
  );
  const starts = raw.assigned_ranges.map(([start]) => start);
  const ends = raw.assigned_ranges.map(([, end]) => end);
  return { casefold, combining, decomposition, composition, starts, ends };
}

/** @type {ReturnType<typeof tablesOf> | null} */
let loaded = null;
/** The table, read and indexed when a path is first compared: an app that never syncs never reads it. */
const tables = () => (loaded ??= tablesOf(readContract("unicode-15.1.0.json")));

/** @param {number} code */
const classOf = (code) => tables().combining.get(code) ?? 0;

/** @param {number} code @returns {readonly number[]} */
function decompose(code) {
  const syllable = code - HANGUL_BASE;
  if (syllable >= 0 && syllable < HANGUL_COUNT) {
    const trailing = syllable % T_COUNT;
    const leading = [
      L_BASE + Math.floor(syllable / N_COUNT),
      V_BASE + Math.floor((syllable % N_COUNT) / T_COUNT),
    ];
    return trailing ? [...leading, T_BASE + trailing] : leading;
  }
  return tables().decomposition.get(code) ?? [code];
}

/** @param {number} first @param {number} second @returns {number | undefined} */
function composePair(first, second) {
  if (first >= L_BASE && first < L_BASE + L_COUNT && second >= V_BASE && second < V_BASE + V_COUNT)
    return HANGUL_BASE + ((first - L_BASE) * V_COUNT + second - V_BASE) * T_COUNT;
  return composeSyllable(first, second) ?? tables().composition.get(`${first},${second}`);
}
/** @param {number} first @param {number} second */
function composeSyllable(first, second) {
  if (
    first >= HANGUL_BASE &&
    first < HANGUL_BASE + HANGUL_COUNT &&
    (first - HANGUL_BASE) % T_COUNT === 0 &&
    second > T_BASE &&
    second < T_BASE + T_COUNT
  )
    return first + second - T_BASE;
}

/** Canonical decomposition then canonical ordering of combining marks. @param {string} value */
function orderedCodes(value) {
  /** @type {number[]} */
  const ordered = [];
  for (const char of value) {
    for (const code of decompose(char.codePointAt(0) ?? 0)) {
      const current = classOf(code);
      let position = ordered.length;
      while (current && position && classOf(ordered[position - 1] ?? 0) > current) position--;
      ordered.splice(position, 0, code);
    }
  }
  return ordered;
}

/** Canonical composition under the pinned Unicode table. @param {number[]} ordered */
function composed(ordered) {
  /** @type {number[]} */
  const result = [];
  let starter = 0;
  let lastClass = 0;
  for (const code of ordered) {
    const current = classOf(code);
    const head = result[starter];
    const composite = head === undefined ? undefined : composePair(head, code);
    if (composite !== undefined && (lastClass < current || lastClass === 0)) {
      result[starter] = composite;
      continue;
    }
    if (current === 0) starter = result.length;
    result.push(code);
    lastClass = current;
  }
  return String.fromCodePoint(...result);
}

const ASCII = /^\p{ASCII}*$/u;

/** NFC (UAX #15) under the pinned table. @param {string} value */
export const nfc = (value) => (ASCII.test(value) ? value : composed(orderedCodes(value)));

/** Default full case folding (status C and F), so `ß` folds to `ss`. @param {string} value */
function fullCasefold(value) {
  if (ASCII.test(value)) return value.toLowerCase();
  let folded = "";
  for (const char of value) folded += tables().casefold.get(char.codePointAt(0) ?? 0) ?? char;
  return folded;
}

/** Whether every code point is assigned in Unicode 15.1. @param {string} value */
export function allAssigned(value) {
  const { starts, ends } = tables();
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    let low = 0;
    let high = starts.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((starts[middle] ?? Infinity) <= code) low = middle + 1;
      else high = middle;
    }
    if (low === 0 || code > (ends[low - 1] ?? -1)) return false;
  }
  return true;
}

/** Directory names repeat across a manifest's paths, and each segment is keyed twice (policy, then collisions). */
const KEYS_KEPT = 16384;
/** @type {Map<string, string>} */
const keys = new Map();

/** The spelling two names share on a case-insensitive or normalizing filesystem: NFC(casefold(NFC(value))).
 * @param {string} value */
export function comparisonKey(value) {
  const known = keys.get(value);
  if (known !== undefined) return known;
  const key = nfc(fullCasefold(nfc(value)));
  if (keys.size >= KEYS_KEPT) keys.clear();
  keys.set(value, key);
  return key;
}
