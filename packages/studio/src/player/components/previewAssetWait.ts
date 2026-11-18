import { previewAssetsUnloaded } from "@hyperframes/core/runtime/lottie-readiness";
import {
  previewAssetsUnloaded as askAssetsUnloaded,
  previewFrameOpaque,
} from "../lib/previewChannel";

// Returns whichever value was returned last on cross-origin / transient DOM
// races so a brief access failure (e.g. an iframe that just swapped src)
// doesn't flicker the overlay state — we keep showing whatever was most
// recently true.
export function hasUnloadedAssets(iframe: HTMLIFrameElement, lastResult: boolean): boolean {
  try {
    const win = iframe.contentWindow as unknown as (Window & { __hfLottie?: unknown[] }) | null;
    const doc = iframe.contentDocument;
    if (!win || !doc) return lastResult;
    return previewAssetsUnloaded(doc, win.__hfLottie);
  } catch {
    return lastResult;
  }
}

/** "checking": not ready yet, but no overlay, until a sealed frame first answers. */
export type AssetWaitState = boolean | "checking";

interface AssetWait {
  refresh: boolean;
  pollRef: { current: ReturnType<typeof setInterval> | null };
  isCurrent: () => boolean;
  setLoading: (state: AssetWaitState) => void;
}

const POLL_MS = 100;
const MAX_POLLS = 100;

/** Keeps the asset overlay up while the preview's media cannot play through, for at most 10 s. A sealed frame that
 *  gives no answer (its port not up yet, or replaced by the load) is asked again, never taken as ready. */
export function waitForPreviewAssets(iframe: HTMLIFrameElement, wait: AssetWait): void {
  if (wait.refresh) {
    wait.setLoading(false);
    return;
  }
  const sealed = previewFrameOpaque(iframe);
  let state: AssetWaitState = sealed ? "checking" : hasUnloadedAssets(iframe, false);
  wait.setLoading(state);
  if (state === false) return;

  let polls = 0;
  let asking = false;
  const handle = setInterval(() => tick(), POLL_MS);
  wait.pollRef.current = handle;
  const live = () => wait.pollRef.current === handle && wait.isCurrent();
  const stop = () => {
    clearInterval(handle);
    wait.pollRef.current = null;
    wait.setLoading(false);
  };
  const ask = async (): Promise<boolean | null> =>
    sealed ? askAssetsUnloaded(iframe) : hasUnloadedAssets(iframe, state === true);
  const tick = () => {
    if (!live()) return clearInterval(handle);
    polls += 1;
    if (polls > MAX_POLLS) {
      console.debug(
        "[studio] asset readiness poll hit the 10s cap, continuing with unloaded assets",
      );
      return stop();
    }
    if (asking) return;
    asking = true;
    void ask().then((unloaded) => {
      asking = false;
      if (!live() || unloaded === null) return;
      if (!unloaded) return stop();
      if (state === true) return;
      state = true;
      wait.setLoading(true);
    });
  };
  if (sealed) tick();
}
