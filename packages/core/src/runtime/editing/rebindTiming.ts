import { finalizeSoftReload, swapWaiting, type SoftReloadWindow } from "./softReload";

/** Re-derives every clip window from the live timing attributes; false while a swap waits or with no rebind. */
export function rebindTiming({ time }: { time: number }): { rebound: boolean } {
  const win = window as SoftReloadWindow;
  if (swapWaiting(win) || !win.__hfForceTimelineRebind) return { rebound: false };
  const finalize = () => finalizeSoftReload(win, time);
  if (win.__hfSuppressSceneMutations) win.__hfSuppressSceneMutations(finalize);
  else finalize();
  return { rebound: true };
}
