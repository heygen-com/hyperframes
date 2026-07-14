# Media operations: agent guidance

media-use resolves and remembers assets. For **operating** on them: cutting,
reframing, stitching, transforming, it does not wrap every action as a bespoke
command. Instead it points you at the right local tool (decision OP1). Run the
tool, then register the output with `resolve --from <output> --type <type>` so the
result lands in the ledger and the global cache like any other asset.

All tools below are local and free. ffmpeg is assumed present (it backs the
engine already).

## Cut / trim: keep a slice

```bash
ffmpeg -i in.mp4 -ss 00:00:12 -to 00:00:20 -c copy out.mp4   # 0:12–0:20, no re-encode
```

In-composition trimming usually needs **no new file**: a clip plays a sub-window
via `data-media-start` + `data-duration` (see hyperframes-core). Only cut a
physical file when exporting/assembling outside the composition.

## Reframe / crop: change aspect ratio

```bash
# 16:9 -> 9:16, crop centered
ffmpeg -i in.mp4 -vf "crop=ih*9/16:ih,scale=1080:1920" out.mp4
```

For a non-destructive crop, set a `clip-path` on the element in the composition
itself (render-time, source file untouched) instead of re-encoding with ffmpeg.

## Montage / stitch: join clips

```bash
printf "file '%s'\n" a.mp4 b.mp4 c.mp4 > list.txt
ffmpeg -f concat -safe 0 -i list.txt -c copy out.mp4
```

## Silence-cut / highlight: trim dead air, grab the best moment

```bash
auto-editor in.mp4 --edit audio:threshold=4% -o tight.mp4   # pip install auto-editor
scenedetect -i in.mp4 detect-adaptive list-scenes           # pip install scenedetect
```

## Transforms with a quality choice (process)

These have a local option AND a higher-quality HeyGen-CLI option. Run the local
one for free/offline; use the HeyGen CLI when quality matters. Showing the user
a **side-by-side** (local vs HeyGen) is the honest way to let them choose.

| Op                 | Local (free)                                       | HeyGen CLI (quality)        |
| ------------------ | -------------------------------------------------- | --------------------------- |
| Background removal | `hyperframes remove-background in.png` (u2net)     | `heygen background-removal` |
| Upscale            | `realesrgan-ncnn-vulkan -i in.png -o out.png -s 4` | n/a                         |
| Lipsync (dub)      | n/a                                                | `heygen lipsync`            |
| Translate          | n/a                                                | `heygen video-translate`    |

After any op: `resolve --from out.ext --type <type>` to register the derived
asset (it records provenance and auto-promotes to the global cache).

> ponytail: media-use doesn't re-wrap ffmpeg/heygen here, that's deliberate
> (OP1). The value it adds is the ledger + global reuse on the _output_, via
> `--from`. Add a thin `process` verb only if agents repeatedly fumble these
> recipes.

## Transcription (default: Parakeet, better than whisper.cpp)

