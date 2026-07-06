// bgm.mjs — background music for the media audio engine. Two routes, gated the
// same way as TTS/SFX:
//
//   retrieve (default when HeyGen is configured) — search HeyGen's music library
//        by mood, download the top track. Synchronous. assets/bgm/track.mp3.
//   generate (the alternative; the automatic choice when HeyGen is absent) —
//        Lyria (cloud, $GEMINI_API_KEY/$GOOGLE_API_KEY + google-genai) preferred,
//        else local MusicGen (facebook/musicgen-small via transformers). Spawned
//        DETACHED so the engine can return while audio renders; the caller marks
//        bgm_pending and runs wait-bgm.mjs before assembling. assets/bgm/track.wav.
//
// Missing/failed BGM never blocks a render.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync } from "node:fs";
import { join } from "node:path";
import { downloadTo, searchSounds } from "./heygen.mjs";
import { pythonInvocation } from "./python.mjs";

const r3 = (x) => Number(x.toFixed(3));
const lyriaKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";

const BGM_PY_DEPS = ["transformers", "torch", "soundfile", "numpy"];
const BGM_PY_PROBE =
  "import transformers, soundfile, torch, numpy; from transformers import MusicgenForConditionalGeneration";
const LYRIA_PY_DEPS = ["google-genai", "python-dotenv"];
const LYRIA_PY_PROBE = "import google.genai";

function pyOk(probe) {
  const { cmd, args } = pythonInvocation(["-c", probe]);
  return spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
}
// `python -m pip`, not a bare `pip` binary: a Homebrew/system Python often
// exposes only `python3`/`pip3` on PATH, so a plain `pip` spawn silently
// no-ops (ENOENT) and the documented "auto-installed on demand" path never
// actually installs. `-m pip` also guarantees the packages land in the SAME
// interpreter pyOk() probes — a bare `pip`/`pip3` could resolve to a
// different Python installation than `python3` if more than one is on PATH.
function pipInstall(deps) {
  const { cmd, args } = pythonInvocation(["-m", "pip", "install", "-q", ...deps]);
  return spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
}

// ── retrieval (HeyGen music library) ──────────────────────────────────────────
export async function retrieveBgm({ query, headers, hyperframesDir, hasVoice }) {
  const q = query || "calm cinematic underscore";
  const results = await searchSounds(q, "music", headers, { limit: 5 });
  if (!results.length) return null;
  const top = results[0];
  const rel = "assets/bgm/track.mp3";
  await downloadTo(top.audio_url, join(hyperframesDir, rel));
  return {
    path: rel,
    volume: hasVoice ? 0.8 : 0.9,
    query: q,
    mode: "retrieve",
    duration_s: typeof top.duration === "number" ? r3(top.duration) : null,
  };
}

