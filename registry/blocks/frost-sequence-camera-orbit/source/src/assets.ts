// FROST: the experiment served its assets from the site root (/textures, /fonts, /logo.svg ...). As a
// HyperFrames block they live in ./assets next to index.html, resolved relative to the composition document.
export const ASSET_BASE: string =
  (typeof window !== "undefined" && (window as any).__frostAssetBase) || "assets/";
export const assetUrl = (name: string) => ASSET_BASE + name;
