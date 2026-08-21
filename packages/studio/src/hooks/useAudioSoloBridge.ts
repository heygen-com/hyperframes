import { useEffect, useMemo } from "react";
import { HF_AUDIO_GROUP_TAG } from "@hyperframes/core/audio-groups";
import { usePlayerStore } from "../player/store/playerStore";
import { getTimelineElementDisplayLabel } from "../player/lib/timelineElementHelpers";

interface IframeWindow extends Window {
  __hf?: { setAudioSolo?: (ids: readonly string[]) => void };
}

/**
 * Pushes the studio's "Hear only this" set into the preview runtime whenever
 * it changes. A dedicated push, not a DOM write: solo is session-only and
 * must never touch an attribute (design doc §2.2 / the export-safety
 * guarantee), so it can't ride `syncTimedElementVisibility`'s attribute-diff
 * the way group mute does — see `window.__hf.setAudioSolo`.
 */
export function useAudioSoloBridge(previewIframeRef: { current: HTMLIFrameElement | null }): void {
  const soloed = usePlayerStore((s) => s.soloed);
  useEffect(() => {
    const win = previewIframeRef.current?.contentWindow as IframeWindow | null;
    win?.__hf?.setAudioSolo?.([...soloed]);
  }, [soloed, previewIframeRef]);
}

/** One soloed id's display label — reads the live preview DOM directly (same
 *  approach as `patchLiveGroupAttribute`), since solo ids are never anywhere
 *  but the document's own element ids. A group carries its label on
 *  `data-label`; anything else falls back to the same label rule the
 *  timeline itself uses. */
function resolveSoloLabel(doc: Document | null | undefined, id: string): string {
  const el = doc?.getElementById(id);
  if (!el) return id;
  if (el.tagName.toLowerCase() === HF_AUDIO_GROUP_TAG) {
    return getTimelineElementDisplayLabel({ id, label: el.getAttribute("data-label") });
  }
  return getTimelineElementDisplayLabel({
    id,
    label: el.getAttribute("data-timeline-label") ?? el.getAttribute("data-label"),
    tag: el.tagName,
  });
}

/**
 * The transport bar's "Hear only this" banner text — `null` while nothing is
 * soloed. One name when exactly one thing is soloed, `"N tracks"` otherwise
 * (design doc §2.2's banner rule); "your export is not affected" is fixed
 * copy the caller owns, this only resolves the variable half.
 */
export function useSoloBannerText(previewIframeRef: {
  current: HTMLIFrameElement | null;
}): string | null {
  const soloed = usePlayerStore((s) => s.soloed);
  return useMemo(() => {
    if (soloed.size === 0) return null;
    if (soloed.size === 1) {
      const doc = previewIframeRef.current?.contentDocument;
      return resolveSoloLabel(doc, [...soloed][0]);
    }
    return `${soloed.size} tracks`;
  }, [soloed, previewIframeRef]);
}
