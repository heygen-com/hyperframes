import { heygenSearch } from "./heygen-search.mjs";
import { OpenverseUnavailableError, searchOpenverseSfx } from "./openverse.mjs";

export const OPENVERSE_SFX_PROVIDER = "openverse.audio";

// Good effects score 0.5-0.67, under the server's default floor of 0.7, so the floor is lowered; a match under
// SFX_CONFIDENT_SCORE is still returned, flagged so the caller listens before placing it.
export const SFX_MIN_SCORE = 0.4;
export const SFX_CONFIDENT_SCORE = 0.5;

export function scoreMatch(score) {
  const known = typeof score === "number" ? score : null;
  return {
    score: known,
    min_score: SFX_MIN_SCORE,
    low_confidence: known === null || known < SFX_CONFIDENT_SCORE,
  };
}

export const heygenSfxProvider = {
  async search(intent) {
    const results = heygenSearch("audio sounds list", intent, {
      type: "sound_effects",
      minScore: SFX_MIN_SCORE,
      onEmpty: () =>
        console.error(
          `media-use: HeyGen sound search matched nothing for "${intent}" at min score ${SFX_MIN_SCORE}; trying the next source`,
        ),
    });
    if (!results) return null;
    const best = results[0];
    return {
      url: best.audio_url,
      source: "search",
      match: scoreMatch(best.score),
      metadata: {
        description: best.description || intent,
        duration: best.duration || null,
        provider: "heygen.audio.sounds",
        provenance: { track_id: best.id, score: best.score, query: intent },
      },
    };
  },
};

export const sfxProvider = {
  async search(intent) {
    let sound;
    try {
      sound = await searchOpenverseSfx(intent);
    } catch (error) {
      if (!(error instanceof OpenverseUnavailableError)) throw error;
      console.error(`media-use: ${error.message}; using the bundled sound effects`);
      return null;
    }
    if (!sound) return null;
    return {
      url: sound.url,
      ext: sound.ext,
      source: "search",
      metadata: {
        description: sound.title || intent,
        duration: sound.durationS,
        provider: OPENVERSE_SFX_PROVIDER,
        provenance: {
          openverse_id: sound.id,
          license: sound.license,
          credit: sound.credit,
          source_url: sound.sourceUrl,
        },
      },
    };
  },
};
