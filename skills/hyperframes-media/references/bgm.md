# Background music (BGM)

One music bed per composition, produced by the shared audio engine (`scripts/audio.mjs` → `scripts/lib/bgm.mjs`). Two routes, chosen by the engine's one switch — whether a HeyGen credential is present:

- **HeyGen retrieval — the default when credentialed.** Search HeyGen's music catalog by mood, download the top track. No generation; same `~/.heygen` / `$HEYGEN_API_KEY` credential as TTS.
- **Local generation (Lyria → MusicGen) — the automatic fallback when there is no credential** (or when asked for explicitly). Generate a WAV from a mood prompt. There is **no `npx hyperframes bgm` command**; the engine spawns `scripts/lyria-recipe.py` or an inline MusicGen script directly.

## Driving it from the request

`audio_request.json` → `bgm: { mode?, query?, prompt? }`:

- **`mode`** — `retrieve | generate | none`. Omit for **auto** (retrieve when credentialed, else generate). An **explicit** `retrieve` is strict: no credential ⇒ skip, never a detached generate (so a caller with no `wait-bgm` step, e.g. product-launch, can't get a pending job it won't await).
- **`query`** — the mood, used for retrieval and as a fallback prompt seed (e.g. a storyboard's `music:` field, falling back to `message` → `arc` → `"calm cinematic underscore"`).
- **`prompt`** — an explicit full prompt for generation; omit and the engine infers one (see Mood inference). Optional `blob` / `archetype` / `arc` feed that inference.

## HeyGen retrieval (default)

`searchSounds(query, "music", { limit: 5 })` → `GET /audio/sounds?query=<mood>&type=music&limit=5`. Take the top result (ranked by `score`), download its presigned `audio_url` → `assets/bgm/track.mp3`. Synchronous. No match → skip (BGM is optional; never fail the render over it). Cue written to `audio_meta.json`:

```jsonc
{
  "path": "assets/bgm/track.mp3",
  "volume": 0.8,
  "mode": "retrieve",
  "query": "calm cinematic underscore",
  "duration_s": 42.0,
}
```

`volume` is 0.8 under narration, 0.9 for a silent film (no voice). `bgm_pending` is `false` — the file is on disk when the engine returns.

## Local generation (fallback) — Lyria → MusicGen

Spawned **detached** so voice work isn't blocked; `audio_meta.bgm_pending: true` and `bgm_pid` / `bgm_log` are set until it finishes. **Run `scripts/wait-bgm.mjs` before assembling** — it polls the output file / process / log, detects crashes, and writes `bgm_status.json` (`status: ready | failed | timeout | disabled`). A failed/absent track is simply omitted; it never blocks voice/SFX.

| Order | Provider                             | Env / deps                                                                            | Speed                                   | Quality                     |
| ----- | ------------------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------- |
| 1     | Google Lyria RealTime                | `$GEMINI_API_KEY` or `$GOOGLE_API_KEY` + `google-genai` (auto-installed on demand)    | Real-time stream (≈ requested duration) | Production-grade            |
| 2     | MusicGen (`facebook/musicgen-small`) | Python `transformers + torch + soundfile + numpy` (~300 MB first run; auto-installed) | Slow on CPU; fast on Apple MPS / CUDA   | Decent; prompt-only control |

Output → `assets/bgm/track.wav`, target = total voice duration. MusicGen generates **one** seed clip (≤28–30s, under the decoder's positional limit) then crossfade-loops it up to the target (or trims down if shorter), avoiding per-segment seams. Backend selection is by what can actually **run**: Lyria only when `import google.genai` succeeds, else MusicGen; if neither can be made to run, BGM is skipped (voice + SFX still render).

## Mood inference (the generate prompt)

`inferBgmPrompt()` in `scripts/lib/bgm.mjs`: an explicit `prompt` wins; otherwise industry-keyword **base** → narrative-**archetype** shape → emotional-**arc** tiebreaker.

| Match in `blob` / `query`                              | Base prompt                                                                 | BPM |
| ------------------------------------------------------ | --------------------------------------------------------------------------- | --- |
| `crypto / nft / web3 / defi / token / blockchain`      | atmospheric electronic, deep bass, futuristic synths, restrained percussion | 100 |
| `finance / fintech / bank / payment / invest / wealth` | calm cinematic, soft strings, subtle piano, restrained percussion           | 92  |
| `creative / agency / design / studio / art / brand`    | playful electronic, warm pads, light percussion                             | 115 |
| _(default: SaaS / tech / platform)_                    | uplifting corporate tech, bright modern piano with synth pads               | 108 |

Archetype then reshapes the arc — PAS → "MINOR to MAJOR" build; BAB / future-pacing → aspirational rising; feature-cascade → +10 BPM driving; demo-loop → −8 BPM minimal. The emotional arc breaks remaining ties (tension→relief, excitement, trust/reassurance).

## Lyria knobs (direct recipe use)

The engine bakes BPM / scale into the **prompt text** (via the inference above) and passes only `--output` / `--duration` / `--prompt` to the recipe. If you invoke `scripts/lyria-recipe.py` directly you can also set: `--bpm` (90–110 calm, 110–130 energetic), `--brightness` (0–1, ≥0.7 promotional), `--density` (0–1, higher = fuller), `--scale` (`MAJOR` / `MINOR` / `PENTATONIC` / …), `--negative-prompt` (styles to exclude). MusicGen ignores all of these — put the mood in the prompt.

## Failure modes

| Failure                                       | Behavior                                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| No music match (retrieve)                     | `bgm: null`, anomaly logged. Render proceeds without BGM.                                |
| Explicit `retrieve`, no credential            | Skipped (no silent generate fallback). Use `mode: generate` or omit `mode` for auto.     |
| Neither Lyria nor MusicGen can run (generate) | `bgm` disabled with a `pip install …` hint. Voice + SFX still render.                    |
| Generate still rendering at assemble time     | `bgm_pending: true`; `wait-bgm.mjs` waits/checks and writes `bgm_status.json` first.     |
| Generate crashed                              | `wait-bgm.mjs` → `bgm_status.json { status: "failed" }`; the `<audio>` track is omitted. |

BGM failure never blocks a render.
