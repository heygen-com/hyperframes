/**
 * Binding resolution pass (design spec §7.1): scan a node tree's complete
 * binding set — boundVariables and style ids, alias chains honored — and
 * partition against the binding index BEFORE any CSS is emitted.
 *
 * Exact-ID matching only. A missed link bakes a visually-correct literal;
 * a wrong link silently changes color at the next brand refresh. Never
 * match by value or name.
 *
 * NOTE: the consumer-side boundVariables shape is probe-flagged in the spec
 * (§7.1 pre-build probes). Extraction here is tolerant: single alias objects
 * and arrays of alias objects both count; unknown shapes are ignored rather
 * than guessed at.
 */

import type { FigmaBindingRecord } from "./bindings";
import type { FigmaNodeDocument } from "./client";
import { childDocuments } from "./nodeDocument";

export interface BindingSite {
  nodeId: string;
  /** boundVariables property ("fills") or style slot prefixed "style:" ("style:text") */
  property: string;
  figmaId: string;
}

export interface ResolvedBindingSite extends BindingSite {
  compositionVariableId: string;
}

export interface ResolveBindingsResult {
  resolved: ResolvedBindingSite[];
  unresolved: BindingSite[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function aliasId(value: unknown): string | null {
  if (isRecord(value) && value.type === "VARIABLE_ALIAS" && typeof value.id === "string")
    return value.id;
  return null;
}

function boundVariableSites(node: FigmaNodeDocument, out: BindingSite[]): void {
  const bound = node.boundVariables;
  if (!isRecord(bound)) return;
  for (const [property, value] of Object.entries(bound)) {
    const candidates = Array.isArray(value) ? value : [value];
    for (const item of candidates) {
      const id = aliasId(item);
      if (id) out.push({ nodeId: node.id, property, figmaId: id });
    }
  }
}

function styleSites(node: FigmaNodeDocument, out: BindingSite[]): void {
  const styles = node.styles;
  if (!isRecord(styles)) return;
  for (const [slot, styleId] of Object.entries(styles)) {
    if (typeof styleId === "string" && styleId.length > 0)
      out.push({ nodeId: node.id, property: `style:${slot}`, figmaId: styleId });
  }
}

function collectSites(node: FigmaNodeDocument, out: BindingSite[]): void {
  boundVariableSites(node, out);
  styleSites(node, out);
  for (const child of childDocuments(node)) collectSites(child, out);
}

function findInIndex(index: FigmaBindingRecord[], figmaId: string): FigmaBindingRecord | null {
  for (const b of index) {
    if (b.figmaId === figmaId) return b;
    if (b.aliasChain?.includes(figmaId)) return b;
    if (b.key !== undefined && b.key === figmaId) return b;
  }
  return null;
}

export function resolveBindings(
  node: FigmaNodeDocument,
  index: FigmaBindingRecord[],
): ResolveBindingsResult {
  const sites: BindingSite[] = [];
  collectSites(node, sites);

  const resolved: ResolvedBindingSite[] = [];
  const unresolved: BindingSite[] = [];
  for (const site of sites) {
    const match = findInIndex(index, site.figmaId);
    if (match) resolved.push({ ...site, compositionVariableId: match.compositionVariableId });
    else unresolved.push(site);
  }
  return { resolved, unresolved };
}
