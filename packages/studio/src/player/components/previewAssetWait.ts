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

/** The same question for either frame: a sealed one answers over its editing port. */
export async function previewStillLoading(
  iframe: HTMLIFrameElement,
  lastResult: boolean,
): Promise<boolean> {
  if (!previewFrameOpaque(iframe)) return hasUnloadedAssets(iframe, lastResult);
  return (await askAssetsUnloaded(iframe)) ?? lastResult;
}

/** "checking": not ready yet, but no overlay, until a sealed frame first answers. */
export type AssetWaitState = boolean | "checking";

interface AssetWait {
  refresh: boolean;
  pollRef: { current: ReturnType<typeof setInterval> | null };
  isCurrent: () => boolean;
  setLoading: (state: AssetWaitState) => void;
}

/** Keeps the asset overlay up while the preview's media cannot play through, for at most 10 s. */
export function waitForPreviewAssets(iframe: HTMLIFrameElement, wait: AssetWait): void {
  if (wait.refresh) {
    wait.setLoading(false);
    return;
  }
  const poll = (first: boolean) => {
    let lastUnloaded = first;
    if (!lastUnloaded) {
      wait.setLoading(false);
      return;
    }
    wait.setLoading(true);
    let attempts = 0;
    let asking = false;
    const finish = () => {
      if (lastUnloaded) {
        console.debug(
          "[studio] asset readiness poll hit the 10s cap, continuing with unloaded assets",
        );
      }
      if (wait.pollRef.current) clearInterval(wait.pollRef.current);
      wait.pollRef.current = null;
      wait.setLoading(false);
    };
    wait.pollRef.current = setInterval(() => {
      attempts += 1;
      if (attempts > 100) return finish();
      if (asking) return;
      asking = true;
      void previewStillLoading(iframe, lastUnloaded).then((unloaded) => {
        asking = false;
        lastUnloaded = unloaded;
        if (wait.isCurrent() && !lastUnloaded) finish();
      });
    }, 100);
  };
  if (!previewFrameOpaque(iframe)) {
    poll(hasUnloadedAssets(iframe, false));
    return;
  }
  wait.setLoading("checking");
  void previewStillLoading(iframe, false).then((first) => {
    if (wait.isCurrent()) poll(first);
  });
}
