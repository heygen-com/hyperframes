import { createReadinessAdapter } from "./_readiness";

type MapboxMapLike = {
  loaded: () => boolean;
  on: (event: string, cb: () => void) => void;
};

// 'load' = style + sources ready (not tile-level 'idle'); sufficient for render-ready gate
export function createMapboxAdapter() {
  return createReadinessAdapter<MapboxMapLike>({
    name: "mapbox",
    getInstances: () => {
      if (typeof window === "undefined") return [];
      const arr = (window as { __hfMapbox?: MapboxMapLike[] }).__hfMapbox;
      return Array.isArray(arr) ? arr : [];
    },
    waitFor: (m) =>
      new Promise<void>((resolve) => {
        if (m.loaded()) {
          resolve();
          return;
        }
        m.on("load", resolve);
      }),
  });
}
