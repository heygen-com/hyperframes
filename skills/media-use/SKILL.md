---
name: media-use
description: Get or make any media for a HyperFrames video - music, sound effects, images, icons, logos, voiceover, avatar and generated video, transcripts, cutouts, colour grades and looks - with HeyGen or free local tools, and mix placed audio. Also for footage that looks dark, flat or dull, or should be stylized or hidden.
---

**Plugin installs:** Before setup or freshness commands, follow [plugin execution rules](../hyperframes/references/plugin-installation.md) when this skill is inside a HyperFrames plugin.

# Media in HyperFrames

Media lands as a local file in the project's `assets/` with a ledger record; renders never fetch. One verb finds or makes it:

```bash
npx hyperframes media-use resolve --type <type> --intent "<what you need>" --project <dir>
```

It prints one line, `resolved <id> → <path> (<type>, <metadata>)`. List reusable assets first with `--candidates` and judge the fit yourself; reuse, ingest (`--from`) and adopt are in `references/resolve.md`.

## Two ways to get it

| Need | HeyGen (best quality) | Free, no account |
| --- | --- | --- |
| Music (`bgm`) | Catalog of 10k+ tracks | Local MusicGen (`audio/references/bgm.md`) |
| Sound effects (`sfx`) | | Openverse; 21 bundled offline |
| Images, icons | Asset search, 75k+ | Local FLUX (mflux), if installed |
| Logos (`logo`) | | theSVG, GitHub avatar, favicon; never redrawn |
| Voiceover (`voice`) | HeyGen voices, voice cloning | `npx hyperframes tts` (Kokoro on device; Python 3.10+ with `pip install kokoro-onnx soundfile`) |
| A presenter speaking | Avatar video (`--type video`) | Local LTX for generic clips, if installed |
| Transcripts | | `npx hyperframes transcribe` (Parakeet or whisper) |
| Cutouts | `heygen background-removal` | `npx hyperframes remove-background` |
| Grades, LUTs, looks | | `npx hyperframes media-treatment` |

**Host apps.** Inside an app that gives you its own media tools, use those first. When `HEYGEN_API_BASE` is set, the host pays for HeyGen: don't ask for the `heygen` CLI or a sign-in, and when a call is refused, relay the host's message as written and stop.

**HeyGen.** Install the [`heygen` CLI](https://developers.heygen.com/cli) and sign in with `heygen auth login --oauth`: the OAuth session carries a free allowance on subscription credits; an API key (`--api-key`) bills API credits. Check setup with `npx hyperframes media-use resolve --doctor`. When a request needs HeyGen (a presenter or avatar, a HeyGen voice, catalog music) and `heygen` is missing or signed out, tell the person how to get it: the install link, `heygen auth login --oauth` for the free allowance, or an API key for credits. Then offer the free path or wait. Beyond `resolve`, the same CLI makes text-to-video (`heygen video-agent create`), avatar videos with a recorded track (`heygen video create`), cloned voices (`heygen voice clone create`), dubbing (`heygen lipsync`), translated videos (`heygen video-translate`) and short clips from a long video (`heygen ai-clipping`): recipes in `references/operations.md`.

**Free.** Every tool in the free column needs no account; local models are opt-in installs (`references/setup-providers.md`). Without `heygen`, `resolve` for music, images and icons fails and says so; credit CC BY sounds (`audio/references/sfx.md`). `--local-only` skips every network provider.

**Cost.** Confirm before a paid call you chose to make (an avatar video counts); one the person asked for just runs. `--provider <name>` pins one generator when the person names it.

## Looks on real footage

Feedback that footage is dark, flat or dull, should feel retro or printed, needs a face hidden, or needs a reveal is media intent: read `references/media-treatments.md`. Inspect the real `<img>`/`<video>`, pick one intent, start from `npx hyperframes media-treatment --capabilities --json`, then `--capability <id>`; never `--all`. Persist the final treatment with `npx hyperframes media-treatment`; no CSS or SVG stand-ins for supported effects, and no generated `.cube` just to encode exposure or warmth.

## Offer once, never add silently

When you build or review a piece, scan once for concrete gaps (on-screen text with no voiceover, emoji standing in for icons, placeholder images, silent cuts, 10 s+ with no music, a colour cast) and offer the specific fixes in one ask. No signal, no suggestion; respect "leave it".

## Where to look

| Task | Read |
| --- | --- |
| Resolve, reuse, adopt, ingest, flags | `references/resolve.md` |
| Grading, LUTs, `grade-compare` | `references/grading.md` |
| Voiceover, music, sound effects, captions, transcription | `references/audio.md` |
| Cut, reframe or transform media; HeyGen recipes | `references/operations.md` |
| Treatments, realtime effects, overlays, reveals | `references/media-treatments.md` |
| Install, sign-in, providers, RAM ladders | `references/setup-providers.md` |
| Fades, gain, ducking, automation, effects, buses on placed tracks | `references/mixing.md` |
| Local commands: grade, cutout, loudness, beats | `references/local.md` |
| Remembered preferences | `references/memory.md` |
