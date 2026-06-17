import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * Declarative motion-verification spec (issue #1437). A sidecar JSON file
 * (`*.motion.json`) sits next to the composition; `inspect` evaluates these
 * assertions against the same seeked timeline the renderer uses.
 */
export type MotionAssertion =
  | { kind: "appearsBy"; selector: string; bySec: number }
  | { kind: "before"; a: string; b: string }
  | { kind: "staysInFrame"; selector: string }
  | { kind: "keepsMoving"; withinSelector?: string; maxStaticSec?: number };

export interface MotionSpec {
  version?: number;
  duration?: number;
  assertions: MotionAssertion[];
}

export type MotionSpecParse = { ok: true; spec: MotionSpec } | { ok: false; errors: string[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSelector(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

type Validator = (raw: Record<string, unknown>, at: string) => MotionAssertion | string;

const VALIDATORS: Record<string, Validator> = {
  appearsBy: (raw, at) => {
    if (!isSelector(raw.selector))
      return `${at} (appearsBy): "selector" must be a non-empty string`;
    if (typeof raw.bySec !== "number" || !Number.isFinite(raw.bySec) || raw.bySec < 0)
      return `${at} (appearsBy): "bySec" must be a number >= 0`;
    return { kind: "appearsBy", selector: raw.selector, bySec: raw.bySec };
  },
  before: (raw, at) => {
    if (!isSelector(raw.a)) return `${at} (before): "a" must be a non-empty string`;
    if (!isSelector(raw.b)) return `${at} (before): "b" must be a non-empty string`;
    return { kind: "before", a: raw.a, b: raw.b };
  },
  staysInFrame: (raw, at) => {
    if (!isSelector(raw.selector))
      return `${at} (staysInFrame): "selector" must be a non-empty string`;
    return { kind: "staysInFrame", selector: raw.selector };
  },
  keepsMoving: (raw, at) => {
    if (raw.withinSelector !== undefined && !isSelector(raw.withinSelector))
      return `${at} (keepsMoving): "withinSelector" must be a non-empty string when present`;
    if (raw.withinSelector === "*")
      return `${at} (keepsMoving): "withinSelector" cannot be "*" — omit it for whole-composition liveness`;
    if (raw.maxStaticSec !== undefined && !isPositive(raw.maxStaticSec))
      return `${at} (keepsMoving): "maxStaticSec" must be a number > 0 when present`;
    const assertion: Extract<MotionAssertion, { kind: "keepsMoving" }> = { kind: "keepsMoving" };
    if (isSelector(raw.withinSelector)) assertion.withinSelector = raw.withinSelector;
    if (isPositive(raw.maxStaticSec)) assertion.maxStaticSec = raw.maxStaticSec;
    return assertion;
  },
};

function validateAssertion(raw: unknown, index: number): MotionAssertion | string {
  const at = `assertions[${index}]`;
  if (!isObject(raw)) return `${at}: must be an object`;
  const validator = typeof raw.kind === "string" ? VALIDATORS[raw.kind] : undefined;
  if (!validator) return `${at}: unknown assertion kind ${JSON.stringify(raw.kind)}`;
  return validator(raw, at);
}

export function parseMotionSpec(raw: unknown): MotionSpecParse {
  if (!isObject(raw)) return { ok: false, errors: ["spec must be a JSON object"] };
  if (raw.version !== undefined && raw.version !== 1)
    return {
      ok: false,
      errors: [`spec version ${raw.version} is not supported — upgrade the hyperframes CLI`],
    };
  if (!Array.isArray(raw.assertions))
    return { ok: false, errors: ['spec must have an "assertions" array'] };
  if (
    raw.duration !== undefined &&
    (typeof raw.duration !== "number" || !Number.isFinite(raw.duration) || raw.duration <= 0)
  )
    return { ok: false, errors: ['"duration" must be a positive number when present'] };

  const assertions: MotionAssertion[] = [];
  const errors: string[] = [];
  raw.assertions.forEach((entry, index) => {
    const result = validateAssertion(entry, index);
    if (typeof result === "string") errors.push(result);
    else assertions.push(result);
  });

  if (errors.length > 0) return { ok: false, errors };
  if (assertions.length === 0) return { ok: false, errors: ["spec has no assertions"] };

  const spec: MotionSpec = { assertions };
  if (typeof raw.duration === "number") spec.duration = raw.duration;
  return { ok: true, spec };
}

/**
 * Locate a `*.motion.json` sidecar in the project dir. When several exist,
 * prefer the one whose basename matches a composition html file; otherwise
 * take the first alphabetically. Throws when multiple sidecars each match a
 * different composition — the bundler and this resolver would diverge silently.
 * Returns null when none is present.
 */
export function findMotionSpec(projectDir: string): string | null {
  if (!existsSync(projectDir)) return null;
  const entries = readdirSync(projectDir);
  const sidecars = entries.filter((name) => name.endsWith(".motion.json")).sort();
  if (!sidecars[0]) return null;
  if (sidecars.length === 1) return join(projectDir, sidecars[0]);
  const htmlBases = new Set(
    entries.filter((name) => name.endsWith(".html")).map((name) => basename(name, ".html")),
  );
  const matched = sidecars.filter((name) => htmlBases.has(basename(name, ".motion.json")));
  if (matched.length > 1) {
    throw new Error(
      `ambiguous motion sidecars in ${projectDir}: ${matched.join(", ")} each match a composition — remove the sidecars you do not need, or use one composition per project`,
    );
  }
  return join(projectDir, matched[0] ?? sidecars[0]);
}

export function readMotionSpec(path: string): MotionSpecParse {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    return { ok: false, errors: [`could not read ${basename(path)}: ${(err as Error).message}`] };
  }
  return parseMotionSpec(raw);
}
