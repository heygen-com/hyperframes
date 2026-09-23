import { applyPreviewVariablesToUrl } from "../../hooks/previewVariablesStore";
import { buildProjectApiPath } from "../../utils/projectRouting";

export interface HyperframesPlayerElement extends HTMLElement {
  iframeElement: HTMLIFrameElement;
}

// Importing "@hyperframes/player" registers a class extending HTMLElement at
// module load, which throws under SSR, hence the dynamic import. Clearing the memo
// on rejection stops one failure poisoning every later mount; the browser's
// module map still caches a failed fetch, so recovery is a page reload.
let playerModule: Promise<unknown> | null = null;

export function loadPlayerModule(): Promise<unknown> {
  playerModule ??= import("@hyperframes/player").catch((err: unknown) => {
    playerModule = null;
    throw err;
  });
  return playerModule;
}

/** The preview document URL (path + query) a Player loads for a project or a direct URL. */
export function previewSrc(projectId?: string, directUrl?: string): string | null {
  const source = directUrl || (projectId ? buildProjectApiPath(projectId, "/preview") : null);
  if (!source) return null;
  const url = new URL(source, window.location.origin);
  applyPreviewVariablesToUrl(url);
  return url.pathname + url.search;
}

/** A configured, unconnected preview player. The caller sets `src` once its listeners are on. */
export function createPreviewPlayer(portrait?: boolean): HyperframesPlayerElement {
  const player = document.createElement("hyperframes-player") as HyperframesPlayerElement;
  player.setAttribute("shader-capture-scale", "1");
  player.setAttribute("shader-loading", "player");
  setPreviewPlayerOrientation(player, portrait);
  player.style.width = "100%";
  player.style.height = "100%";
  player.style.display = "block";
  player.style.background = "transparent";
  return player;
}

export function setPreviewPlayerOrientation(player: HTMLElement, portrait?: boolean): void {
  player.setAttribute("width", String(portrait ? 1080 : 1920));
  player.setAttribute("height", String(portrait ? 1920 : 1080));
}
