import type { CapturePerfSummary, CaptureWarning } from "../types.js";

// What a render keeps of the page's own text: each entry, each list and all warnings are bounded here.
export const PAGE_TEXT_MAX_CHARS = 2_000;
export const PAGE_LIST_MAX = 50;
export const SERVED_SCRIPTS_MAX = 10_000;
// Warnings are the one list a page can grow without a count cap: this caps one session's and one render's.
const WARNINGS_TEXT_MAX_CHARS = 1_000_000;

const CUT_NOTE_MAX_CHARS = 40;

export function boundedPageText(text: string, maxChars = PAGE_TEXT_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  let end = maxChars - CUT_NOTE_MAX_CHARS;
  const high = text.charCodeAt(end - 1);
  if (high >= 0xd800 && high <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}… (${text.length - end} more characters)`;
}

/** At most a few items, each cut short, so a message keeps room for its own guidance; details keep the full list. */
export function listedInMessage(items: readonly string[]): string {
  const named = items.slice(0, 3).map((item) => boundedPageText(item, 200));
  const more = items.length > named.length ? ` and ${items.length - named.length} more` : "";
  return `${named.join(", ")}${more}`;
}

function boundedWarningItem(item: unknown): unknown {
  if (typeof item === "string") return boundedPageText(item);
  if (!item || typeof item !== "object") return item;
  return Object.fromEntries(
    Object.entries(item).map(([k, v]) => [k, typeof v === "string" ? boundedPageText(v) : v]),
  );
}

/** A warning's message and each of its lists cut to the page-text bounds; `keepLists` false empties the lists. */
function boundedWarning(warning: CaptureWarning, keepLists: boolean): CaptureWarning {
  const message = boundedPageText(warning.message);
  if (!warning.details) return { ...warning, message };
  const details: Record<string, unknown> = { ...warning.details };
  for (const [key, value] of Object.entries(warning.details)) {
    if (Array.isArray(value))
      details[key] = keepLists ? value.slice(0, PAGE_LIST_MAX).map(boundedWarningItem) : [];
  }
  return { ...warning, message, details: details as CaptureWarning["details"] };
}

const warningKey = (warning: CaptureWarning) =>
  `${warning.code}:${JSON.stringify(warning.details ?? {})}`;

export interface WarningBudget {
  chars: number;
  codes: Set<CaptureWarning["code"]>;
  keys: Set<string>;
}

export function warningBudgetOf(kept: readonly CaptureWarning[]): WarningBudget {
  const budget: WarningBudget = { chars: 0, codes: new Set(), keys: new Set() };
  for (const warning of kept) {
    const key = warningKey(warning);
    budget.chars += key.length + warning.message.length;
    budget.codes.add(warning.code);
    budget.keys.add(key);
  }
  return budget;
}

// Past WARNINGS_TEXT_MAX_CHARS, a warning is kept once per code with its lists emptied, so policy still sees it.
export function keptWithinBudget(
  budget: WarningBudget,
  raw: CaptureWarning,
): CaptureWarning | null {
  const bounded = boundedWarning(raw, true);
  const key = warningKey(bounded);
  if (budget.keys.has(key)) return null;
  const chars = key.length + bounded.message.length;
  if (budget.chars + chars <= WARNINGS_TEXT_MAX_CHARS) {
    budget.chars += chars;
    budget.codes.add(raw.code);
    budget.keys.add(key);
    return bounded;
  }
  if (budget.codes.has(raw.code)) return null;
  budget.codes.add(raw.code);
  return boundedWarning(raw, false);
}

/** Adds a session's summary to a render's list, its warnings bounded by what the list already keeps. */
export function retainCapturePerf(
  sink: CapturePerfSummary[],
  perf: CapturePerfSummary,
): CapturePerfSummary {
  const budget = warningBudgetOf(sink.flatMap((kept) => kept.warnings ?? []));
  const kept = perf.warnings
    ? { ...perf, warnings: perf.warnings.flatMap((w) => keptWithinBudget(budget, w) ?? []) }
    : perf;
  sink.push(kept);
  return kept;
}
