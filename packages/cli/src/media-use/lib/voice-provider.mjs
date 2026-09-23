import { HEYGEN_CLIENT_SOURCE_ARGV, runHeygenJson } from "./heygen-cli.mjs";

// Voice / TTS generation via the HeyGen CLI — the only external CLI media-use
// shells (CLI-only invariant: media-use holds no keys; the CLI owns auth).
// Flags verified against `heygen voice speech create --help` (v0.3.0).

function result(url, duration, provider, intent) {
  if (!url) return null;
  return {
    url,
    source: "generated",
    metadata: {
      description: intent,
      provider,
      ...(duration != null && { duration }),
      provenance: { prompt: intent },
    },
  };
}

// HeyGen TTS requires a starfish-engine voice. Default to the first one the
// catalog returns (deterministic order); pass ctx.voiceId to override.
// ponytail: listed once per process; the resolved asset is frozen + cached after
// first use, so the network list only happens on a cache miss. Cache only a
// truthy id -- a transient list failure must not poison the cache with `null`
// and permanently disable TTS for the rest of the process.
let cachedVoiceId;
function defaultVoiceId() {
  if (cachedVoiceId) return cachedVoiceId;
  const j = runHeygenJson(
    "heygen",
    ["voice", "list", "--engine", "starfish", "--limit", "1"],
    "voice list",
  );
  cachedVoiceId = j?.data?.[0]?.voice_id || null;
  return cachedVoiceId;
}

export async function heygenTtsGenerate(intent, ctx) {
  const voiceId = ctx?.voiceId || defaultVoiceId();
  if (!voiceId) return null;
  const p = runHeygenJson(
    "heygen",
    [
      ...HEYGEN_CLIENT_SOURCE_ARGV,
      "voice",
      "speech",
      "create",
      "--text",
      intent,
      "--voice-id",
      voiceId,
    ],
    "tts",
  );
  return result(p?.data?.audio_url, p?.data?.duration, "heygen.tts", intent);
}
