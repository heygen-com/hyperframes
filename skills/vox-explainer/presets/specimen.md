# Style block — vox specimen (typography/design/object-story grammar; source: Vox "Why this font is everywhere" Cooper Black, 2026-07 frame+Gemini dissection, HF reproduction verified)

The 6th page grammar. For typography, branding, product-design, "history of an object" topics.
**100% HF-native — no image generation.** Verified end-to-end: 22s narrated piece, all-code
textures, local TTS, render 19s (va-1766/blanding-test).

## The stage

Everything sits on a studio-paper void (`vox-paper-backdrop`) — never flat white. Everything on
it is a rounded CARD (`vox-specimen-card`): scanned objects, wordmark specimens, photo evidence,
**even the host** (host-card mode, never full-bleed). High event rate (~1.5-2s per visual event)
but "one enters, one leaves" — density comes from rhythm, not stacking.

## Type system (two tiers — mixing them is the #1 register mistake)

- Display/specimen type: fat soft-serif (Cooper Black; free stand-in **Shrikhand**), always
  wearing `vox-print-ink` (.ink roughening + .misreg offsets). Bake as styled text, never images.
- Tier-1 labels (`vox-anno-label`): plain uppercase letterspaced, NO background — for
  annotations (BEFORE / CROSSBAR / THIS FONT), paired with hand arrows.
- Tier-2 chips (`vox-caption-chip`): dark chips ONLY for words inside kinetic sentences and
  event callouts.

## Color semantics (measured tokens)

paper `#fbf9f4` / ink `#1a1a1a` / specimen blue `#5bc4f7→#3a90bd` / marker yellow `#f2df1c` /
annotation pink `#de6e96`. Yellow = baseline pads + highlighter; pink = letterform-anatomy
shapes and anatomy arrows; blue arrows point at world objects.

## Motion params (Gemini-verified against source)

card pop 0.3-0.4s back.out(1.6) center scale-in · card swap ~1.7s hard cuts · arrows draw-on
0.2s + small head pop · letter-assemble 0.15s/letter back.out(2.4) then container-stamp behind ·
kinetic words 0.18s/word · clipping drops 1.0s apart with rotation bounce · ghost neighbors ~10%
opacity fully static · boil 8fps ±2.5px · payoff hold masked by 1.00→1.02 push.

## Signature verbs (see research/cooper-black-motion-dissection.md for all 24)

specimen-extract (photo card → die-cut object on the void) · persistent annotation (chip+arrow
pinned on its own track across hard cuts) · progressive anatomy (`vox-letter-anatomy`: pads →
pills → labels+arrows, synced to VO) · ghost lineup with one full-color hero.

HF-native mapping (registry): `vox-paper-backdrop` · `vox-print-ink` · `vox-specimen-card` ·
`vox-anno-label` · `vox-caption-chip` · `vox-thin-arrow` (.hand.pink for anatomy) ·
`vox-letter-anatomy` · `vox-boil`.

Generation-route style block: not recommended — this grammar is the strongest case for the
HF-native route (type fidelity is the whole point; video models redraw letterforms).
