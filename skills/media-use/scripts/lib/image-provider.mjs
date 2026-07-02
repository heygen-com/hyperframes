import { heygenSearch } from "./heygen-search.mjs";

export const imageProvider = {
  async search(intent) {
    const results = heygenSearch("asset search", intent, { type: "image" });
    if (!results) return null;
    const best = results[0];
    return {
      url: best.url,
      source: "search",
      // ext derived from the asset URL by resolve.mjs (.jpg/.png/.webp)
      metadata: {
        description: intent,
        width: best.width || null,
        height: best.height || null,
        transparent: best.is_transparent || false,
        provider: "heygen.asset.search",
        provenance: { asset_id: best.id, score: best.score },
      },
    };
  },
};

export const iconProvider = {
  async search(intent) {
    // No minScore: the `asset search` backend rejects --min-score and returns no score field.
    const results = heygenSearch("asset search", intent, { type: "icon" });
    if (!results) return null;
    const best = results[0];
    return {
      url: best.url,
      source: "search",
      // ext derived from the asset URL by resolve.mjs — catalog icons are .png, not .svg
      metadata: {
        description: intent,
        width: best.width || null,
        height: best.height || null,
        transparent: best.is_transparent ?? true,
        provider: "heygen.asset.search",
        provenance: { asset_id: best.id, score: best.score, type: "icon" },
      },
    };
  },
};