`transcribe.mjs` is the default local transcription path. It runs **NVIDIA
Parakeet-TDT via parakeet-mlx**, which beats whisper.cpp on the Open ASR
Leaderboard (avg WER ~6.05% vs 7.44%; on NOISY audio 4.73% vs 5.96%, where
whisper-large-v3 hallucinated to 308% WER on meetings) and is 5-10x faster.
It emits `{ text, words:[{text,start,end}] }` with word timestamps (merged from
Parakeet's sub-word tokens), feeding transcript-cut, captions, and the audio
engine directly.

```bash
# install once: uv venv ~/.venvs/parakeet && VIRTUAL_ENV=~/.venvs/parakeet uv pip install parakeet-mlx
node <SKILL_DIR>/scripts/transcribe.mjs --input talk.mp4 --out talk.transcribe.json

# equivalently, the hyperframes CLI has Parakeet built in (auto-detects it, whisper fallback):
npx hyperframes transcribe talk.mp4 --engine parakeet   # or --engine auto (default)
```

VERIFIED on 24GB: accurate, ~3s (cached) for 8s audio. Parakeet covers English +
25 European languages. For other languages, or when parakeet-mlx is not
installed, transcribe.mjs auto-falls-back to whisper.cpp (99 languages) via
`hyperframes transcribe`. `--engine parakeet|whisper` forces one. (Cohere
Transcribe tops the leaderboard on paper but its mlx-audio quants produced
garbage and ran 40-70x slower on a Mac in testing, so it is not wired in.)

## Text-based editing (transcript cut)

`transcript-cut.mjs` is a compiler, not a wrapper: it turns word timestamps and
agent cut decisions into exact kept segments. It is provided even though the rest
of this file is guidance-only.

```bash
node <SKILL_DIR>/scripts/transcript-cut.mjs \
  --input talk.mp4 \
  --transcript talk.transcribe.json \
  --remove "12.41-15.02,88.3-91.7" \
  --remove-fillers "um,uh,like" \
  --cut-silence 0.8 \
  --out talk.cut.mp4

resolve --from talk.cut.mp4 --type video
```

Use `--plan` first when you want to inspect the kept segment JSON before encoding.

## Ducking (declare in-composition / bake for export)

B1, declare ducking in the composition. `audio-duck.mjs` emits GSAP volume
keyframes. Paste them into the composition timeline, the source file stays
untouched.

```bash
node <SKILL_DIR>/scripts/audio-duck.mjs \
  --meta audio_meta.json \
  --target "#bgm" \
  --composition index.html
```

```js
// auto-duck: #bgm under narration (generated; base volume 0.6)
tl.to("#bgm", { volume: 0.15, duration: 0.15 }, 3.42);
tl.to("#bgm", { volume: 0.6, duration: 0.4 }, 9.87);
```

B2, bake ducking only for exported or standalone files.

```bash
ffmpeg -i bgm.mp3 -i voice.wav \
  -filter_complex "[0][1]sidechaincompress=threshold=0.03:ratio=8:attack=200:release=400[ducked]" \
  -map "[ducked]" bgm.ducked.wav
```

Declare inside compositions. Bake only for assets leaving the hyperframes
pipeline.

## Publish loudness

Two-pass `loudnorm` measures first, then applies the measured values with the
target LUFS baked in.

Socials target, -14 LUFS:

```bash
ffmpeg -i mix.wav \
  -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json \
  -f null -

ffmpeg -i mix.wav \
  -af loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=<input_i>:measured_TP=<input_tp>:measured_LRA=<input_lra>:measured_thresh=<input_thresh>:offset=<target_offset>:linear=true:print_format=summary \
  mix.social.wav
```

Podcast target, -16 LUFS:

```bash
ffmpeg -i mix.wav \
  -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json \
  -f null -

ffmpeg -i mix.wav \
  -af loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=<input_i>:measured_TP=<input_tp>:measured_LRA=<input_lra>:measured_thresh=<input_thresh>:offset=<target_offset>:linear=true:print_format=summary \
  mix.podcast.wav
```

## Generate: images (local first, cloud upsell)

`resolve --type image` retrieves from the HeyGen catalog first; on a miss it
GENERATES. Two paths, best-for-the-machine picked automatically:

1. **Local (default, free, private): mflux** (FLUX-on-MLX). `resolve` spec-checks
   AVAILABLE RAM and runs the best FLUX-class model that fits, via
   `scripts/lib/local-models.mjs` (`imagegen` ladder) + `mflux-provider.mjs`.
   The RAM ladder (agent sees it via `describeModelLadder("imagegen", specs)`):

   | Tier   | Model                | Needs (available RAM) | Notes                               |
   | ------ | -------------------- | --------------------- | ----------------------------------- |
   | medium | FLUX.1 schnell int4  | ~8GB (`--low-ram`)    | ~20s/512px on 24GB. VERIFIED. Fast. |
   | large  | FLUX.2 Klein 4B int4 | ~32GB                 | higher quality, full-resident       |
   | xlarge | Qwen-Image           | ~64GB                 | top quality, 64GB+ Macs only        |

   Gotchas baked into the table: the official FLUX repos are HF-gated, so it
   points at non-gated community 4-bit re-uploads; and `--low-ram` is MANDATORY
   at the medium tier (without it a 768x512 run swap-thrashed to 90 minutes on
   24GB; with it, 20 seconds).

2. **Cloud upsell (better quality): the `codex` CLI** `image_gen` tool, on the
   user's ChatGPT subscription (codex owns auth, no key here, no per-call
   charge). It is the automatic fallback when no local model fits AND the
   explicit "make it better" choice on any machine. Users who just want codex
   can ask for it directly. Verified: prompt -> raster -> frozen + ledgered.

