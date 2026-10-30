# Local media commands

These run on this machine, free, and write into the project.

## Grade and style footage and images

- Measure, then correct: `npx hyperframes media-treatment --selector '#hero' --analyze --json`, then `--grading '<json>' --apply`. `--dry-run` previews; `--clear` removes the treatment.
- On Windows PowerShell, inline JSON loses its quotes: write the JSON to a file and pass its path, `--grading grading.json`, or pipe it with `--grading -`. The same goes for `--variables` and `--vars`.
- `--file` defaults to `index.html`: for media inside a scene, pass `--file compositions/<scene>.html`.
- Grain, blur, vignette, presets, palettes: `npx hyperframes media-treatment --capabilities --json`, then `--capability <id>` for one family's controls and ranges.
- The result is a `data-color-grading` attribute on the media element. It treats the whole element in SDR, so it can't blur one region such as a face.
- To animate it, set the start value in the element's inline `style` and tween these custom properties with finite `tl.to()` on the composition's timeline: `--hf-color-grading-` followed by `intensity`, `lut-intensity`, `blur`, `kuwahara`, `pixelate`, `ascii` or `dither` (each 0–1), `exposure` (−2 to 2) or `bloom` (0–3).
- Compare candidate grades on one frame: `npx hyperframes grade-compare --for frame.png --grades grades.json --json`, or `--luts a.cube,b.cube`.

## Cutouts

- `npx hyperframes remove-background <in> -o cutout.webm` (`.png` for an image; `--quality best` for a closer colour match over its source). `--background-output plate.webm` also writes the background with the subject cut out.
- A cutout over its own source: both clips `data-start="0"` and `data-media-start="0"`, so they decode in sync.
- The runtime forces `opacity: 1` on a timed clip. To fade a cutout, wrap it in an untimed `<div>` and animate the wrapper.

## Sound

- Match loudness: `npx hyperframes normalize-audio --reference <id> --target <id> --write`, or `--lufs=-16` (the default target; write a negative value with `=`) without a reference. `--write` edits the volume in the HTML.
- Beat grid: `npx hyperframes beats --json` reads the local music `<audio>` (marked `data-timeline-role="music"`, or an id containing music, bgm or soundtrack) and writes `beats/<path>.json`, which Studio shows as its beat grid. A beat time minus a scene's `data-start` is its time inside that scene.
- Local transcription, or importing `.srt`, `.vtt` or Whisper JSON: `npx hyperframes transcribe <file> --json`. The default model translates non-English speech: see `../../hyperframes/references/captions.md`.
