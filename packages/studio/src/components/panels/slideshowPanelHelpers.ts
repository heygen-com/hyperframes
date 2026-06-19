/**
 * Pure manifest-transform helpers for SlideshowPanel.
 * No React, no side-effects — fully unit-testable.
 */

import type { SlideshowManifest, SlideRef, SlideHotspot } from "@hyperframes/core/slideshow";

// ── Scene shape used by the panel UI ──────────────────────────────────────

export interface SceneInfo {
  id: string;
  label: string;
  start: number;
  duration: number;
}

// ── Pure manifest transforms ───────────────────────────────────────────────

/** Toggle a scene in the main-line slide list. */
export function toggleMainLineSlide(
  manifest: SlideshowManifest,
  sceneId: string,
): SlideshowManifest {
  const exists = manifest.slides.some((s) => s.sceneId === sceneId);
  const slides: SlideRef[] = exists
    ? manifest.slides.filter((s) => s.sceneId !== sceneId)
    : [...manifest.slides, { sceneId }];
  return { ...manifest, slides };
}

// fallow-ignore-next-line complexity
/** Move a main-line slide up or down by one position. */
export function reorderMainLineSlide(
  manifest: SlideshowManifest,
  sceneId: string,
  direction: "up" | "down",
): SlideshowManifest {
  const idx = manifest.slides.findIndex((s) => s.sceneId === sceneId);
  if (idx === -1) return manifest;
  const next = direction === "up" ? idx - 1 : idx + 1;
  if (next < 0 || next >= manifest.slides.length) return manifest;
  const slides = [...manifest.slides];
  const a = slides[idx];
  const b = slides[next];
  if (!a || !b) return manifest;
  slides[idx] = b;
  slides[next] = a;
  return { ...manifest, slides };
}

/** Update notes on a main-line slide (adds slide entry if absent). */
export function setSlideNotes(
  manifest: SlideshowManifest,
  sceneId: string,
  notes: string,
): SlideshowManifest {
  const exists = manifest.slides.some((s) => s.sceneId === sceneId);
  const slides: SlideRef[] = exists
    ? manifest.slides.map((s) => (s.sceneId === sceneId ? { ...s, notes } : s))
    : [...manifest.slides, { sceneId, notes }];
  return { ...manifest, slides };
}

/** Push a fragment hold-point time onto a main-line slide. Deduplicates + sorts. */
export function addFragment(
  manifest: SlideshowManifest,
  sceneId: string,
  time: number,
): SlideshowManifest {
  const exists = manifest.slides.some((s) => s.sceneId === sceneId);
  const slides: SlideRef[] = exists
    ? manifest.slides.map((s) => {
        if (s.sceneId !== sceneId) return s;
        const frags = [...new Set([...(s.fragments ?? []), time])].sort((a, b) => a - b);
        return { ...s, fragments: frags };
      })
    : [...manifest.slides, { sceneId, fragments: [time] }];
  return { ...manifest, slides };
}

/** Remove a fragment hold-point by value from a main-line slide. */
export function removeFragment(
  manifest: SlideshowManifest,
  sceneId: string,
  time: number,
): SlideshowManifest {
  return {
    ...manifest,
    slides: manifest.slides.map((s) => {
      if (s.sceneId !== sceneId) return s;
      return { ...s, fragments: (s.fragments ?? []).filter((f) => f !== time) };
    }),
  };
}

/** Create a new branch sequence. Rejects duplicate ids. */
export function createSequence(
  manifest: SlideshowManifest,
  id: string,
  label: string,
): SlideshowManifest {
  const existing = manifest.slideSequences ?? [];
  if (existing.some((seq) => seq.id === id)) return manifest;
  return {
    ...manifest,
    slideSequences: [...existing, { id, label, slides: [] }],
  };
}

/** Rename an existing branch sequence label. */
export function renameSequence(
  manifest: SlideshowManifest,
  id: string,
  label: string,
): SlideshowManifest {
  return {
    ...manifest,
    slideSequences: (manifest.slideSequences ?? []).map((seq) =>
      seq.id === id ? { ...seq, label } : seq,
    ),
  };
}

function pruneHotspots(slides: SlideRef[], targetId: string): SlideRef[] {
  return slides.map((s) => {
    if (!s.hotspots) return s;
    const hotspots = s.hotspots.filter((h) => h.target !== targetId);
    return hotspots.length === s.hotspots.length ? s : { ...s, hotspots };
  });
}

/** Delete a branch sequence by id, removing any hotspot targeting it. */
export function deleteSequence(manifest: SlideshowManifest, id: string): SlideshowManifest {
  const remainingSequences = (manifest.slideSequences ?? []).filter((seq) => seq.id !== id);
  return {
    ...manifest,
    slides: pruneHotspots(manifest.slides, id),
    slideSequences: remainingSequences.map((seq) => ({
      ...seq,
      slides: pruneHotspots(seq.slides, id),
    })),
  };
}

/** Add or remove a scene slide from a branch sequence. */
export function assignToBranch(
  manifest: SlideshowManifest,
  sequenceId: string,
  sceneId: string,
  assign: boolean,
): SlideshowManifest {
  return {
    ...manifest,
    slideSequences: (manifest.slideSequences ?? []).map((seq) => {
      if (seq.id !== sequenceId) return seq;
      if (assign) {
        if (seq.slides.some((s) => s.sceneId === sceneId)) return seq;
        return { ...seq, slides: [...seq.slides, { sceneId }] };
      }
      return { ...seq, slides: seq.slides.filter((s) => s.sceneId !== sceneId) };
    }),
  };
}

/** Add a hotspot to a main-line slide. */
export function addHotspot(
  manifest: SlideshowManifest,
  sceneId: string,
  hotspot: SlideHotspot,
): SlideshowManifest {
  return {
    ...manifest,
    slides: manifest.slides.map((s) => {
      if (s.sceneId !== sceneId) return s;
      const existing = s.hotspots ?? [];
      if (existing.some((h) => h.id === hotspot.id)) return s;
      return { ...s, hotspots: [...existing, hotspot] };
    }),
  };
}

/** Remove a hotspot by id from a main-line slide. */
export function removeHotspot(
  manifest: SlideshowManifest,
  sceneId: string,
  hotspotId: string,
): SlideshowManifest {
  return {
    ...manifest,
    slides: manifest.slides.map((s) => {
      if (s.sceneId !== sceneId) return s;
      return { ...s, hotspots: (s.hotspots ?? []).filter((h) => h.id !== hotspotId) };
    }),
  };
}
