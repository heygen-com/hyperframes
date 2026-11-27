import { STUDIO_PREVIEW_PAGE_DEADLINE_MS } from "@hyperframes/core/studio-preview-mark";
import type { IframeWindow } from "../lib/playbackTypes";

export function shadowPlayerReachable(iframe: HTMLIFrameElement | null): boolean {
  try {
    return Boolean((iframe?.contentWindow as IframeWindow | null | undefined)?.__player);
  } catch {
    return false;
  }
}

/** @public (tests) */
export function shadowPagePhase(iframe: HTMLIFrameElement | null): string {
  const doc = iframe?.isConnected ? iframe.contentDocument : undefined;
  if (doc === undefined) return "no-frame";
  if (!doc) return "unreadable";
  if (doc.URL === "about:blank") return "blank";
  const win = iframe!.contentWindow as unknown as Record<string, unknown>;
  if (doc.readyState === "loading") return "page-loading";
  if (win.__hfStartupError) return "startup-error";
  if (!win.__hyperframes) return "runtime-not-run";
  if (!win.__hyperframeRuntimeBootstrapped) return "scripts-waiting";
  return "no-player";
}

const givenAddress = (iframe: HTMLIFrameElement | null) =>
  !/^(about:blank)?$/.test(iframe?.getAttribute("src") ?? "");
const frameAddedAt = new WeakMap<HTMLIFrameElement, number>();
export const noteFrameAdded = (iframe: HTMLIFrameElement) => frameAddedAt.set(iframe, Date.now());

/** A frame still holding the blank document it began with while it waits for the server's answer, short of the
 * server's own page deadline plus `graceMs`. */
export const waitsOnServer = (iframe: HTMLIFrameElement | null, graceMs: number) =>
  givenAddress(iframe) &&
  shadowPagePhase(iframe) === "blank" &&
  Date.now() - frameAddedAt.get(iframe!)! < STUDIO_PREVIEW_PAGE_DEADLINE_MS + graceMs;
export function pageGotTo(iframe: HTMLIFrameElement | null): string {
  const phase = shadowPlayerReachable(iframe) ? null : shadowPagePhase(iframe);
  if (phase !== "blank" && phase !== "unreadable")
    return phase ? ` Its page had got to: ${phase}.` : "";
  const given = givenAddress(iframe) ? "was" : "was never";
  return ` Its page had got to: ${phase}. Its frame ${given} given a page address and was added ${Date.now() - frameAddedAt.get(iframe!)!} ms ago.`;
}
