---
workflow: product-launch-video
flow: automation
storyboard: no
message: "example.com is the domain you are allowed to use in documentation examples."
audience: "Someone meeting the domain for the first time — usually a developer writing docs."
destination: "Docs page hero — embedded, 16:9"
aspect: "16:9"
format: 1920x1080
length: "10s"
language: en
angle: "Show it as it is. The real captured page is the proof; the copy is the page's own language."
voice: "River (ElevenLabs, SAz9YHcvj6GT2YYXdXww) — calm, unhurried, low-key confidence"
music: "gentle warm piano bed, quiet under the narration"
captions: "phrase-level, fixed lower band, one group at a time"
style_preset: "derived from the live capture (no preset remix — the site's own three tokens are the palette)"
---

# Brief — a 10-second product intro for example.com

## Intent

One request: _Using `/hyperframes`, make a 10-second product intro for
`https://example.com`._

The intent layer confirmed source, length and aspect, then asked the only thing the
request did not settle — **sell it, or show it as it is.** Answer: show it. So the
site's own captured page is the hero asset, and every word on screen is the page's own
language rather than marketing written over it.

## The factual source

`https://example.com` is a two-sentence page. Captured 2026-08-03 with
`npx hyperframes capture`:

| Element | Verbatim text                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------------- |
| `<h1>`  | Example Domain                                                                                        |
| `<p>`   | This domain is for use in documentation examples without needing permission. Avoid use in operations. |
| `<a>`   | Learn more → `https://iana.org/domains/example`                                                       |

Brand tokens read off the live page, not invented:
canvas `#EEEEEE`, ink `#000000` at `opacity: .8`, link/accent `#334488`, type
`system-ui, sans-serif`.

## Structure — one scene, 10.0s

Narration is the spine; every reveal is cued to a spoken phrase. Timings below are the
**measured** word timings from the narration, not estimates.

| t           | beat                                                                   |
| ----------- | ---------------------------------------------------------------------- |
| 0.10 → 1.00 | the accent rule draws; the frame asserts itself                        |
| 1.00 → 1.68 | "Example Domain" rises out of a mask — VO: _"This is…"_                |
| 1.55 → 2.33 | brand rule draws, then the address in mono — VO: _"…example.com."_     |
| 2.66 → 3.51 | the real captured page travels in at exactly 1:1 — VO: _"The domain…"_ |
| 4.55 → 5.15 | an accent marker draws down the page's own words — VO: _"…examples."_  |
| 5.15 → 6.42 | held read — the composition reads still while the VO carries           |
| 6.42 → 7.10 | the supporting line lands — VO: _"…no permission needed."_             |
| 8.03 → 10.0 | captions clear; the frame holds as a clean, still end card             |

## Assets

| Asset                    | Provenance                                                                     |
| ------------------------ | ------------------------------------------------------------------------------ |
| `assets/example-com.png` | `npx hyperframes capture https://example.com`                                  |
| `assets/narration.wav`   | ElevenLabs **River** `SAz9YHcvj6GT2YYXdXww`, via `/media-use`                  |
| `assets/bgm.wav`         | HeyGen audio catalog, 10.0s bed, ingested from the v1 project via `/media-use` |
| `assets/sfx-whoosh.mp3`  | `/media-use` bundled library — `whoosh-short`, 0.57s                           |
| `assets/sfx-tick.mp3`    | `/media-use` bundled library — `click-soft`, 0.37s                             |

## Design truth

- The page is `#EEEEEE`. The composition canvas is one step down (`#E9E9E7`) so the
  captured plate reads as a **lifted surface** instead of dissolving into the ground.
  That is the one derived value; everything else is the page's own.
- Inter 900 / 400 for the lockup, IBM Plex Mono 400 for the address. Both are in the
  renderer's embedded bundle at exactly those weights, so type is byte-identical in
  preview and render.
- The plate never scales and never rotates. A 1x capture has no headroom above 1:1;
  it travels on `x` only, so the page's own 16px type renders pixel-exact.

## Deliberately not in this video

- No CTA button. The page's one action is a plain text link that says "Learn more";
  drawing it as a pill with an arrow would be invented UI.
- No sheen, no bloom, no drifting camera, no texture overlays. One accent device
  (the rule / bar / marker family) carries the whole graphic language.
