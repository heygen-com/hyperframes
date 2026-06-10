/**
 * Archetype (a) — React app embedding the SDK (T1 standalone)
 *
 * Shows: openComposition, event subscription, typed methods, selection sugar,
 * batch + brand kit, useSyncExternalStore pattern, undo/redo, export.
 *
 * Note: JSX/React not imported here to keep this file framework-agnostic .ts.
 * In a real React app: wrap createEditorSession in useEffect, subscribe with
 * useSyncExternalStore (see comment blocks below).
 */

import { openComposition, ORIGIN_APPLY_PATCHES } from "../src/index.js";
import { createMemoryAdapter } from "../src/adapters/memory.js";
import type { Composition, ElementSnapshot } from "../src/index.js";

// ── Session factory ───────────────────────────────────────────────────────────
// Typically called once in useEffect(() => { createEditorSession(html).then(setComp) }, [])

export async function createEditorSession(html: string): Promise<Composition> {
  const persist = createMemoryAdapter();

  const comp = await openComposition(html, { persist });

  // Persist failures surface as events, never fatal exceptions.
  comp.on("persist:error", ({ error }) => {
    console.error(`Auto-save failed: ${error.message}`);
    // In a real app: show a toast notification
  });

  return comp;
}

// ── useSyncExternalStore integration ─────────────────────────────────────────
// React 18+ pattern:
//
//   const selection = useSyncExternalStore(
//     (cb) => comp.on('selectionchange', cb),
//     () => comp.getSelection(),
//   )
//
// Imperative equivalent for non-React consumers:

export function subscribeToSelection(
  comp: Composition,
  onChange: (ids: string[]) => void,
): () => void {
  return comp.on("selectionchange", onChange);
}

// ── Property panel bindings ───────────────────────────────────────────────────

export function applyStyle(comp: Composition, id: string, prop: string, value: string): void {
  // F1: explicit target — panel holds the id when rendering the current element
  comp.setStyle(id, { [prop]: value });
}

export function applyFontSize(comp: Composition, id: string, px: number): void {
  comp.setStyle(id, { fontSize: `${px}px` });
}

export function applyTextContent(comp: Composition, id: string, value: string): void {
  comp.setText(id, value);
}

// Selection sugar — resolves getSelection() → explicit ops at call time.
// Equivalent to: ids = comp.getSelection(); comp.setStyle(ids, {...})
export function applyColorToSelection(comp: Composition, color: string): void {
  comp.selection().setStyle({ color });
}

// ── Brand kit (batch) ─────────────────────────────────────────────────────────
// One undo entry, one persist write, one change event.

export function applyBrandKit(comp: Composition, kit: Record<string, string>): void {
  comp.batch(() => {
    for (const [variableId, value] of Object.entries(kit)) {
      comp.setVariableValue(variableId, value);
    }
  });
}

// ── Timeline drag ─────────────────────────────────────────────────────────────

export function onClipDrag(comp: Composition, id: string, start: number, duration: number): void {
  comp.setTiming(id, { start, duration });
}

// ── GSAP animation panel ──────────────────────────────────────────────────────

// Phase 3b: GSAP ops throw UnsupportedOpError until the parser-backed engine
// lands — feature-detect with can() and disable the panel control if false.

export function addBounceIn(comp: Composition, targetId: string): string | null {
  const tween = {
    method: "from",
    position: 0,
    duration: 0.5,
    ease: "bounce.out",
    fromProperties: { y: 40, opacity: 0 },
  } as const;
  if (!comp.can({ type: "addGsapTween", target: targetId, id: "preflight", tween })) return null;
  return comp.addGsapTween(targetId, tween);
}

export function updateEase(comp: Composition, animationId: string, ease: string): void {
  if (!comp.can({ type: "setGsapTween", animationId, properties: { ease } })) return;
  comp.setGsapTween(animationId, { ease });
}

// ── Undo / redo ───────────────────────────────────────────────────────────────

export function undo(comp: Composition): void {
  comp.undo();
}

export function redo(comp: Composition): void {
  comp.redo();
}

// ── T3 host undo integration (embedded mode) ─────────────────────────────────
// When the SDK is embedded in a host with its own undo timeline:

export type HostHistoryEntry =
  | { kind: "sdk"; patches: ReturnType<Composition["getOverrides"]>; inversePatches: unknown[] }
  | { kind: "native"; data: unknown };

export function setupHostUndo(
  comp: Composition,
  pushToHostHistory: (entry: HostHistoryEntry) => void,
): () => void {
  return comp.on("patch", ({ patches, inversePatches, origin }) => {
    // Origin guard: skip re-emissions from applyPatches to avoid undo loops (F4)
    if (origin === ORIGIN_APPLY_PATCHES) return;

    pushToHostHistory({
      kind: "sdk",
      patches: patches as unknown as ReturnType<Composition["getOverrides"]>,
      inversePatches: [...inversePatches],
    });
  });
}

// ── Export ────────────────────────────────────────────────────────────────────

export function exportHtml(comp: Composition): string {
  return comp.serialize();
}

// ── Query API usage ───────────────────────────────────────────────────────────

export function findTextElements(comp: Composition): ElementSnapshot[] {
  const ids = comp.find({ tag: "div" });
  return ids.map((id) => comp.getElement(id)).filter((el): el is ElementSnapshot => el !== null);
}
