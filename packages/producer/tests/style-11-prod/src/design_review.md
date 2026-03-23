# HyperFrames Design Review

## First Impression

This looks like a "Sol LeWitt" tribute act performed by someone who only saw a thumbnail of his work on a broken phone. It’s a sterile, confused mess that tries to be "minimalist" but ends up just being "unfinished."

---

## CRITICAL Design Failures

### Typographic Identity Crisis

**Where:** `compositions/mg-overlays.html` and `compositions/captions.html`
**What's wrong:** You're mixing **IBM Plex Mono** (a technical, rigid font) for your "data" with **Inter** (the most overused, generic UI font in existence) for your captions. It’s a jarring clash of "I'm a coder" and "I'm a SaaS landing page from 2019."
**Why it matters:** It destroys any sense of a cohesive visual brand. The viewer doesn't know if they're watching a technical documentary or a generic corporate explainer.
**Fix it:** Commit to the bit. Use IBM Plex Mono for _everything_ to lean into the Sol LeWitt / Blueprint aesthetic, or find a high-contrast serif to actually provide some visual interest.

### The "Floating in a Void" Problem

**Where:** `compositions/mg-overlays.html`
**What's wrong:** Your stats (`47%`, `62%`, `75%`) are just... there. They have no relationship to the grid or the isometric cubes. They're just floating at arbitrary coordinates like `top: 1200px; left: 100px;`.
**Why it matters:** It looks like a mistake. In a grid-based design, _everything_ must respect the grid. If it doesn't, the grid is just useless wallpaper.
**Fix it:** Align your text blocks strictly to the grid lines defined in `bg-grid.html`. Use the `cellW` and `cellH` logic to position your content so it feels structurally sound.

### Caption Background Cowardice

**Where:** `compositions/captions.html`
**What's wrong:** `background-color: rgba(0, 0, 0, 0.4);` with a `backdrop-filter: blur(4px);`. This is the "I don't know how to handle contrast" starter pack. It’s ugly, it’s muddy, and it obscures your "beautiful" background grid.
**Why it matters:** It creates a heavy, dark blob at the bottom of an otherwise light and airy composition. It’s visually exhausting.
**Fix it:** Remove the background and blur. If you need legibility, use a subtle drop shadow or, better yet, ensure your video/background doesn't compete with the text. Since your background is `#F4F4F4`, just use black text for the captions.

---

## Design Improvements

### Robotic Animation Pacing

**Where:** `compositions/bg-grid.html` and `compositions/mg-overlays.html`
**The problem:** Your animations are all using `power2.inOut` or `expo.out`. It’s predictable and lacks "soul." The cubes draw themselves, then they pulse, then they float. It feels like a loading screen, not a dynamic video.
**Make it better:** Vary the easing. Use `back.out` for the stats (which you did, barely) but make it more aggressive. Give the grid lines a staggered "wipe" effect rather than just fading in. Make the motion feel like it has momentum.

### Color Palette Anemia

**Where:** `compositions/bg-grid.html`
**The problem:** `#3377BB` and `#CC3333`. These are the default "Blue" and "Red" from a 1990s Excel chart. They are boring, primary, and have zero personality.
**Make it better:** Use more sophisticated tones. Try a deeper Cobalt or a muted Terracotta. Or, go full LeWitt and use high-saturation CMYK-style colors, but give them some breathing room.

---

## What Actually Works

The **Isometric Cube SVG** construction in `bg-grid.html` is actually decent. The way you've broken down the paths for a drawing effect shows you at least understand how to build a technical asset. The `stroke-dashoffset` animation is a classic for a reason—it works. If only the rest of the design had that much thought put into it.

---

## Design Verdict

**Visual Impact:** 3/10 - It’s as exciting as a graph paper notebook.
**Color & Typography:** 2/10 - A total lack of direction and courage.
**Motion & Animation Feel:** 4/10 - Functional, but lacks any rhythmic "snap."
**Overall Aesthetic:** 3/10 - "Corporate Minimalist" is just a polite way of saying "I didn't try."

**Bottom Line:** This looks like a technical demo for a library, not a finished piece of media. It’s cold, it’s disjointed, and it’s boring. Fix the typography and respect your own grid, or don't bother calling it "design."
