---
name: hyperframes-media
description: Asset preprocessing for HyperFrames compositions — text-to-speech narration (Kokoro for English/Chinese, Supertonic 3 for 31 languages), audio/video transcription (Whisper), and background removal for transparent overlays (u2net). Use when generating voiceover from text, transcribing speech for captions, removing the background from a video or image to use as a transparent overlay, choosing a TTS engine/voice or whisper model, or chaining these (TTS → transcribe → captions). Each command downloads its own model on first run.
---

# HyperFrames Media Preprocessing

Three CLI commands that produce assets for compositions: `tts` (speech), `transcribe` (timestamps), and `remove-background` (transparent video). Each downloads a model on first run and caches it under `~/.cache/hyperframes/`. Drop the output into the project, then reference it from the composition HTML — see the `hyperframes` skill for the audio/video element conventions.

## Text-to-Speech (`tts`)

Generate speech audio locally. No API key. Two engines, selected with `--engine`:

- **`kokoro`** (default) — Kokoro-82M. 54 named voices, content-matched. Best for **English**; the only engine that supports **Chinese**. Non-English needs Python + `espeak-ng` (see Requirements).
- **`supertonic`** — Supertonic 3. Runs fully in-process (no Python, no phonemizer). Covers **31 languages**. Preferred for **any non-English language except Chinese**.

```bash
npx hyperframes tts "Text here" --voice af_nova --output narration.wav
npx hyperframes tts script.txt --voice bf_emma --output narration.wav
npx hyperframes tts --list                                 # Kokoro's 54 voices
npx hyperframes tts --list --engine supertonic             # Supertonic's voices
```

### Choosing an engine (language routing)

| Language                                                         | Engine                  | Why                              |
| ---------------------------------------------------------------- | ----------------------- | -------------------------------- |
| English                                                          | `kokoro` (default)      | Rich, content-matched voices     |
| Chinese / Mandarin                                               | `kokoro` (`zf_xiaobei`) | **Only** Kokoro supports `zh`    |
| Any other language (Korean, German, Russian, Arabic, Dutch, …)   | `supertonic`            | Kokoro can't; no extra deps      |
| Overlap (Spanish, French, Hindi, Italian, Japanese, Portuguese)  | either                  | Supertonic if avoiding espeak-ng |

Rule of thumb: **English or Chinese → Kokoro. Everything else → Supertonic.**

### Voice Selection

Match voice to content. Default is `af_heart`.

| Content type      | Voice                 | Why                           |
| ----------------- | --------------------- | ----------------------------- |
| Product demo      | `af_heart`/`af_nova`  | Warm, professional            |
| Tutorial / how-to | `am_adam`/`bf_emma`   | Neutral, easy to follow       |
| Marketing / promo | `af_sky`/`am_michael` | Energetic or authoritative    |
| Documentation     | `bf_emma`/`bm_george` | Clear British English, formal |
| Casual / social   | `af_heart`/`af_sky`   | Approachable, natural         |

### Multilingual

For non-English (except Chinese), use **Supertonic**. Pass the language with `--lang` and pick a voice (`F1`–`F5`, `M1`–`M5` — multilingual, gender only). No phonemizer or system packages needed.

```bash
npx hyperframes tts "안녕하세요, 만나서 반갑습니다" --engine supertonic --lang ko --voice F1 --output ko.wav
npx hyperframes tts "Guten Tag, schön Sie zu sehen" --engine supertonic --lang de --voice M1 --output de.wav
```

Supertonic `--lang` codes (31): `ar` `bg` `cs` `da` `de` `el` `en` `es` `et` `fi` `fr` `hi` `hr` `hu` `id` `it` `ja` `ko` `lt` `lv` `nl` `pl` `pt` `ro` `ru` `sk` `sl` `sv` `tr` `uk` `vi`. **No Chinese** — use Kokoro for that.

**Kokoro** stays best for English and is the only option for Chinese. Its voice IDs encode language in the first letter: `a`=American English, `b`=British English, `e`=Spanish, `f`=French, `h`=Hindi, `i`=Italian, `j`=Japanese, `p`=Brazilian Portuguese, `z`=Mandarin. The CLI auto-detects the phonemizer locale from the prefix — no `--lang` needed when the voice matches the text.

```bash
npx hyperframes tts "你好，今天天气很好" --voice zf_xiaobei --output zh.wav   # Chinese → Kokoro
npx hyperframes tts "La reunión empieza a las nueve" --voice ef_dora --output es.wav
```

For Kokoro, use `--lang` only to override auto-detection (stylized accents). Valid codes: `en-us`, `en-gb`, `es`, `fr-fr`, `hi`, `it`, `pt-br`, `ja`, `zh`. Kokoro non-English phonemization requires `espeak-ng` system-wide (`brew install espeak-ng` / `apt-get install espeak-ng`) — another reason to prefer Supertonic for those languages.

### Speed

- `0.7-0.8` — tutorial, complex content, accessibility
- `1.0` — natural pace (default)
- `1.1-1.2` — intros, transitions, upbeat content
- `1.5+` — rarely appropriate; test carefully

