import { OpenverseUnavailableError, searchOpenverseSfx } from "./openverse.mjs";

export const OPENVERSE_SFX_PROVIDER = "openverse.audio";

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