// ── mood inference (for the generate path's prompt) ──────────────────────────
// Industry base → archetype shape → emotional-arc tiebreaker. Exported so a
// workflow adapter can build a rich prompt from its own narrative metadata; the
// engine also calls it when generate has only a plain mood query.
export function inferBgmPrompt({ blob = "", archetype = "", arc = "", userPrompt = "" } = {}) {
  if (userPrompt) return userPrompt;
  const b = String(blob).toLowerCase();
  let base;
  let bpm;
  if (/\b(crypto|nft|web3|defi|token|blockchain|exchange|wallet|dao)\b/.test(b)) {
    base = "atmospheric electronic, deep bass, futuristic synths, restrained percussion";
    bpm = 100;
  } else if (/\b(finance|fintech|bank|payment|invest|wealth|insurance|treasury)\b/.test(b)) {
    base = "calm cinematic, soft strings, subtle piano, restrained percussion";
    bpm = 92;
  } else if (/\b(creative|agency|design|studio|art|brand|marketing|content)\b/.test(b)) {
    base = "playful electronic, warm pads, light percussion";
    bpm = 115;
  } else {
    base = "uplifting corporate tech, bright modern piano with synth pads";
    bpm = 108;
  }
  const at = String(archetype).toLowerCase();
  const ar = String(arc).toLowerCase();
  if (/\bpas\b|pain.agitate|pain.+solve/.test(at))
    return `${base}, starts with subtle tension then builds to resolution, BPM ${bpm}, transitions from MINOR to MAJOR`;
  if (/\bbab\b|before.after|future.pac|vision/.test(at))
    return `${base}, cinematic and aspirational, steady build with rising energy, BPM ${bpm}, MAJOR`;
  if (/cascade|feature.benefit/.test(at))
    return `${base}, energetic and driving, consistent momentum, BPM ${Math.min(bpm + 10, 128)}, MAJOR`;
  if (/demo.loop|question.+answer/.test(at))
    return `${base}, clean and focused, minimal arrangement, BPM ${Math.max(bpm - 8, 88)}`;
  if (/frustrat|anxiety|overwhelm|tension/.test(ar) && /relief|excite|triumph/.test(ar))
    return `${base}, builds from understated tension to uplifting resolution, BPM ${bpm}, MINOR to MAJOR`;
  if (/excit|awe|power|triumph/.test(ar))
    return `${base}, energetic and confident, BPM ${bpm}, MAJOR`;
  if (/trust|ease|clarity|reassur/.test(ar))
    return `${base}, warm and reassuring, BPM ${Math.max(bpm - 5, 85)}`;
  return `${base}, BPM ${bpm}, MAJOR`;
}

// ── generation (Lyria → MusicGen, detached) ──────────────────────────────────
// Returns a bgmMeta the caller folds into audio_meta:
//   { path, mode, volume, provider, pid, log, target_duration_s, seed_duration_s,
//     loop_count, pending:true }  on success, or  { disabled:true, reason }.
export function generateBgmDetached({
  prompt,
  durationS,
  hyperframesDir,
  lyriaRecipe,
  seedSeconds = 28,
  hasVoice,
}) {
  const rel = "assets/bgm/track.wav";
  const abs = join(hyperframesDir, rel);
  mkdirSync(join(hyperframesDir, "assets", "bgm"), { recursive: true });
  const log = join(hyperframesDir, "assets", "bgm", `bgm-${Date.now()}.log`);
  const targetS = Math.max(1, durationS);
  const baseMeta = { path: rel, mode: null, volume: hasVoice ? 0.8 : 0.9, pending: true };

  const lyriaConfigured = !!lyriaKey() && !!lyriaRecipe && existsSync(lyriaRecipe);

  // Make a backend runnable: prefer Lyria when configured (install google-genai
  // on demand), else ensure local MusicGen deps. Installs are synchronous here —
  // generation itself is detached, so the engine still returns promptly.
  if (lyriaConfigured && !pyOk(LYRIA_PY_PROBE)) pipInstall(LYRIA_PY_DEPS);
  const useLyria = lyriaConfigured && pyOk(LYRIA_PY_PROBE);
  if (!useLyria && !pyOk(BGM_PY_PROBE)) pipInstall(BGM_PY_DEPS);

  const fd = openSync(log, "w");
  if (useLyria) {
    const { cmd, args } = pythonInvocation([
      lyriaRecipe,
      "--output",
      abs,
      "--duration",
      String(targetS),
      "--prompt",
      prompt,
    ]);
    const proc = spawn(cmd, args, { detached: true, stdio: ["ignore", fd, fd] });
    proc.unref();
    closeSync(fd);
    return {
      ...baseMeta,
      mode: "detached-single",
      provider: "lyria",
      pid: proc.pid,
      log,
      target_duration_s: r3(targetS),
    };
  }

  if (pyOk(BGM_PY_PROBE)) {
    const seedS = Math.min(Math.max(seedSeconds, 10), 30);
    const loops = targetS > seedS ? Math.ceil(targetS / seedS) : 1;
    const script = musicgenScript({ prompt, abs, targetS, seedS });
    const { cmd, args } = pythonInvocation(["-c", script]);
    const proc = spawn(cmd, args, { detached: true, stdio: ["ignore", fd, fd] });
    proc.unref();
    closeSync(fd);
    return {
      ...baseMeta,
      mode: targetS > seedS ? "detached-seed-loop" : "detached-seed-trim",
      provider: "musicgen",
      pid: proc.pid,
      log,
      target_duration_s: r3(targetS),
      seed_duration_s: seedS,
      loop_count: loops,
    };
  }

  closeSync(fd);
  return {
    disabled: true,
    reason: lyriaConfigured
      ? `Lyria configured but google-genai uninstallable, and local MusicGen unavailable (pip install ${BGM_PY_DEPS.join(" ")})`
      : `no Lyria key/recipe and local MusicGen deps unavailable (pip install ${BGM_PY_DEPS.join(" ")})`,
  };
}

