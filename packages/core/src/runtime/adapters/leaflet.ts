import { createReadinessAdapter } from "./_readiness";

type LeafletMapLike = {
  whenReady: (cb: () => void) => void;
};

export function createLeafletAdapter() {
  return createReadinessAdapter<LeafletMapLike>({
    name: "leaflet",
    getInstances: () => {
      if (typeof window === "undefined") return [];
      const arr = (window as { __hfLeaflet?: LeafletMapLike[] }).__hfLeaflet;
      return Array.isArray(arr) ? arr : [];
    },
    waitFor: (m) => new Promise<void>((resolve) => m.whenReady(resolve)),
  });
}
