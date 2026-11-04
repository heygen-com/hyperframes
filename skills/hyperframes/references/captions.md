# Captions

## Words and timings

- `npx hyperframes transcribe <file> --json` and a HeyGen voiceover (`/media-use`) give every word's start and end. Work from those as `[{ "id": "w0", "text": "Hello", "start": 0.0, "end": 0.5 }, …]`.
- `npx hyperframes transcribe` defaults to the `small.en` whisper model, which **translates** non-English speech into English. Pass the model: `npx hyperframes transcribe <file> --model small.en` for English, `--model small --language <code>` otherwise, `--model medium.en` for speech over music. It writes `assets/transcript.json` (its JSON names the path) and overwrites it on the next run; `--to srt` or `--to vtt` writes a sidecar.
- For Chinese, Japanese and other unspaced scripts, local transcription returns a whole sentence as one "word", sometimes in the other script (Traditional for Simplified speech). Split each segment's text into short phrases and spread its time across them by character count; check the characters against what is said.
- Whisper invents "Thank you." over silence and repeats lines over a silent tail: drop words that start inside a final silence (`silencedetect=noise=-35dB:d=0.6`; real speech sits around −16 to −26 dB).
- Never put two words in one timed entry, and match transcript words to caption words by position, not text, or a repeated word takes the wrong time.
- Read the transcript before using it. More than 20% `♪` or `�` tokens, or nonsense words, means it failed: retry with a larger model, or take lyrics from the person. Drop non-word tokens before building groups.

## Structure

- One sub-composition host with `data-track-kind="captions"` holds every caption group, so Studio shows them on one captions track.
- Ready-made styles: `npx hyperframes catalog --tag caption-style --json`. An installed one is source you can restyle.

## Groups

- 2–3 words for high energy, 3–5 conversational, 4–6 calm. Break at a sentence end, a pause of 150 ms or more, or the word limit.
- One group visible at a time. A group opens at or before its first word's start and closes at or after its last word's end. A caption at exactly 0 s looks pre-existing: start 0.1–0.3 s in.
- Every group ends with a hard kill after its exit, or a stale group can stay on screen:

```js
tl.to(group, { opacity: 0, duration: 0.12, ease: "power2.in" }, end - 0.12);
tl.set(group, { opacity: 0, visibility: "hidden" }, end);
```

`tl.set` is an instant flip, so setting `visibility` on the group is fine; never tween it on a `.clip`.

## Fit and place

- Size each group to fit: `window.__hyperframes.fitTextFontSize(text, { fontFamily, fontWeight, maxWidth })` returns `{ fontSize }`. Defaults: `maxWidth` 1600 landscape, 900 portrait; base 78, minimum 42, step 2. When a word scales up for emphasis, divide `maxWidth` by that scale.
- A full-width absolute container, centred with text alignment. Never `left: 50%; transform: translateX(-50%)`, which clips at the frame edges.
- `overflow: visible`, not `hidden`, which cuts off scaled words and glows.
- Landscape: 80–120 px from the bottom. Portrait: about 600–700 px from the bottom. Never over the speaker's face; inside the 80% title-safe box.
- Position each group absolutely. In a flex column a group hidden with `visibility: hidden` still takes space, so the next one lands lower. In a stack that accumulates, groups in one block share one exit time, or the stack reflows.
- Fade the group or its words, not both: the opacities multiply and read as a pop. A gradient or `background-clip: text` fill goes on the inner text span, not the transformed container.
- Over footage, choose the blend by the brightness (0–255) behind the text: under 60 `screen`, 60–180 `overlay`, over 180 `normal` with opaque colour. Plain subtitles above brightness 60 get a scrim sized to the text (30–40%), never a full-width bar.
- Footage may already carry burned-in subtitles only mid-clip: scan a 1 fps contact sheet before placing captions.

## Text behind the speaker

- Stack the video, then the captions, then a cutout of the person from `npx hyperframes remove-background` (`/media-use`), ordered by `z-index`. Shake or punch in the video and the cutout together in one wrapper.
- `check` treats a `<video>` as opaque across its whole box, so a WebM cutout fails every caption behind it with `text_occluded`: put `data-layout-allow-occlusion` on the cutout and judge from `snapshot`.
- A big word behind the head reads best 30–55% covered: under about 15% it floats, over about 65% it is eaten. Re-lay out when a content word is 80% covered, or two adjacent words 50% each. Measure the rendered word boxes against the matte over each caption's own time window (heads move: one clip went from y=224 to y=96 in 8 s); estimates from character widths were wrong both ways.
- The matte model drops mic arms, lets large rigs near the body leak in, and flickers on held objects. Its first run downloads 168 MB, and it runs at about 2 fps at 1080p on CPU.
