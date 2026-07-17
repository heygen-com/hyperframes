# Vox motion & transition grammar (measured)

Sources: frame-by-frame sampling around scene cuts in the Cooper Black dissection
(±0.45s strips at detector-listed cut points) cross-checked by a Gemini transition
census over two full reference clips (Cooper Black + WWI plastic-surgery Almanac,
~60 transitions catalogued). The two methods agree.

## The five rules

1. **Hard cut on the narration beat.** Effectively 100% of scene transitions are
   hard cuts synchronized to the narrator's spoken beats. No crossfades, no wipes,
   no slide transitions.

2. **Outgoing elements do NOT animate out.** Content is still on screen when the
   cut lands. The only exit motion that exists is the zoom-through (rule 3).
   Do not add slide-outs/fade-outs before a cut — it reads as generic mograph,
   not Vox. (Giant type sliding across frame — the ENLARGE train — is a beat's own
   internal choreography, not an exit.)

3. **Zoom-through exit (occasional).** The outgoing shot pushes toward its subject
   just before the cut, and the cut lands on a closer/full-bleed view of the same
   subject (street scene pushes toward the storefront sign → cut to the sign
   full-frame). In HF: `tl.to(section, {scale:1.06–1.12, duration:.4–.45,
   ease:"power2.in", transformOrigin:<subject>}, cutT-.45)`.

4. **The incoming shot is never static.** It arrives already in motion, one of:
   - Ken Burns push (photo cards),
   - oversized settle — full-bleed plates start ~1.05–1.08 scale and settle to 1
     over .6–.7s power2.out (the blue alphabet-plate move),
   - element pops 0.2–0.5s after the cut (annotations, labels, callouts land
     instantly-to-half-a-second post-cut, synced to the words being spoken).

5. **Match cuts on color/shape.** Blue text card → blue full-bleed alphabet plate.
   When adjacent beats share a hue or silhouette, cut directly between them and
   let the continuity carry.

## HF recipe per beat

```js
/* entrance: already-in-motion settle */
tl.fromTo("#beat", {scale:1.05, transformOrigin:"50% 46%"},
                   {scale:1, duration:.7, ease:"power2.out"}, T);
/* content pops land 0.2–0.5s AFTER the cut, on narration words */
/* exit: either nothing (hard cut), or zoom-through toward the subject */
tl.to("#beat", {scale:1.06, duration:.4, ease:"power2.in",
                transformOrigin:"62% 30%"}, nextT-.4);
```

Element-level motion tokens (unchanged from §grammars): card pop .3–.4s
back.out(1.6), arrows .2s draw, card swap rhythm ~1.7s, boil 8fps seeded,
ghost lineups at ~10% opacity.
