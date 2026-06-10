/**
 * Archetype (c) — Headless agent script
 *
 * Shows: no browser, no persist adapter, no preview — pure editing engine.
 * Agents: batch restyling, localization, A/B variants, programmatic animation.
 * Explicit-id ops via query API — no selection, no mouse events.
 *
 * F1 payoff: headless is possible BECAUSE ops have explicit targets.
 * Selection-implicit ops (old R0) would break here — no UI → no selection.
 */

import { openComposition } from "../src/index.js";
import type { ElementSnapshot } from "../src/index.js";

// ── Localization agent ────────────────────────────────────────────────────────
// Rewrites all text elements to a new locale. No browser, no preview.

export async function localize(html: string, translations: Map<string, string>): Promise<string> {
  const comp = await openComposition(html);

  const textElements = comp.find({ tag: "div" });

  comp.batch(() => {
    for (const id of textElements) {
      const el = comp.getElement(id);
      if (!el?.text) continue;
      const translated = translations.get(el.text);
      if (translated) comp.setText(id, translated);
    }
  });

  return comp.serialize();
}

// ── Brand restyle agent ───────────────────────────────────────────────────────
// Apply brand colors to all elements with a matching class name.

export async function applyBrandColors(
  html: string,
  brandPrimary: string,
  brandSecondary: string,
): Promise<string> {
  const comp = await openComposition(html);

  // Query: find elements by attribute pattern
  const brandColorEls = comp
    .getElements()
    .filter((el) => el.attributes["data-brand-role"] === "primary");
  const brandSecondaryEls = comp
    .getElements()
    .filter((el) => el.attributes["data-brand-role"] === "secondary");

  comp.batch(() => {
    for (const el of brandColorEls) {
      comp.setStyle(el.id, { color: brandPrimary });
    }
    for (const el of brandSecondaryEls) {
      comp.setStyle(el.id, { color: brandSecondary });
    }
  });

  return comp.serialize();
}

// ── A/B variant agent ─────────────────────────────────────────────────────────
// Produce two HTML variants from one template.

export async function createABVariants(
  html: string,
  variantB: { headlineId: string; text: string; color: string },
): Promise<{ variantA: string; variantB: string }> {
  const compA = await openComposition(html);
  const variantAHtml = compA.serialize();
  compA.dispose();

  const compB = await openComposition(html);
  compB.setText(variantB.headlineId, variantB.text);
  compB.setStyle(variantB.headlineId, { color: variantB.color });
  const variantBHtml = compB.serialize();
  compB.dispose();

  return { variantA: variantAHtml, variantB: variantBHtml };
}

// ── Asset swap agent ──────────────────────────────────────────────────────────
// F3: setAttribute handles img src, href, alt — the full attribute space.

export async function swapAssets(
  html: string,
  swaps: Array<{ id: string; src: string; alt?: string }>,
): Promise<string> {
  const comp = await openComposition(html);

  comp.batch(() => {
    for (const swap of swaps) {
      comp.setAttribute(swap.id, "src", swap.src);
      if (swap.alt !== undefined) {
        comp.setAttribute(swap.id, "alt", swap.alt);
      }
    }
  });

  return comp.serialize();
}

// ── Batch GSAP animation agent ────────────────────────────────────────────────
// Add staggered entrance animations to all text elements.

export async function addStaggeredEntrance(html: string, staggerDelay = 0.15): Promise<string> {
  const comp = await openComposition(html);

  const textEls = comp.find({ tag: "div" });

  // Phase 3b feature-detect: addGsapTween throws UnsupportedOpError until the
  // parser-backed engine lands — skip animation rather than crash the job.
  const probeTween = {
    method: "from",
    position: 0,
    duration: 0.5,
    ease: "power3.out",
    fromProperties: { opacity: 0, y: 30 },
  } as const;
  const first = textEls[0];
  if (
    !first ||
    !comp.can({ type: "addGsapTween", target: first, id: "preflight", tween: probeTween })
  ) {
    return comp.serialize();
  }

  comp.batch(() => {
    textEls.forEach((id, i) => {
      comp.addGsapTween(id, { ...probeTween, position: i * staggerDelay });
    });
  });

  return comp.serialize();
}

// ── Composition metadata normalization ────────────────────────────────────────

export async function normalizeToPortrait(html: string): Promise<string> {
  const comp = await openComposition(html);
  comp.dispatch({ type: "setCompositionMetadata", width: 1080, height: 1920 });
  return comp.serialize();
}

// ── Variable override agent ───────────────────────────────────────────────────
// Apply a brand kit as composition variable overrides.

export async function applyVariableKit(
  html: string,
  kit: Record<string, string | number | boolean>,
): Promise<string> {
  const comp = await openComposition(html);

  comp.batch(() => {
    for (const [id, value] of Object.entries(kit)) {
      comp.setVariableValue(id, value);
    }
  });

  return comp.serialize();
}

// ── Inspection utility ────────────────────────────────────────────────────────
// Agents need to discover what's in a composition before editing.

export async function inspectComposition(html: string): Promise<{
  elementCount: number;
  textElements: ElementSnapshot[];
  imageElements: ElementSnapshot[];
  ids: string[];
}> {
  const comp = await openComposition(html);

  const all = comp.getElements();
  const textElements = all.filter((el) => ["div", "p", "h1", "h2", "h3", "span"].includes(el.tag));
  const imageElements = all.filter((el) => el.tag === "img");

  comp.dispose();

  return {
    elementCount: all.length,
    textElements,
    imageElements,
    ids: all.map((el) => el.id),
  };
}

// ── Timing normalization agent ────────────────────────────────────────────────

export async function normalizeTiming(html: string, totalDuration: number): Promise<string> {
  const comp = await openComposition(html);

  const timedEls = comp.getElements().filter((el) => el.start !== null && el.duration !== null);

  const lastEnd = timedEls.reduce(
    (max, el) => Math.max(max, (el.start ?? 0) + (el.duration ?? 0)),
    0,
  );
  if (lastEnd === 0) return comp.serialize();

  const scale = totalDuration / lastEnd;

  comp.batch(() => {
    for (const el of timedEls) {
      comp.setTiming(el.id, {
        start: Math.round((el.start ?? 0) * scale * 100) / 100,
        duration: Math.round((el.duration ?? 0) * scale * 100) / 100,
      });
    }
    comp.dispatch({ type: "setCompositionMetadata", duration: totalDuration });
  });

  return comp.serialize();
}
