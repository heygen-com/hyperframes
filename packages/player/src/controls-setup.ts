/**
 * Helpers for wiring the player's optional UI elements: the playback controls
 * bar, the poster image overlay, and input-filtering utilities.
 *
 * Extracted from the web component so the setup logic doesn't inflate the
 * class body. These are pure imperative DOM operations; they carry no
 * persistent state beyond what the caller tracks.
 */

import { createControls, type ControlsCallbacks, type ControlsOptions } from "./controls.js";

/**
 * Create the playback controls overlay and attach it to `parent`.
 * Returns the controls API object. A no-op guard (returns the existing API)
 * must be enforced by the caller — this function always constructs.
 */
export function setupControls(
  parent: ShadowRoot,
  muted: boolean,
  volume: number,
  speedPresetsAttr: string | null,
  callbacks: ControlsCallbacks,
  audioLocked = false,
): ReturnType<typeof createControls> {
  const speedPresets = speedPresetsAttr
    ? speedPresetsAttr
        .split(",")
        .map(Number)
        .filter((n) => !isNaN(n) && n > 0)
    : undefined;
  const options: ControlsOptions = {
    ...(speedPresets ? { speedPresets } : {}),
    audioLocked,
  };
  const api = createControls(parent, callbacks, options);
  api.updateMuted(muted);
  api.updateVolume(volume);
  return api;
}

/**
 * Set up or remove the poster image element in `parent`.
 *
 * - When `posterUrl` is non-empty, creates the `<img>` if needed and sets src.
 * - When `posterUrl` is null/empty, removes the existing element (if any).
 *
 * Returns the current poster element (possibly newly created) or `null`.
 */
export function setupPoster(
  parent: ShadowRoot,
  posterUrl: string | null,
  existing: HTMLImageElement | null,
): HTMLImageElement | null {
  if (!posterUrl) {
    existing?.remove();
    return null;
  }
  if (!existing) {
    existing = document.createElement("img");
    existing.className = "hfp-poster";
    parent.appendChild(existing);
  }
  existing.src = posterUrl;
  return existing;
}

/**
 * Returns `true` when `event` originated inside an `hfp-controls` element.
 * Used to prevent the bare-player-surface click handler from double-firing
 * when the user clicks an overlay control button.
 */
export function isControlsClick(event: Event): boolean {
  return event
    .composedPath()
    .some((t) => t instanceof HTMLElement && t.classList.contains("hfp-controls"));
}
