/**
 * Bake chosen variable values into an installed item's declared defaults.
 *
 * A block is mounted by a `<div data-composition-src>`, so `add --vars` can put
 * the values on that mount as `data-variable-values` and two mounts of the same
 * block can differ. A component has no mount element: it is markup you paste
 * into a host composition, and it reads its values through
 * `__hyperframes.getVariables()`, which merges the declared defaults of every
 * `[data-composition-variables]` element in the document with render-time
 * overrides.
 *
 * So for a component the only place a chosen value can live and survive being
 * pasted is the component's own declaration. Rewriting the defaults there is
 * what makes "customise it on the catalog page, copy the command, run it" end
 * with the look you picked. Before this, `--vars` was accepted, documented, and
 * silently discarded for every component in the catalog.
 */

import { isCompositionVariable, type CompositionVariable } from "@hyperframes/core/variables";

export interface ApplyResult {
  /** The source with defaults rewritten. Unchanged when nothing applied. */
  html: string;
  /** Variable ids whose default was replaced. */
  applied: string[];
  /** Ids the item does not declare. */
  unknown: string[];
  /** Ids declared but given a value the declaration does not allow. */
  invalid: { id: string; reason: string }[];
}

const ATTR = "data-composition-variables";

/** Locate the attribute's quoted value, tolerating either delimiter. */
function findDeclaration(source: string): { start: number; end: number; raw: string } | null {
  const at = source.indexOf(`${ATTR}=`);
  if (at === -1) return null;
  const quote = source[at + ATTR.length + 1];
  if (quote !== "'" && quote !== '"') return null;
  const start = at + ATTR.length + 2;
  const end = source.indexOf(quote, start);
  if (end === -1) return null;
  return { start, end, raw: source.slice(start, end) };
}

function decode(raw: string): string {
  return raw.replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}

/** Mirrors the escaping the block-mount path uses, so either delimiter is safe. */
function encode(json: string, quote: string): string {
  return quote === "'" ? json.replace(/'/g, "&#39;") : json.replace(/"/g, "&quot;");
}

function optionValues(decl: CompositionVariable): string[] | null {
  return decl.type === "enum" ? decl.options.map((option) => option.value) : null;
}

/**
 * Reject a value the declaration cannot represent, rather than writing it.
 *
 * A bad enum falls back to the default at runtime and warns, so writing one
 * here would produce a file that renders as if the value had been ignored --
 * which is the exact failure this function exists to remove.
 */
function rejectEnum(decl: CompositionVariable, value: unknown): string | null {
  const options = optionValues(decl);
  if (!options) return null;
  return options.includes(String(value)) ? null : `not one of ${options.join(", ")}`;
}

function rejectNumber(decl: CompositionVariable, value: unknown): string | null {
  if (decl.type !== "number") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "not a number";
  if (decl.min !== undefined && n < decl.min) return `below min ${decl.min}`;
  if (decl.max !== undefined && n > decl.max) return `above max ${decl.max}`;
  return null;
}

function reject(decl: CompositionVariable, value: unknown): string | null {
  return rejectEnum(decl, value) ?? rejectNumber(decl, value);
}

export function applyVariableDefaults(
  source: string,
  values: Record<string, unknown>,
): ApplyResult {
  const ids = Object.keys(values);
  if (ids.length === 0) return { html: source, applied: [], unknown: [], invalid: [] };

  const found = findDeclaration(source);
  if (!found) return { html: source, applied: [], unknown: ids, invalid: [] };

  // isCompositionVariable is the predicate parseCompositionVariables filters
  // with -- the schema's own definition of a well-formed declaration. Using it
  // here means everything below works on a real discriminated union instead of
  // a bag of `unknown` re-checked at each use, and a declaration the schema
  // rejects is one we must not rewrite, because we would be guessing at its
  // shape. parseCompositionVariables itself takes a DOM Element, which the CLI
  // has no business constructing to read a string.
  let parsed: unknown;
  try {
    parsed = JSON.parse(decode(found.raw));
  } catch {
    return { html: source, applied: [], unknown: ids, invalid: [] };
  }
  if (!Array.isArray(parsed)) return { html: source, applied: [], unknown: ids, invalid: [] };
  const declared: CompositionVariable[] = parsed.filter(isCompositionVariable);
  if (declared.length !== parsed.length) {
    // Rewriting a partially understood declaration would drop the entries we
    // could not model, so leave the file exactly as the registry shipped it.
    return { html: source, applied: [], unknown: ids, invalid: [] };
  }

  const applied: string[] = [];
  const invalid: { id: string; reason: string }[] = [];
  const byId = new Map(declared.map((decl) => [decl.id, decl]));
  const updated = new Map<string, string | number>();

  for (const [id, value] of Object.entries(values)) {
    const decl = byId.get(id);
    if (!decl) continue;
    const reason = reject(decl, value);
    if (reason) {
      invalid.push({ id, reason });
      continue;
    }
    // The declaration's own type decides how the value is stored. A number
    // written as the string "76" would trip the composition's guard and fall
    // back, which looks exactly like the value being ignored.
    updated.set(id, decl.type === "number" ? Number(value) : String(value));
    applied.push(id);
  }

  const unknown = ids.filter((id) => !byId.has(id));
  if (applied.length === 0) return { html: source, applied, unknown, invalid };

  // One declaration per line, matching how the registry authors these files, so
  // a re-install produces a readable diff rather than one enormous line.
  const quote = source[found.start - 1]!;
  const body = declared
    .map((decl) => {
      const next = updated.has(decl.id) ? { ...decl, default: updated.get(decl.id)! } : decl;
      return `    ${JSON.stringify(next)}`;
    })
    .join(",\n");
  const rewritten = encode(`[\n${body}\n  ]`, quote);
  const html = source.slice(0, found.start) + rewritten + source.slice(found.end);
  return { html, applied, unknown, invalid };
}
