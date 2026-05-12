import type { RuntimeDeterministicAdapter } from "../types";
import { dispatchSeekEvent } from "./seek-dispatch";

export function createThreeAdapter(): RuntimeDeterministicAdapter {
  let forcedTime: number | null = null;
  let lastForcedTime = 0;

  return {
    name: "three",
    discover: () => {},
    seek: (ctx) => {
      forcedTime = Math.max(0, Number(ctx.time) || 0);
      lastForcedTime = forcedTime;
      window.__hfThreeTime = forcedTime;
      dispatchSeekEvent(forcedTime);
    },
    pause: () => {
      if (forcedTime == null) {
        forcedTime = Math.max(0, lastForcedTime);
      }
    },
    play: () => {
      forcedTime = null;
    },
    revert: () => {
      forcedTime = null;
      lastForcedTime = 0;
    },
  };
}
