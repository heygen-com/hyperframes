import { execFileSync } from "node:child_process";
import { reportHeygenFailure } from "./heygen-cli.mjs";

// Voice / TTS generation via the HeyGen CLI — the only external CLI media-use
// shells (CLI-only invariant: media-use holds no keys; the CLI owns auth).
// Flags verified against `heygen voice speech create --help` (v0.3.0).

function runJson(bin, argv, label) {
  let out;
  try {
    out = execFileSync(bin, argv, {
      encoding: "utf8",
      timeout: 120000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    reportHeygenFailure(err, `${bin} ${label}`);
    return null;
  }
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

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
// first use, so the network list only happens on a cache miss.
let cachedVoiceId;
function defaultVoiceId() {
  if (cachedVoiceId !== undefined) return cachedVoiceId;
  const j = runJson(
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
  const p = runJson(
    "heygen",
    ["voice", "speech", "create", "--text", intent, "--voice-id", voiceId],
    "tts",
  );
  return result(p?.data?.audio_url, p?.data?.duration, "heygen.tts", intent);
}
