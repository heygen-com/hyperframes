# Using `text-spectral-rays` — it OWNS its wordmark

`text-spectral-rays` is a **self-contained WebGL hero-text renderer**. From ONE rasterized
glyph mask it draws **both** the solid wordmark **and** the spectral rays that emanate from
it. Letters and rays share the same mask, so they are always perfectly registered.

## The one trap: never give the word a second source

The ghost / doubled-wordmark artifact comes from splitting the word across two sources:

- ❌ **Wrong** — use the shader as a "rays-only background" and draw the visible letters
  with a **separate DOM element** (or stack a second text move like `content_swap` /
  `chromatic_pressure` on the same word). The DOM font (e.g. Inter) and the shader's raster
  font (Arial Black / Impact fallback) differ in width, shape, and position, so the ray
  edges never line up with the DOM letters → a misregistered ghost. **Deleting the shader's
  letter terms does NOT fix it** — the ray mask itself is still the second, misaligned copy
  of the word.

- ✅ **Right** — let the shader render the wordmark. There is exactly ONE source, so a
  ghost is structurally impossible.

## Integrate in one pass

1. **It IS the wordmark.** Hide any DOM logo for that word (keep it only as an invisible
   layout spacer if a tagline/CTA below depends on its box). Never stack a discrete text
   move on the same word.
2. **One timeline.** Merge its `progress` / `effectMix` state tweens onto the group's master
   timeline and repaint via `tl.eventCallback("onUpdate", render)` — no second timeline, no
   `requestAnimationFrame`.
3. **Align the cursor to the word.** `mouse.y` must equal the mask's vertical center. If you
   move the rasterized word off frame-center (e.g. up, to leave room for a tagline), shift
   the cursor's `y` by the same amount — otherwise the rays cast at the wrong angle.
4. **Local raster only.** Rasterize the word with a bundled / system font (no CDN font);
   upload the mask + colour canvases as textures.
5. **Entrance.** Slam the whole canvas (autoAlpha + a scale punch, `transform-origin` on the
   word's optical center) on the hit; let `effectMix` bloom the rays just after. The solid
   letters are present the instant the canvas reveals.

## Pairs with

A background bed (`bg-flow-field`) or **separate** supporting elements (tagline, CTA, rule)
— never a second treatment of its own word.
