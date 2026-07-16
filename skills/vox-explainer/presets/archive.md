# Style block — vox archive (history grammar; source: Vox "WWI facial prosthetics", 2026-07 dissection)

For historical / war / biography topics. Append to every clip prompt (generation routes), then the mute template.

```
Vox-style archival history explainer, vertical 9:16 motion graphics.
Near-black desk surface (#14110E) with heavy vignette; archival photographs as
white-bordered paper cards floating at slightly different angles, slow Ken Burns
push on the focal card. Typewriter small-caps caption chips (black bar, off-white text)
sliding in from frame edges and staying resident in corners.
Numbered process labels for sequences. Full-bleed vintage newspaper pages pushed in
toward the headline. Cream hand-drawn sketch plates (#EFE6CE) with fine line-art.
Film grain and dust over everything; muted sepia tones in photographs.
Transitions: hard cut or card slide only - no dissolves.
No modern elements. No dialogue. No narration. No music. Quiet room-tone ambience only.
```

Palette: near-black `#14110E` / photo sepia+grey / cream plate `#EFE6CE` / chip black `#111` / accent red `#D2382B` (numbered steps only).

HF-native mapping (registry): `vox-caption-chip` (.mono) · `vox-numbered-step` · `vox-source-footnote` (.on-dark) · photo cards = `vox-torn-card` with straight white border variant + Ken Burns transform on inner img (wrapper/child split).
Text: captions are factual register (name, place, year); every archival image gets a source footnote.
