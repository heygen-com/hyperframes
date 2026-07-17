# Style block — vox dark-data (data/investigation grammar; source: Vox "emoji ads", 2026-07 dissection)

For data-driven / finance / investigation topics. Append to every clip prompt (generation routes), then the mute template.

```
Vox-style dark data-journalism explainer, vertical 9:16 motion graphics.
Charcoal page with subtle print grain and heavy vignette.
One chart per page: single-color line chart with axis labels and an event callout chip
pinned to the inflection point, or a two-color pie with one large percentage figure.
Social-media post cards recreated as flat white UI cards, slightly rotated, stackable.
Yellow marker-highlighted key words sweeping on word by word.
Black human silhouettes against single-color environment shapes for scene metaphors.
Faint grids of small numbers as background texture, never readable.
Transitions: hard cut only - no dissolves.
No humans with visible faces. No dialogue. No narration. No music. Quiet ambience only.
```

Palette: charcoal `#1E1B18` / off-white `#f4f1e8` / marker yellow `#FFD21E` / signal red `#D2382B` / one cool accent (teal or faded navy).

HF-native mapping (registry): `vox-annotated-line-chart` (event callout pinned to the inflection) · `vox-pie-callout` (hero wedge + count-up figure) · `vox-highlight-row-table` (.on-dark) · `vox-highlighter-word` · `vox-caption-chip` (.accent for events) · `vox-source-footnote` (.on-dark). Charts sit at z-index behind the host in avatar pieces.
Text: numbers get the large treatment (one hero figure per page); sourcing mandatory on every chart (`vox-source-footnote`).
