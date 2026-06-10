/**
 * Archetype (b) — Vanilla standalone editor (T1)
 *
 * Shows: openComposition with fs adapter pattern, typed methods (the docs page one surface),
 * element handle, batch, dispatch (advanced layer), slider-burst coalescing intent,
 * sub-composition editing intent, timeline label ops.
 *
 * This is the "zero-framework" path: plain TypeScript, no React, no Vue.
 * Target: a tools developer building a custom editor UI from scratch.
 */

import { openComposition } from "../src/index.js";
import { createMemoryAdapter } from "../src/adapters/memory.js";
import type { Composition, GsapTweenSpec } from "../src/index.js";

// ── Initialize ────────────────────────────────────────────────────────────────

export async function initEditor(html: string): Promise<Composition> {
  // Use createFsAdapter({ root: projectDir }) in production:
  //   import { createFsAdapter } from '@hyperframes/sdk/adapters/fs'
  const persist = createMemoryAdapter();

  const comp = await openComposition(html, {
    persist,
    coalesceMs: 300,
  });

  comp.on("persist:error", ({ error }) => {
    showError(`Auto-save failed: ${error.message}${error.hint ? ` — ${error.hint}` : ""}`);
  });

  return comp;
}

// ── Property panel — typed method layer (F10 docs page one) ──────────────────

export function setColor(comp: Composition, id: string, color: string): void {
  comp.setStyle(id, { color });
}

export function setFontFamily(comp: Composition, id: string, family: string): void {
  comp.setStyle(id, { fontFamily: family });
}

export function swapImage(comp: Composition, id: string, src: string): void {
  // F3: setAttribute closes the attribute space — handles img src, href, alt, data-*, ARIA
  comp.setAttribute(id, "src", src);
}

export function setAltText(comp: Composition, id: string, alt: string): void {
  comp.setAttribute(id, "alt", alt);
}

export function removeElement(comp: Composition, id: string): void {
  comp.removeElement(id);
  // Inverse patch carries full serialized subtree — undo restores it.
}

// ── Element handle pattern ────────────────────────────────────────────────────
// comp.element(id) — curried handle, no stale-ref hazard

export function editHeadline(comp: Composition, headlineId: string): void {
  const h = comp.element(headlineId);
  h.setText("New headline");
  h.setStyle({ color: "#FFD60A", fontSize: "96px" });
  h.setTiming({ start: 0.5, duration: 3 });
}

// ── Slider burst (rapid dispatch — coalesced into one undo entry) ─────────────

export function onFontSizeSlider(comp: Composition, id: string, px: number): void {
  // Each input event dispatches setStyle. History coalesces: same op + same target
  // within coalesceMs → one undo entry (forward keeps latest, inverse keeps first prev).
  // Persist queue writes once when the burst settles.
  comp.setStyle(id, { fontSize: `${px}px` });
}

// ── Batch ─────────────────────────────────────────────────────────────────────
// One undo entry, one persist write, one subscriber notification.

export function applyTextPreset(
  comp: Composition,
  id: string,
  preset: { fontSize: string; color: string; fontFamily: string },
): void {
  comp.batch(() => {
    comp.setStyle(id, {
      fontSize: preset.fontSize,
      color: preset.color,
      fontFamily: preset.fontFamily,
    });
  });
}

// ── dispatch() — advanced layer for agents / automation ──────────────────────
// Typed methods are sugar; dispatch() remains public for data-shaped op emission.

export function applyOpFromJson(comp: Composition, opJson: unknown): void {
  // Agents or automation scripts that emit JSON op objects use dispatch directly.
  comp.dispatch(opJson as Parameters<Composition["dispatch"]>[0]);
}

// ── GSAP operations ───────────────────────────────────────────────────────────

// NOTE (Phase 3b): GSAP ops require the parser-backed engine and throw
// UnsupportedOpError until it lands. Feature-detect with can() first.

export function addFadeIn(comp: Composition, targetId: string, delay = 0): string | null {
  const tween: GsapTweenSpec = {
    method: "from",
    position: delay,
    duration: 0.4,
    ease: "power2.out",
    fromProperties: { opacity: 0 },
  };
  if (!comp.can({ type: "addGsapTween", target: targetId, id: "preflight", tween })) return null;
  return comp.addGsapTween(targetId, tween);
}

export function addBounce(
  comp: Composition,
  targetId: string,
  overrides?: Partial<GsapTweenSpec>,
): string | null {
  const tween: GsapTweenSpec = {
    method: "from",
    position: 0,
    duration: 0.6,
    ease: "bounce.out",
    fromProperties: { y: 60, opacity: 0 },
    ...overrides,
  };
  if (!comp.can({ type: "addGsapTween", target: targetId, id: "preflight", tween })) return null;
  return comp.addGsapTween(targetId, tween);
}

// Keyframe editing (addGsapKeyframe / removeGsapKeyframe — v1, promoted 2026-06-09):
export function insertKeyframe(comp: Composition, animationId: string, position: number): void {
  comp.dispatch({
    type: "addGsapKeyframe",
    animationId,
    position,
    value: { opacity: 1 },
  });
}

// Timeline labels
export function addLabel(comp: Composition, name: string, position: number): void {
  comp.dispatch({ type: "addLabel", name, position });
}

// ── Composition metadata ──────────────────────────────────────────────────────

export function resizeComposition(
  comp: Composition,
  width: number,
  height: number,
  duration: number,
): void {
  comp.dispatch({ type: "setCompositionMetadata", width, height, duration });
}

// ── Export ────────────────────────────────────────────────────────────────────

export function exportComposition(comp: Composition): string {
  return comp.serialize();
}

// ── Query API ─────────────────────────────────────────────────────────────────

export function listAllElementIds(comp: Composition): string[] {
  return comp.getElements().map((el) => el.id);
}

export function findByText(comp: Composition, text: string): string[] {
  return comp.find({ text });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export function cleanup(comp: Composition): void {
  comp.dispose();
}

function showError(msg: string): void {
  console.error(msg);
}
