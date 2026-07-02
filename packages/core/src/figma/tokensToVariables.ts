/**
 * Phase 2 translator: figma variables → composition brand-variable entries,
 * a human-readable sidecar, and binding-index records (design spec §6, §7.1).
 *
 * Pure — REST payload in, artifacts out. Alias chains are walked to the leaf
 * value (cycle-safe) but the binding records the semantic id the designer
 * bound, so a swapped primitive doesn't orphan the link.
 */

import type { FigmaVariablePayload, FigmaVariablesResult } from "./client";
import type { FigmaBindingRecord } from "./bindings";
import { figmaColorToCss } from "./color";

/** data-composition-variables entry (runtime getVariables contract). */
export interface CompositionVariableEntry {
  id: string;
  type: "string" | "number" | "color" | "boolean";
  label: string;
  default: string | number | boolean;
  brandRole?: string;
}

export interface FigmaTokenSidecarEntry {
  name: string;
  type: string;
  figmaId: string;
  key?: string;
  value: string | number | boolean | null;
}

export interface FigmaTokensSidecar {
  source: TokenSource;
  tokens: FigmaTokenSidecarEntry[];
}

export interface TokenSource {
  fileKey: string;
  version: string;
}

export interface TokensToVariablesResult {
  entries: CompositionVariableEntry[];
  bindings: FigmaBindingRecord[];
  sidecar: FigmaTokensSidecar;
}

const TYPE_MAP: Record<string, CompositionVariableEntry["type"]> = {
  COLOR: "color",
  FLOAT: "number",
  STRING: "string",
  BOOLEAN: "boolean",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The collection's defaultModeId is the authority for "which mode is the
 * base value" (Light vs Dark). Falls back to first-inserted mode when the
 * collection or its default mode isn't in the payload.
 */
function baseModeValue(
  payload: FigmaVariablePayload,
  collections: Record<string, unknown>,
): unknown {
  const modes = payload.valuesByMode ?? {};
  const collection = collections[payload.variableCollectionId ?? ""];
  if (isRecord(collection) && typeof collection.defaultModeId === "string") {
    const preferred = modes[collection.defaultModeId];
    if (preferred !== undefined) return preferred;
  }
  for (const value of Object.values(modes)) return value;
  return undefined;
}

function collectionName(
  payload: FigmaVariablePayload,
  collections: Record<string, unknown>,
): string | null {
  const collection = collections[payload.variableCollectionId ?? ""];
  return isRecord(collection) && typeof collection.name === "string" ? collection.name : null;
}

/** Follow VARIABLE_ALIAS links to a leaf value; null on cycle/missing. */
function resolveValue(
  start: string,
  vars: FigmaVariablesResult,
): { value: unknown; chain: string[] } | null {
  const chain: string[] = [];
  const seen = new Set<string>();
  let currentId = start;
  while (!seen.has(currentId)) {
    chain.push(currentId);
    seen.add(currentId);
    const payload = vars.variables[currentId];
    if (!payload) return null;
    const value = baseModeValue(payload, vars.variableCollections);
    if (isRecord(value) && value.type === "VARIABLE_ALIAS" && typeof value.id === "string") {
      currentId = value.id;
      continue;
    }
    return { value, chain };
  }
  return null; // cycle
}

/** Value must match the declared resolvedType — a stringified "8" for a
 * FLOAT would silently break the CompositionVariableEntry contract. */
function toEntryValue(
  resolvedType: string | undefined,
  raw: unknown,
): string | number | boolean | null {
  if (resolvedType === "COLOR") return figmaColorToCss(raw);
  if (resolvedType === "FLOAT") return typeof raw === "number" ? raw : null;
  if (resolvedType === "BOOLEAN") return typeof raw === "boolean" ? raw : null;
  if (resolvedType === "STRING") return typeof raw === "string" ? raw : null;
  return null;
}

export function tokensToVariables(
  vars: FigmaVariablesResult,
  source: TokenSource,
): TokensToVariablesResult {
  const entries: CompositionVariableEntry[] = [];
  const bindings: FigmaBindingRecord[] = [];
  const sidecarTokens: FigmaTokenSidecarEntry[] = [];

  for (const [figmaId, payload] of Object.entries(vars.variables)) {
    const entryType = TYPE_MAP[payload.resolvedType ?? ""];
    const resolved = resolveValue(figmaId, vars);
    const value = resolved ? toEntryValue(payload.resolvedType, resolved.value) : null;
    // Namespace by collection: figma allows the same variable name in
    // different collections (Semantic Blue/500 vs Primitive Blue/500), and a
    // collision here would silently merge two distinct bindings.
    const collection = collectionName(payload, vars.variableCollections);
    const compositionVariableId = collection
      ? `figma:${collection}/${payload.name}`
      : `figma:${payload.name}`;

    // Sidecar keeps EVERY variable — including unresolvable ones (value:
    // null) — for designer visibility into what didn't map; entries/bindings
    // below only get the mappable subset.
    sidecarTokens.push({
      name: payload.name,
      type: entryType ?? payload.resolvedType ?? "unknown",
      figmaId,
      key: payload.key,
      value,
    });

    if (!entryType || value === null || !resolved) continue;

    entries.push({
      id: compositionVariableId,
      type: entryType,
      label: payload.name,
      default: value,
    });
    bindings.push({
      kind: "binding",
      figmaId,
      key: payload.key,
      sourceFileKey: source.fileKey,
      aliasChain: resolved.chain.length > 1 ? resolved.chain : undefined,
      compositionVariableId,
      version: source.version,
    });
  }

  return { entries, bindings, sidecar: { source, tokens: sidecarTokens } };
}
