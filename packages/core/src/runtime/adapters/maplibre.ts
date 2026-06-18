import { createReadinessAdapter } from "./_readiness";

type MaplibreMapLike = {
  loaded: () => boolean;
  on: (event: string, cb: () => void) => void;
};

// 'load' = style + sources ready; same contract as Mapbox GL JS
export function createMaplibreAdapter() {
  return createReadinessAdapter<MaplibreMapLike>({
    name: "maplibre",
    getInstances: () => {
      if (typeof window === "undefined") return [];
      const arr = (window as { __hfMaplibre?: MaplibreMapLike[] }).__hfMaplibre;
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
