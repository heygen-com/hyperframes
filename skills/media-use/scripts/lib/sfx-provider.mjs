import { heygenSearch } from "./heygen-search.mjs";

export const sfxProvider = {
  async search(intent) {
    const results = heygenSearch("audio sounds list", intent, {
      type: "sound_effects",
      minScore: 0.4,
    });
    if (!results) return null;
    const best = results[0];
    return {
      url: best.audio_url,
      source: "search",
      ext: ".mp3",
      metadata: {
        description: best.description || best.name || intent,
        duration: best.duration || null,
        provider: "heygen.audio.sounds",
        provenance: { track_id: best.id, score: best.score, query: intent },
      },
    };
  },
};
