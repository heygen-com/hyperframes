import { parseProjectIdFromHash } from "../../utils/projectRouting";
import {
  createPreviewPlayer,
  previewSrc,
  type HyperframesPlayerElement,
} from "./previewPlayerElement";

/** Player lifecycle events a Player replays when it adopts the boot preview (`load` fires on the iframe). */
const PREVIEW_PLAYER_EVENTS = [
  "load",
  "ready",
  "painted",
  "error",
  "shadertransitionstate",
] as const;
export type PreviewPlayerEventType = (typeof PREVIEW_PLAYER_EVENTS)[number];

export interface BootPreview {
  player: HyperframesPlayerElement;
  /** Lifecycle events the player fired before it was adopted, in order. */
  events: Event[];
  startedAt: number;
}

interface ParkedPreview extends BootPreview {
  src: string;
  parking: HTMLElement;
  stopRecording: () => void;
}

type MovableParent = HTMLElement & { moveBefore(node: Node, child: Node | null): void };

let parked: ParkedPreview | null = null;

/** Listens to the player lifecycle events; returns the unsubscribe. */
export function listenPreviewPlayer(
  player: HyperframesPlayerElement,
  handle: (type: PreviewPlayerEventType, event: Event) => void,
): () => void {
  const listeners = PREVIEW_PLAYER_EVENTS.map((type) => {
    const target: EventTarget = type === "load" ? player.iframeElement : player;
    const listener = (event: Event) => handle(type, event);
    target.addEventListener(type, listener);
    return () => target.removeEventListener(type, listener);
  });
  return () => listeners.forEach((stop) => stop());
}

/**
 * Starts the preview of the project named in the URL from the page's first script, before
 * Studio's app code loads; the Player that mounts for it adopts the running element.
 * Needs Element.moveBefore (moving a loaded iframe any other way reloads it).
 */
export function startBootPreview(hash: string): boolean {
  const projectId = parseProjectIdFromHash(hash);
  const src = projectId ? previewSrc(projectId) : null;
  if (parked || !src || !("moveBefore" in Element.prototype)) return false;

  const player = createPreviewPlayer();
  const events: Event[] = [];
  const stopRecording = listenPreviewPlayer(player, (_, event) => events.push(event));
  player.setAttribute("src", src);

  const parking = document.createElement("div");
  parking.setAttribute("aria-hidden", "true");
  parking.style.cssText = "position:fixed;inset:0;opacity:0;pointer-events:none;z-index:-1";
  parking.append(player);
  document.body.append(parking);

  parked = {
    player,
    events,
    startedAt: performance.now(),
    src,
    parking,
    stopRecording,
  };
  return true;
}

/**
 * Moves the boot preview into `container` when the caller loads the same `src`, keeping its
 * document. A caller with another `src` leaves it parked for the Player that does load it.
 */
export function adoptBootPreview(container: HTMLElement, src: string): BootPreview | null {
  const boot = parked;
  if (!boot || boot.src !== src) return null;
  parked = null;
  boot.stopRecording();
  // Moved out before the parking is removed: disconnecting the player would tear it down.
  (container as MovableParent).moveBefore(boot.player, null);
  boot.parking.remove();
  return boot;
}

/**
 * Drops a boot preview nobody adopted: the URL moved to another project, or Studio's preview
 * booted from another document.
 */
export function dropBootPreview(): void {
  const boot = parked;
  if (!boot) return;
  parked = null;
  boot.stopRecording();
  boot.parking.remove();
}
