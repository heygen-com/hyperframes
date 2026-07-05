// Declarative table of USER-INSTALLED local models, for the spec-gated fallback.
//
// These models run on the user's own machine for their own use — media-use
// recommends, spec-checks, and assists install; it does not bundle, redistribute,
// or sell them. Because nothing is redistributed, selection is purely by
// quality / size / spec-fit / word-timestamp support — there is deliberately NO
// license field gating availability.
//
// Tiers: `medium` = broad-compat, smaller (auto-install target ~<=2 GB);
// `large` = best quality, needs a strong machine. selectModel() picks the
// highest tier the machine can run, or returns a recommend-the-CLI result.
//
// Picks reflect the 2026 research pass (see the v2 plan). The large-tier TTS
// default (fish-speech) is the meeting's pick; final defaults are confirmed by
// the eval harness in U7 — this table is the shortlist + current default.

export const CAPABILITIES = ["tts", "asr", "upscale", "videogen", "imagegen"];

const MODELS = {
  tts: [
    {
      id: "kokoro",
      tier: "medium",
      sizeMB: 330,
      needs: { ramMB: 2048, gpu: false },
      wordTimestamps: "native",
      install: "pip install kokoro",
      invoke: "python -m kokoro --text {text} --voice {voice} --out {out}",
      notes: "CPU, faster-than-realtime, native per-word timestamps. Default floor.",
    },
    {
      id: "fish-speech",
      tier: "large",
      sizeMB: 1100,
      needs: { ramMB: 16000, gpu: true, vramMB: 12000 },
      wordTimestamps: "whisperx", // needs forced alignment (run ASR over output)
      install: "pip install fish-speech",
      invoke: "fish-speech synth --text {text} --ref {ref} --out {out}",
      notes: "Expressive zero-shot voice cloning; meeting pick. WhisperX for word timing.",
    },
  ],
  asr: [
    {
      id: "whisperx",
      tier: "medium",
      sizeMB: 1500,
      needs: { ramMB: 4096, gpu: false },
      wordTimestamps: "native", // faster-whisper + wav2vec2 forced alignment
      install: "pip install whisperx",
      invoke: "whisperx {audio} --output_format json --out {out}",
      notes: "Sub-100ms word timestamps on CPU. Strict upgrade over plain whisper.",
    },
    {
      id: "parakeet",
      tier: "large",
      sizeMB: 2400,
      needs: { ramMB: 8000, gpu: true, vramMB: 4000 },
      wordTimestamps: "native",
      install: "pip install parakeet-mlx  # NVIDIA: nemo-toolkit[asr]",
      invoke: "parakeet {audio} --timestamps word --out {out}",
      notes: "~1000x realtime; native word timestamps. Apple Silicon via parakeet-mlx.",
    },
  ],
  upscale: [
    {
      id: "real-esrgan",
      tier: "medium",
      sizeMB: 70,
      needs: { ramMB: 2048, gpu: false },
      wordTimestamps: false,
      install: "brew install real-esrgan-ncnn-vulkan  # or download the ncnn binary",
      invoke: "realesrgan-ncnn-vulkan -i {in} -o {out} -s 4",
      notes: "ncnn-vulkan binary, CPU-capable. GFPGAN for faces.",
    },
    {
      id: "seedvr2",
      tier: "large",
      sizeMB: 6000,
      needs: { ramMB: 24000, gpu: true, vramMB: 16000 },
      wordTimestamps: false,
      install: "pip install seedvr2",
      invoke: "seedvr2 upscale --in {in} --out {out}",
      notes: "Diffusion upscaler, GPU-only. Video2X for video.",
    },
  ],
  videogen: [
    // 2026-07 X research pass + live verification on a 24GB M-series Mac.
    // The Mac-local video story is LTX 2.3 on MLX via dgrauet/ltx-2-mlx (the
    // pipeline these weights were converted for; also powers Phosphene).
    // Wan 2.x MLX exists only as A14B conversions (too large for consumer
    // unified memory); revisit when a 5B Wan MLX conversion lands.
    // IMPORTANT: download the weights with a targeted include list first;
    // pointing tools at the repo blind snapshot-downloads all 60 GB:
    //   hf download dgrauet/ltx-2.3-mlx-q4 --include \
    //     transformer-distilled-1.1.safetensors connector.safetensors \
    //     "vae_*.safetensors" audio_vae.safetensors vocoder.safetensors "*.json"
    {
      id: "ltx-2.3-mlx-q4",
      tier: "medium",
      sizeMB: 20000, // distilled subset; gemma-3-12b-4bit text encoder adds ~7GB
      needs: { ramMB: 16384, gpu: true },
      wordTimestamps: false,
      install:
        "git clone https://github.com/dgrauet/ltx-2-mlx && cd ltx-2-mlx && uv sync --all-extras",
      invoke:
        "ltx-2-mlx generate --prompt {prompt} --distilled --low-ram --model dgrauet/ltx-2.3-mlx-q4 --width {w} --height {h} --frames {frames} --frame-rate 24 --output {out}",
      notes:
        "LTX 2.3 int4 on MLX. Verified on 24GB unified: 512x320 x 33 frames in ~19 min cold (incl. text-encoder download), t2v with audio. Dims must be multiples of 64. i2v, retake/extend, keyframe interpolation supported.",
    },
    {
      id: "ltx-2.3-mlx-bf16",
      tier: "large",
      sizeMB: 45000,
      needs: { ramMB: 32768, gpu: true },
      wordTimestamps: false,
      install:
        "git clone https://github.com/dgrauet/ltx-2-mlx && cd ltx-2-mlx && uv sync --all-extras",
      invoke:
        "ltx-2-mlx generate --prompt {prompt} --two-stage --model dgrauet/ltx-2.3-mlx-bf16 --width {w} --height {h} --frames {frames} --frame-rate 24 --output {out}",
      notes:
        "Full-precision two-stage pipeline (upstream production default). 32GB with --low-ram block streaming; 64-128GB Macs for long/HD runs (the 25s multi-scene spots seen in the wild).",
    },
  ],
  imagegen: [
    // 2026-07 X research + live verification on a 24GB M-series Mac. mflux
    // (FLUX-on-MLX) is the Mac-native runner; FLUX is the quality leader. Two
    // hard-won findings baked into `needs.ramMB`:
    //   1. The OFFICIAL FLUX repos are HF-gated (license wall). Point --path at a
    //      non-gated community 4-bit re-upload (self-contained, incl. VAE).
    //   2. Without --low-ram, FLUX's T5-XXL text encoder + transformer blow past
    //      24GB into swap: a 768x512 run took 90 MINUTES. With --low-ram (streams
    //      components from disk) the SAME machine did 512x512 in ~20s at 7.6GB
    //      free. So the medium tier's needs.ramMB is the streamed floor, not the
    //      resident footprint; the large tiers are the no-streaming thresholds.
    // The runner resolves `repo` to a local snapshot (hf download) before --path;
    // a bare repo id in --path breaks mlx unflatten.
    {
      id: "flux-schnell-mflux-q4",
      tier: "medium",
      sizeMB: 8700,
      needs: { ramMB: 8000, gpu: true },
      repo: "dhairyashil/FLUX.1-schnell-mflux-4bit",
      wordTimestamps: false,
      install: "uv venv ~/.venvs/mflux && VIRTUAL_ENV=~/.venvs/mflux uv pip install mflux==0.9.6",
      invoke:
        "mflux-generate --model schnell --path {model_path} --low-ram --steps 4 --prompt {prompt} --width {w} --height {h} --seed {seed} --output {out}",
      notes:
        "FLUX.1 schnell int4. VERIFIED on 24GB (7.6GB free): --low-ram 512x512 in ~20s, photoreal. --low-ram is MANDATORY at this tier (streams to avoid swap). Few-step, fast.",
    },
    {
      id: "flux2-klein-mflux-q4",
      tier: "large",
      sizeMB: 12000,
      needs: { ramMB: 32000, gpu: true },
      repo: "Runpod/FLUX.2-klein-4B-mflux-4bit",
      wordTimestamps: false,
      install: "uv venv ~/.venvs/mflux && VIRTUAL_ENV=~/.venvs/mflux uv pip install mflux",
      invoke:
        "mflux-generate --base-model flux2-klein-4b --path {model_path} --steps 8 --prompt {prompt} --width {w} --height {h} --seed {seed} --output {out}",
      notes:
        "FLUX.2 Klein 4B int4 (most-downloaded mflux community repo). Newer, higher quality than schnell; full-resident (no streaming) so needs 32GB+ to stay fast. Needs mflux >= 0.18 for the flux2-klein base model.",
    },
    {
      id: "qwen-image-mflux",
      tier: "xlarge",
      sizeMB: 40000,
      needs: { ramMB: 64000, gpu: true },
      repo: "Qwen/Qwen-Image",
      wordTimestamps: false,
      install: "uv venv ~/.venvs/mflux && VIRTUAL_ENV=~/.venvs/mflux uv pip install mflux",
      invoke:
        "mflux-generate --base-model qwen --steps 20 --prompt {prompt} --width {w} --height {h} --seed {seed} --output {out}",
      notes:
        "Qwen-Image, top-tier quality. Heavy: 'several minutes' even on 128GB M4 Max, 'almost fried' a 32GB M4 Pro. 64GB+ only. Below that, the cloud upsell (codex) is faster and better.",
    },
  ],
};