### Long Scripts

For more than a few paragraphs, write to a `.txt` file and pass the path. Inputs over ~5 minutes of speech may benefit from splitting into segments.

### Requirements

- **Kokoro** (`--engine kokoro`, default): Python 3.8+ with `kokoro-onnx` and `soundfile` (`pip install kokoro-onnx soundfile`); non-English also needs `espeak-ng` system-wide. Model downloads on first use (~311 MB + ~27 MB voices, cached in `~/.cache/hyperframes/tts/`).
- **Supertonic** (`--engine supertonic`): no Python, no system packages — runs in-process via onnxruntime-node. Models (~300 MB) download from Hugging Face on first use, cached in `~/.cache/hyperframes/tts/supertonic/`. Tune quality/speed with `--steps` (default 8; fewer is faster).

## Transcription (`transcribe`)

Produce a normalized `transcript.json` with word-level timestamps.

```bash
npx hyperframes transcribe audio.mp3
npx hyperframes transcribe video.mp4 --model small --language es
npx hyperframes transcribe subtitles.srt          # import existing
npx hyperframes transcribe subtitles.vtt
npx hyperframes transcribe openai-response.json
```

### Language Rule (Non-Negotiable)

**Never use `.en` models unless the user explicitly states the audio is English.** `.en` models (`small.en`, `medium.en`) **translate** non-English audio into English instead of transcribing it. This silently destroys the original language.

1. Language known and non-English → `--model small --language <code>` (no `.en` suffix)
2. Language known and English → `--model small.en`
3. Language unknown → `--model small` (no `.en`, no `--language`) — whisper auto-detects

**Default model is `small`, not `small.en`.**

### Model Sizes

| Model      | Size   | Speed    | When to use                           |
| ---------- | ------ | -------- | ------------------------------------- |
| `tiny`     | 75 MB  | Fastest  | Quick previews, testing pipeline      |
| `base`     | 142 MB | Fast     | Short clips, clear audio              |
| `small`    | 466 MB | Moderate | **Default** — most content            |
| `medium`   | 1.5 GB | Slow     | Important content, noisy audio, music |
| `large-v3` | 3.1 GB | Slowest  | Production quality                    |

Music with vocals: start at `medium` minimum; produced tracks often need manual SRT/VTT import. For caption-quality checks (mandatory after every transcription), the cleaning JS, retry rules, and the OpenAI/Groq API import path, see [hyperframes/references/transcript-guide.md](../hyperframes/references/transcript-guide.md).

### Output Shape

Compositions consume a flat array of word objects. The `id` field (`w0`, `w1`, ...) is added during normalization for stable references in caption overrides; it's optional for backwards compatibility.

```json
[
  { "id": "w0", "text": "Hello", "start": 0.0, "end": 0.5 },
  { "id": "w1", "text": "world.", "start": 0.6, "end": 1.2 }
]
```

## Background Removal (`remove-background`)

Remove the background from a video or image so the subject (typically a person — avatar, presenter, talking head) sits as a transparent overlay in a composition.

```bash
npx hyperframes remove-background subject.mp4 -o transparent.webm  # default: VP9 alpha WebM
npx hyperframes remove-background subject.mp4 -o transparent.mov   # ProRes 4444 (editing)
npx hyperframes remove-background portrait.jpg -o cutout.png       # single-image cutout
npx hyperframes remove-background subject.mp4 -o subject.webm \
  --background-output plate.webm                                   # both layers in one pass
npx hyperframes remove-background subject.mp4 -o transparent.webm --device cpu
npx hyperframes remove-background --info                           # detected providers
```

Uses `u2net_human_seg` (MIT). First run downloads ~168 MB of weights to `~/.cache/hyperframes/background-removal/models/`.

### Layer separation (`--background-output`)

Pass `--background-output` (or `-b`) to emit a **second** transparent video alongside the cutout: same source RGB, alpha is `255 − mask` instead of `mask`. The cutout is the subject with a transparent background; the plate is the original surroundings with a transparent hole where the subject was.

| File                             | Alpha is…                                                 | Use it for                                                      |
| -------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| `-o subject.webm`                | The mask — subject opaque, background transparent         | Foreground layer, place on top                                  |
| `--background-output plate.webm` | Inverse — surroundings opaque, subject region transparent | Bottom layer; put text or graphics between this and the subject |

Both outputs share the same `--quality` preset and run from a single inference pass — encode cost roughly doubles, segmentation cost stays the same. Only valid for video inputs and `.webm`/`.mov` outputs.

**Hole-cut plate, not an inpainted clean plate.** The subject region in `plate.webm` is fully transparent — composite something opaque under it to fill the hole. The single test for whether `--background-output` is the right tool: _will anything ever be visible through the subject's silhouette where the subject used to be?_

