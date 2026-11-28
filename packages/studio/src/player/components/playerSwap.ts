import type { ForwardedRef } from "react";

export function handFrameToRef(ref: ForwardedRef<HTMLIFrameElement>, iframe: HTMLIFrameElement) {
  if (typeof ref === "function") ref(iframe);
  else if (ref) ref.current = iframe;
}

export function hideWhileLoading(player: HTMLElement, hidden: boolean) {
  player.style.visibility = hidden ? "hidden" : "";
  player.style.position = hidden ? "absolute" : "";
  player.style.inset = hidden ? "0" : "";
}

/** A primed frame token found stale, or never confirmed: the preview loads again under the current one. */
export function staleTokenSwap(canceled: () => boolean) {
  let loadInFreshPlayer: ((src: string) => void) | null = null;
  let fresher: string | null = null;
  let retries = 0;
  return {
    onStale(fresh: string) {
      if (canceled() || retries > 0) return;
      fresher = fresh;
      loadInFreshPlayer?.(fresh);
    },
    src: (primed: string) => fresher ?? primed,
    show(load: (src: string) => void) {
      loadInFreshPlayer = load;
    },
    retry(primed: string, load: (src: string) => void, askAgain?: () => Promise<string>) {
      const attempt = ++retries;
      if (!askAgain) return load(fresher ?? primed);
      void askAgain().then((current) => {
        if (canceled() || attempt !== retries) return;
        fresher = current;
        load(current);
      });
    },
  };
}
