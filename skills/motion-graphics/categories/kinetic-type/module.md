# kinetic-type — category module

Text is the hero; typography + motion carry the message. Usually asset-free (`asset_needs: []`).

## Plan (Director)

- **Style first.** If the project has a **`design.md` / `frame.md`** (precedence: `frame.md` → `design.md` → `DESIGN.md`), READ it and use its **exact palette / fonts / constraints** — do not invent. No spec → pick a named style, or ask: mood + light/dark + any brand color/font. (Style is an input the case must exercise; the same shot in two `design.md`s should look different.)
- Segment the copy into scenes by meaning / breath (EN ~3–7 words; ZH ~4–12 chars). Tag each scene **Hook → Build → Punch → Resolve**.
- 1–2 `emphasis_words` per scene. Per scene: `emotion` + `motion` (free-form) + `beats`.

## Vocabulary

Motion primitives + registry blocks: **`references/motion-vocabulary.md`** (slide / scale / fade / blur / typewriter / word_reveal / wave / bounce / slam / scale_pulse / shake / glow / color_shift, plus the 18 `caption-*` blocks).

## Build (reuse-first)

- Prefer a **`caption-*` block** when one fits (`caption-kinetic-slam` / `caption-editorial-emphasis` / …): `npx hyperframes add` + set words / `emphasis_words` / palette / font.
- Else hand-author: one full-duration `.clip`; a `.group` per scene (flex-centered); words as spans; explicit `gsap.fromTo()` entrances per scene `motion`; emphasis words → `glow` / `scale_pulse` on the beat; seek-safe `autoAlpha` only on inner non-clip elements. Honor `references/builder-contract.md`.
- Reference impl: prototype `v0-text-motion-demo` + `pipeline-demo`.