| Use case                                                                            | Right tool                                                                         |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Text/graphics between the cutout and the plate (this command's reason for existing) | **Hole-cut** (`--background-output`)                                               |
| Subject onto an unrelated scene                                                     | Just `subject.webm`; ignore the plate                                              |
| Show the room _without_ the person, alone over no other content                     | **Clean plate** — needs an inpainter (LaMa, ProPainter, E2FGVI). Not this command. |
| Replace the subject with a different subject                                        | **Clean plate** — same as above                                                    |

If a user asks for "the room with the person removed" and intends to display it standalone, do **not** reach for `--background-output`. Tell them they need an inpainter.

Typical layered composition (the canonical hole-cut use case):

```html
<!-- z=1 the inverse-alpha plate fills everything except the subject region -->
<video
  src="plate.webm"
  data-start="0"
  data-duration="6"
  data-track-index="0"
  muted
  playsinline
></video>

<!-- z=2 graphics / text live between the two layers -->
<h1 id="headline" style="z-index:2; ...">MAKE IT IN HYPERFRAMES</h1>

<!-- z=3 the cutout floats the subject back over the headline -->
<div class="cutout-wrap" style="position:absolute;inset:0;z-index:3">
  <video
    src="subject.webm"
    data-start="0"
    data-duration="6"
    data-track-index="1"
    muted
    playsinline
  ></video>
</div>
```

This is functionally equivalent to the text-behind-subject pattern below, but you don't need the original `presenter.mp4` in the project — the plate replaces it. Useful when you want to ship just the two transparent layers and let the user drop arbitrary content between them.

### Output Format

| Format                | When                                                          |
| --------------------- | ------------------------------------------------------------- |
| `.webm` (VP9 + alpha) | Default. Compositions play this directly via `<video>`.       |
| `.mov` (ProRes 4444)  | Editing in DaVinci/Premiere/FCP. Large files.                 |
| `.png`                | Single-image cutout (still subject, layered over a backdrop). |

Chrome decodes VP9 alpha natively, so the `.webm` plugs into a composition like any other muted-autoplay video — see the `hyperframes` skill for the `<video>` track conventions.

### Quality presets

`--quality fast|balanced|best` controls only the VP9 encoder's CRF — segmentation quality is fixed.

| Preset     | CRF | When                                                  |
| ---------- | --- | ----------------------------------------------------- |
| `fast`     | 30  | Iterating, smaller file, looser color match           |
| `balanced` | 18  | Default. Visually identical for most uses             |
| `best`     | 12  | Master / final delivery. Largest file, tightest match |

### Compositing patterns — pick the right one

The cutout webm is a **re-encoded copy** of the source mp4's RGB. That choice has consequences depending on what you put behind it:

| Pattern                                                  | What's behind the cutout                   | Result                                                                                                                                                                                                                            |
| -------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cutout over a different scene** (most common)          | Static image, gradient, or unrelated video | Looks great. The cutout's RGB is the only source of the subject — no doubling, no edge halo. This is what `remove-background` is built for.                                                                                       |
| **Cutout over its own source mp4** (text-behind-subject) | Same mp4 the cutout was generated from     | Two RGB sources for the same person. At default `--quality balanced` (crf 18) the doubling is barely visible; at `--quality fast` (crf 30) you'll see a faint color shift / edge halo. Use `--quality best` (crf 12) for masters. |
| **Cutout over a _different_ take of the same person**    | Footage of the same subject                | Will look like two separate people overlapping. Don't do this.                                                                                                                                                                    |

**Text-behind-subject** (headline behind a presenter):

```html
<video
  src="presenter.mp4"
  id="bg"
  data-start="0"
  data-duration="6"
  data-track-index="0"
  muted
  playsinline
></video>
<h1 id="headline" style="z-index:2; ...">MAKE IT IN HYPERFRAMES</h1>
<div class="cutout-wrap" style="position:absolute;inset:0;z-index:3;opacity:0">
  <video
    src="presenter.webm"
    data-start="0"
    data-duration="6"
    data-track-index="1"
    muted
    playsinline
  ></video>
</div>
```

Two key rules:

1. **Wrap the cutout video in a non-timed `<div>`** and animate the wrapper's opacity, not the video element's. The framework forces opacity:1 on active clips (any element with `data-start`/`data-duration`), so animating the video's opacity directly is silently overridden. The wrapper has no `data-*` attributes, so it's owned by your CSS/GSAP.
2. **Both videos use `data-start="0"` and `data-media-start="0"`** so the framework decodes them in sync from t=0. Late-mounting the cutout (`data-start=3.3`) introduces a seek + warm-up that lands a frame off the base mp4 — visible as one frame of misalignment at the cut.

Then GSAP-flip the wrapper opacity at the cut: `tl.set(cutoutWrap, { opacity: 1 }, 3.3)`.

## TTS → Transcribe → Captions

When there's no pre-recorded voiceover, generate one and transcribe it back to get word-level timestamps for captions:

```bash
npx hyperframes tts script.txt --voice af_heart --output narration.wav
npx hyperframes transcribe narration.wav   # → transcript.json
```

Whisper extracts precise word boundaries from the generated audio, so caption timing matches delivery without hand-tuning.