function tableFor(capability) {
  const t = MODELS[capability];
  if (!t) throw new Error(`unknown local-model capability: ${capability}`);
  return t;
}

/** All local models for a capability. */
export function listModels(capability) {
  return tableFor(capability).slice();
}

/** Does this machine meet a model's needs? Apple Silicon unified memory counts as VRAM. */
export function meetsSpecs(model, specs) {
  const n = model.needs || {};
  // Gate on AVAILABLE RAM when the probe reported it (the real budget with the
  // OS + open apps resident); fall back to total RAM otherwise. Older specs
  // objects (and unit fixtures) that only set ramMB keep working unchanged.
  const budget = specs.availableRamMB ?? specs.ramMB;
  if (n.ramMB && budget < n.ramMB) return false;
  if (n.gpu && !specs.gpu?.present) return false;
  if (n.vramMB) {
    const vram = specs.gpu?.vramMB ?? 0;
    if (vram < n.vramMB) return false;
  }
  return true;
}

// Bigger RAM footprint is the quality proxy inside a capability (a 40GB image
// model out-renders a 12GB one), so "best model the machine can run" == the
// largest-footprint model whose needs still fit the available-RAM budget.
function rankedByFootprint(table) {
  return [...table].sort((a, b) => (b.needs?.ramMB ?? 0) - (a.needs?.ramMB ?? 0));
}

