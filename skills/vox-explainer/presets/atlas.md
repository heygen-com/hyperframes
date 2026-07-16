# Style block — vox atlas (geopolitics grammar; source: Vox Atlas "ME cold war", 2026-07 dissection)

For geopolitics / international / geography topics. Append to every clip prompt (generation routes), then the mute template.

```
Vox Atlas-style map explainer, vertical 9:16 motion graphics.
Desaturated grayscale terrain map as the base layer, dark vignette at edges.
Countries fill with flat muted colors (brick red, sage green, mustard) one at a time
as the story names them; italic serif place labels set directly on the map.
Circular portrait medallions with colored ring borders pinned onto countries,
connected by animated dashed relation lines with small conflict/alliance icons.
A persistent timeline bar along the bottom edge: year ticks, a sliding playhead,
black event chips popping above it. Torn paper strip banners laid diagonally
across the map for event names. Document scan pages with color-highlighted passages.
Camera moves are continuous map zooms and pans between regions - never a hard reset.
No dialogue. No narration. No music. Quiet ambience only.
```

Palette: map grey `#CFC5B0`→`#8f8878` / brick red `#B3402F` / sage `#7C8F6D` / mustard `#C9A227` / chip black `#111` / playhead red `#D2382B`.

HF-native mapping (registry): `vox-timeline-bar` (mount ONCE at composition level, keep resident, advance playhead each beat) · `vox-caption-chip` (.accent) · `vox-tape` (strip banners) · `vox-source-footnote`. Portrait medallions: circular-cropped img + 4px colored ring, pinned with absolute coords; relation lines = SVG dashed paths, draw-on like `vox-thin-arrow`.
Text: place labels italic serif (Georgia stack); event chips ALL-CAPS 2-4 words tied to timeline years.
