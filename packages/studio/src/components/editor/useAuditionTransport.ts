/**
 * Start playback for an audition, and put the playhead back on the way out.
 *
 * An audition writes the hovered preset to the running graph, which is silent
 * while the transport is paused — so a paused author hovering a preset heard
 * nothing at all and the affordance only worked mid-playback. Extracted from
 * `useFxLevelling`, where the property panel's rack owned it privately, because
 * the timeline's FX popover needs exactly the same behaviour and had none: its
 * two call sites passed a preview channel and no transport, so hovering there
 * was silent by construction.
 */

import { useRef } from "react";
// The store's own module, not the `player` barrel: the barrel pulls the whole
// timeline in, and the timeline's FX button imports this hook — a cycle.
import { usePlayerStore } from "../../player/store/playerStore";

export function useAuditionTransport(): (on: boolean) => void {
  /**
   * Where the playhead was when an audition started the transport, so leaving
   * can put it back. Null means this audition did not start playback — the
   * transport was already running and must be left alone.
   */
  const auditionReturn = useRef<number | null>(null);

  /**
   * Already playing, this does nothing in either direction. The author started
   * that, and stopping their transport because they passed over a preset would
   * be the UI taking a decision that was not offered to it.
   */
  return (on: boolean): void => {
    const store = usePlayerStore.getState();
    if (on) {
      if (store.isPlaying || auditionReturn.current !== null) return;
      auditionReturn.current = store.currentTime;
      store.requestPlayback(true);
      return;
    }
    const returnTo = auditionReturn.current;
    if (returnTo === null) return;
    auditionReturn.current = null;
    store.requestPlayback(false, returnTo);
  };
}
