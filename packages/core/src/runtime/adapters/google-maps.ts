import { createReadinessAdapter } from "./_readiness";

type GoogleMapLike = {
  addListener: (event: string, cb: () => void) => { remove: () => void };
};

export function createGoogleMapsAdapter() {
  return createReadinessAdapter<GoogleMapLike>({
    name: "google-maps",
    getInstances: () => {
      if (typeof window === "undefined") return [];
      const arr = (window as { __hfGoogleMaps?: GoogleMapLike[] }).__hfGoogleMaps;
      return Array.isArray(arr) ? arr : [];
    },
    waitFor: (m) =>
      new Promise<void>((resolve) => {
        const handle = m.addListener("tilesloaded", () => {
          handle.remove();
          resolve();
        });
      }),
  });
}
