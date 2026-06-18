import type { RuntimeDeterministicAdapter } from "../types";
import { dispatchSeekEvent } from "./seek-dispatch";

/**
 * Minimal shape of `THREE.DefaultLoadingManager` we rely on. Kept local to
 * the adapter so we don't take a dependency on three.js types (the library
 * itself is loaded at runtime by the composition, not bundled).
 *
 * See https://threejs.org/docs/#api/en/loaders/managers/LoadingManager
 */
type ThreeLoadingManagerLike = {
  itemsLoaded: number;
  itemsTotal: number;
  onStart?: ((url: string, itemsLoaded: number, itemsTotal: number) => void) | null;
  onLoad?: (() => void) | null;
};

export function createThreeAdapter(): RuntimeDeterministicAdapter {
  let forcedTime: number | null = null;
  let lastForcedTime = 0;

  // Track the LoadingManager we've already wrapped so `discover` is idempotent
  // (init.ts calls it multiple times — at startup AND at every
  // `maybePublishRenderReady` evaluation cycle, to catch THREE that finished
  // loading between checks).
  let hookedManager: ThreeLoadingManagerLike | null = null;
  let userOnStart: ThreeLoadingManagerLike["onStart"] = null;
  let userOnLoad: ThreeLoadingManagerLike["onLoad"] = null;
  let pendingPromise: PromiseLike<void> | null = null;

  const getLoadingManager = (): ThreeLoadingManagerLike | null => {
    if (typeof window === "undefined") return null;
    // `window.THREE` is typed in window.d.ts with only the minimal `Clock` /
    // `AnimationMixer` shape; cast through `unknown` to read the loader fields.
    const three = (window as { THREE?: { DefaultLoadingManager?: ThreeLoadingManagerLike } }).THREE;
    const mgr = three?.DefaultLoadingManager;
    if (!mgr || typeof mgr !== "object") return null;
    if (typeof mgr.itemsLoaded !== "number" || typeof mgr.itemsTotal !== "number") return null;
    return mgr;
  };

  const armPendingIfNeeded = (mgr: ThreeLoadingManagerLike) => {
    if (pendingPromise) return;
    if (mgr.itemsTotal <= mgr.itemsLoaded) return;
    pendingPromise = new Promise<void>((resolve) => {
      // Wrap onLoad so we resolve once the queue drains. Restore the user's
      // own callback (captured at hook time) so multi-asset compositions still
      // see their own onLoad fire normally.
      mgr.onLoad = function (this: ThreeLoadingManagerLike) {
        try {
          userOnLoad?.call(this);
        } finally {
          pendingPromise = null;
          // Reinstall the user's callback as the live one — onStart will
          // re-wrap it the next time a new batch starts.
          mgr.onLoad = userOnLoad ?? null;
          resolve();
        }
      };
    });
  };

  const hookManager = (mgr: ThreeLoadingManagerLike) => {
    if (hookedManager === mgr) return;
    hookedManager = mgr;
    userOnStart = mgr.onStart ?? null;
    userOnLoad = mgr.onLoad ?? null;
    // Wrap onStart so any load queued AFTER our discover runs (the common
    // case — user composition scripts run after the HF runtime mounts) still
    // arms a wait. Without this, items queued post-discover would never be
    // observed and the runtime would publish render-ready while textures
    // were still in flight (issue #PR-1543).
    mgr.onStart = function (this: ThreeLoadingManagerLike, url, loaded, total) {
      try {
        userOnStart?.call(this, url, loaded, total);
      } finally {
        armPendingIfNeeded(mgr);
      }
    };
  };

  return {
    name: "three",
    discover: () => {
      const mgr = getLoadingManager();
      if (!mgr) return;
      hookManager(mgr);
      // Items may already be queued at discover time (e.g. THREE+loader were
      // bundled inline and ran synchronously). Catch them before any new
      // onStart fires.
      armPendingIfNeeded(mgr);
    },
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
    getReadyPromise: () => {
      // If THREE hasn't loaded yet, nothing to wait on — `discover` will be
      // called again on the next readiness-publish cycle and pick it up.
      const mgr = getLoadingManager();
      if (!mgr) return null;
      // Drain check: itemsTotal can grow over time as user code queues more
      // loads; itemsLoaded catches up via onLoad. We only block while the
      // queue is non-empty AND not yet drained.
      if (mgr.itemsTotal <= mgr.itemsLoaded) return null;
      // If we haven't wrapped onLoad yet (e.g. items queued between an
      // onStart we missed and now), arm one.
      if (!pendingPromise) {
        armPendingIfNeeded(mgr);
      }
      return pendingPromise;
    },
  };
}