`--local-only` keeps mflux (once cached) and skips codex (network).

## Generate: video (local first, HeyGen avatar upsell)

Operate-on-video ships now; GENERATING video is local-first with a HeyGen
avatar upsell (decision X3).

- **Local (default): LTX 2.3 on MLX** via `dgrauet/ltx-2-mlx`, the `videogen`
  ladder in `local-models.mjs`. Generative clips (t2v / i2v), spec-gated to RAM.
  Verified on 24GB: 512x320 x 33f with audio.
- **HeyGen avatar upsell (better, script-driven): the `heygen` CLI**, NOT the
  raw API. For a talking-head / avatar video, `heygen video create` (avatar
  engine IV by default) beats a generative clip when you want a real presenter.
  Browser OAuth uses the web-plan/free avatar-video allowance where eligible;
  API keys follow the normal API billing path. Always pass
  `--headers "X-HeyGen-Client-Source: media-use"` on any generating `heygen`
  command (`video create`, `avatar create`, `video-translate`) — it's the
  allowlisted attribution header (persistent flag, works on every subcommand) that
  tags the usage as media-use in billing/resource meta so it shows up in the API
  dashboards. Read-only discovery (`avatar list`, `voice list`) doesn't need it.

  ```bash
  # discover an avatar + a starfish voice, then create + wait
  heygen avatar list --ownership public --limit 5
  heygen voice list --engine starfish --limit 5
  heygen video create --headers "X-HeyGen-Client-Source: media-use" --wait -d '{
    "type": "avatar",
    "avatar_id": "<avatar-id>",
    "script": "Your narration here.",
    "voice_id": "<voice-id>"
  }'
  ```

  Avatar videos are deterministic + script-driven (lip-sync from a script or a
  pre-recorded `audio_url`), distinct from the generative LTX clips. After it
  renders, `resolve --from <downloaded.mp4> --type video` to ledger it.

### Image-to-video (animate any still into a talking clip)

`heygen video create` takes the raw `POST /v3/videos` body, so switching `type`
from `avatar` to `image` animates **any image of a person** into a lip-synced
talking video, with no avatar/photo-avatar creation step first. Point `image` at a
public URL or an uploaded `asset_id`, and drive speech with a `script`+`voice_id`
or a pre-recorded `audio_url`:

```bash
heygen video create --headers "X-HeyGen-Client-Source: media-use" --wait -d '{
  "type": "image",
  "image": { "type": "url", "url": "https://example.com/person.jpg" },
  "script": "Your narration here.",
  "voice_id": "<voice-id>"
}'
```

Common optional fields: `title`, `resolution` (`4k`/`1080p`/`720p`),
`aspect_ratio`, `remove_background`, `background`, `voice_settings`,
`motion_prompt` + `expressiveness` (photo-avatar animation), and
`callback_url`/`callback_id` for webhooks. Don't hardcode these from memory: the
CLI self-documents the full, current body with
`heygen video create --request-schema` (a discriminated union keyed on `type`),
so read the schema rather than trusting a stale field list. For a still you'll
reuse across many scripts, create a reusable **Photo Avatar** once instead
(`heygen avatar create`). Ledger the result with
`resolve --from <downloaded.mp4> --type video`. Docs:
<https://developers.heygen.com/image-to-video>.
