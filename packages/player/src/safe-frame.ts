/**
 * Optional `safe-frame="<id>"` preview crop on `<hyperframes-player>`.
 *
 * CSS clip / transform on the iframe wrapper — the composition HTML is not
 * rewritten. An unknown id is a no-op plus a console warning.
 */

import {
  parseSafeFrames,
  pixelRect,
  type PixelRect,
  type SafeFrame,
} from "@hyperframes/parsers/safe-frames";

export type { SafeFrame };

export function readSafeFramesFromDocument(doc: Document | null | undefined): SafeFrame[] {
  if (!doc) return [];
  const root =
    doc.querySelector("[data-composition-id]") ?? doc.querySelector("[data-safe-frames]");
  if (!root) return [];
  const parsed = parseSafeFrames(root);
  return parsed.ok ? parsed.frames : [];
}

export function applySafeFrameView(input: {
  playerElement: HTMLElement;
  iframe: HTMLIFrameElement;
  compositionWidth: number;
  compositionHeight: number;
  frames: SafeFrame[];
  frameId: string | null;
}): boolean {
  const frameId = input.frameId?.trim() ?? "";
  if (!frameId) return false;
  const frame = input.frames.find((entry) => entry.id === frameId);
  if (!frame) {
    if (input.frames.length > 0) {
      console.warn(`[hyperframes-player] unknown safe-frame "${frameId}"`);
    }
    return false;
  }
  let crop: PixelRect;
  try {
    crop = pixelRect(frame, input.compositionWidth, input.compositionHeight);
  } catch {
    console.warn(`[hyperframes-player] invalid safe-frame "${frameId}"`);
    return false;
  }
  const w = input.playerElement.offsetWidth;
  const h = input.playerElement.offsetHeight;
  if (w === 0 || h === 0) return false;
  const scale = Math.min(w / crop.width, h / crop.height);
  input.iframe.style.width = `${input.compositionWidth}px`;
  input.iframe.style.height = `${input.compositionHeight}px`;
  const cropCx = crop.x + crop.width / 2;
  const cropCy = crop.y + crop.height / 2;
  const offsetX = (input.compositionWidth / 2 - cropCx) * scale;
  const offsetY = (input.compositionHeight / 2 - cropCy) * scale;
  input.iframe.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px)) scale(${scale})`;
  input.iframe.style.clipPath = `inset(${crop.y}px ${input.compositionWidth - crop.x - crop.width}px ${input.compositionHeight - crop.y - crop.height}px ${crop.x}px)`;
  return true;
}