/**
 * Pick the best local model the machine can run for a capability: the
 * highest-footprint model that fits the available-RAM budget (and GPU/VRAM).
 * `preferTier` pins the search to one tier (e.g. force a smaller/faster model).
 * Returns `{ model, tier }`, or `{ recommend: "cli", reason }` when nothing fits.
 */
export function selectModel(capability, specs, { preferTier } = {}) {
  const table = tableFor(capability);
  const pool = preferTier ? table.filter((m) => m.tier === preferTier) : table;
  for (const model of rankedByFootprint(pool)) {
    if (meetsSpecs(model, specs)) return { model, tier: model.tier };
  }
  const smallest = table.reduce((a, b) => (a.sizeMB <= b.sizeMB ? a : b));
  return {
    recommend: "cli",
    reason: `machine does not meet specs for any local ${capability} model (smallest needs ~${smallest.needs.ramMB}MB RAM${smallest.needs.gpu ? " + GPU" : ""}); use the CLI path instead`,
  };
}

/**
 * Agent-facing ladder: every model for a capability, best-first, each flagged
 * with whether it fits this machine and why. Lets the agent see the RAM-graded
 * options and choose (e.g. trade the auto-picked best for a smaller/faster one,
 * or step up to a cloud upsell) rather than only getting one auto-selection.
 */
export function describeModelLadder(capability, specs) {
  const budget = specs.availableRamMB ?? specs.ramMB;
  return rankedByFootprint(tableFor(capability)).map((model) => {
    const fits = meetsSpecs(model, specs);
    return {
      id: model.id,
      tier: model.tier,
      needsRamMB: model.needs?.ramMB ?? 0,
      fits,
      reason: fits
        ? `fits (needs ~${model.needs?.ramMB}MB, ${budget}MB available)`
        : `too big (needs ~${model.needs?.ramMB}MB${model.needs?.gpu ? " + GPU" : ""}, ${budget}MB available)`,
      notes: model.notes,
    };
  });
}
