import type { TextEditAwayEvent } from "@hyperframes/core/runtime/editing-port";
import { previewEditingClient } from "../player/lib/previewChannel";

export type StudioTextEditAway = (away: TextEditAwayEvent, iframe: HTMLIFrameElement) => void;

let host: StudioTextEditAway | null = null;
let stopWatching = () => {};

/** With no host, a sealed edit asks the frame for no presses, so the film keeps its native menu. */
export function setStudioTextEditAway(handler: StudioTextEditAway | null): void {
  host = handler;
  if (!handler) stopWatching();
}

/** One edit is watched at a time; the click away that ends it is the last press it passes on. */
export function sealedTextEditAway(iframe: HTMLIFrameElement, handle: string): { away?: true } {
  stopWatching();
  if (!host) return {};
  const stop = previewEditingClient(iframe).onTextEditAway((away) => {
    if (away.handle !== handle || !host) return;
    if (away.button === 0) stop();
    host(away, iframe);
  });
  stopWatching = stop;
  return { away: true };
}
