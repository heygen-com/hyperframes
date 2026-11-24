# Transcribe

Word-level timestamps for captions, or an import of an existing transcript.

## Run it

- `hyperframes transcribe audio.mp3 --model small.en` — known English
- `hyperframes transcribe video.mp4 --model small --language es` — known non-English; no `.en` model
- `hyperframes transcribe subtitles.srt` — import an SRT, a VTT or an OpenAI Whisper JSON response
- `hyperframes transcribe transcript.json --to srt` — export captions; `--to vtt` for VTT, `--output` for the path
- `--json` prints the result as JSON and sends progress lines to stderr

## Pick the model

- Always pass `--model`. The default `small.en` translates non-English audio into English.
- `.en` models (`tiny.en`, `base.en`, `small.en`, `medium.en`) are English only. Use `small`, `medium` or `large-v3` with `--language` for anything else.
- Speech over music: start with `medium.en`.

## Pick the engine

- `--engine auto` (default) uses Parakeet when it is installed and covers `--language`, otherwise whisper
- `--engine whisper` or `--engine parakeet` force one; install Parakeet with `hyperframes models install parakeet`
- `--engine heygen` uses HeyGen's speech model; it needs an API key and is charged to API credits. `--speakers` labels each word with its speaker
- `--no-runtime-install` refuses to install the whisper runtime; `--optional` exits 0 when whisper is unavailable
- `--timeout <ms>` raises the whisper time limit on slow machines (minimum 5000)

Run `hyperframes transcribe --help` for every flag.