// Inline MusicGen: generate ONE seed clip (≤30s to stay under the decoder's
// positional limit), then trim it down or crossfade-loop it up to the target.
function musicgenScript({ prompt, abs, targetS, seedS }) {
  return `
import math, os, sys, traceback
from pathlib import Path
import numpy as np
import soundfile as sf
from transformers import MusicgenForConditionalGeneration, AutoProcessor

prompt = ${JSON.stringify(prompt)}
out_path = ${JSON.stringify(abs)}
target_s = float(${targetS.toFixed(3)})
seed_s = float(${seedS.toFixed(3)})
token_rate = 50
crossfade_s = 0.3

def apply_fade(arr, sr, fade_in_s=0.08, fade_out_s=0.5):
    n_in = min(int(round(fade_in_s * sr)), arr.shape[0] // 2)
    n_out = min(int(round(fade_out_s * sr)), arr.shape[0] // 2)
    if n_in > 1: arr[:n_in] *= np.linspace(0.0, 1.0, n_in, dtype="float32")
    if n_out > 1: arr[-n_out:] *= np.linspace(1.0, 0.0, n_out, dtype="float32")
    return arr

def loop_crossfade(seed, target_len, xf):
    if seed.shape[0] >= target_len: return seed[:target_len]
    xf = min(xf, seed.shape[0] // 2)
    if xf < 1:
        reps = int(math.ceil(target_len / seed.shape[0]))
        return np.tile(seed, reps)[:target_len]
    t = np.linspace(0.0, 1.0, xf, dtype="float32")
    fade_out = np.cos(t * (math.pi / 2)); fade_in = np.sin(t * (math.pi / 2))
    out = seed.copy()
    while out.shape[0] < target_len:
        tail = out[-xf:] * fade_out; head = seed[:xf] * fade_in
        out = np.concatenate([out[:-xf], tail + head, seed[xf:]])
    return out[:target_len]

try:
    Path(os.path.dirname(out_path)).mkdir(parents=True, exist_ok=True)
    processor = AutoProcessor.from_pretrained("facebook/musicgen-small")
    model = MusicgenForConditionalGeneration.from_pretrained("facebook/musicgen-small")
    model.eval()
    sr = int(model.config.audio_encoder.sampling_rate)
    gen_s = min(seed_s, target_s)
    tokens = max(1, int(math.ceil(gen_s * token_rate)))
    print(f"[musicgen] seed dur={gen_s:.2f}s tokens={tokens}", flush=True)
    inputs = processor(text=[prompt], padding=True, return_tensors="pt")
    audio = model.generate(**inputs, max_new_tokens=tokens)
    seed = audio[0, 0].detach().cpu().numpy().astype("float32")
    peak = float(np.max(np.abs(seed)))
    if peak > 1e-6: seed = seed * (0.89 / peak)
    want = max(1, int(round(target_s * sr)))
    if seed.shape[0] >= want:
        final = seed[:want].copy()
    else:
        final = loop_crossfade(seed, want, int(round(crossfade_s * sr)))
    if final.shape[0] < want: final = np.pad(final, (0, want - final.shape[0]))
    else: final = final[:want]
    final = apply_fade(final, sr)
    peak = float(np.max(np.abs(final)))
    if peak > 1.0: final = final / peak
    sf.write(out_path, final, sr)
    print(f"[musicgen] wrote {out_path} samples={final.shape[0]} sr={sr}", flush=True)
except Exception:
    traceback.print_exc(); sys.exit(1)
`;
}
