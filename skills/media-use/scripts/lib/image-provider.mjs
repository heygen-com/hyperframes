import { heygenSearch } from "./heygen-search.mjs";

export const imageProvider = {
  async search(intent) {
    const results = heygenSearch("asset search list", intent, { type: "image" });
    if (!results) return null;
    const best = results[0];
    return {
      url: best.url,
      source: "search",
      ext: ".jpg",
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
    const results = heygenSearch("asset search list", intent, { type: "icon", minScore: 0.2 });
    if (!results) return null;
    const best = results[0];
    return {
      url: best.url,
      source: "search",
      ext: ".svg",
      metadata: {
        description: intent,
        transparent: true,
        provider: "heygen.asset.search",
        provenance: { asset_id: best.id, score: best.score, type: "icon" },
      },
    };
  },
};
