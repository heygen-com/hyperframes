import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Voice / TTS generation. HeyGen TTS is the free-first default (uses the wallet
// credential you already hold for the catalog); ElevenLabs is the paid fallback
// behind --allow-paid. Both shell their own CLI (CLI-only invariant: media-use
// holds no keys). HeyGen flags verified against `heygen voice speech create
// --help` (v0.1.6).
//
// ElevenLabs: the OFFICIAL @elevenlabs/cli is agents-only and has NO TTS command.
// TTS comes from the community CLI (github.com/hongkongkiwi/elevenlabs-cli):
//   install: npm i -g elevenlabs-cli   auth: export ELEVENLABS_API_KEY=...
//   tts:     elevenlabs-cli tts "<text>" --voice <name> --output <file.mp3>
// text is positional, output is a FILE (not JSON+url). Surface per the project
// README; live generation unverified here (no ELEVENLABS_API_KEY in this env).

function runJson(bin, argv, label) {
  let out;
  try {
    out = execFileSync(bin, argv, {
      encoding: "utf8",
      timeout: 120000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    console.error(
      `media-use: \`${bin}\` ${label} failed: ${err.stderr?.toString().trim() || err.message}`,
    );
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

export async function elevenlabsGenerate(intent, ctx) {
  const outPath = join(tmpdir(), `media-use-eleven-${process.pid}.mp3`);
  const argv = ["tts", intent, "--output", outPath];
  if (ctx?.voice) argv.push("--voice", ctx.voice);
  try {
    execFileSync("elevenlabs-cli", argv, {
      encoding: "utf8",
      timeout: 120000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    console.error(
      `media-use: \`elevenlabs-cli tts\` failed: ${err.stderr?.toString().trim() || err.message}`,
    );
    return null;
  }
  if (!existsSync(outPath)) return null;
  return {
    localPath: outPath,
    source: "generated",
    metadata: { description: intent, provider: "elevenlabs", provenance: { prompt: intent } },
  };
}
