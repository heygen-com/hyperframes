# HyperFrames Design Review

## First Impression

This looks like a Bauhaus-inspired museum exhibit had a head-on collision with a TikTok ad. It’s trying to be Jan Tschichold, but it’s currently closer to "I just discovered the Helvetica font and the color red."

---

## CRITICAL Design Failures

Issues that make this look unprofessional or straight-up ugly. These MUST be fixed.

### The "Floating Head" Problem

**Where:** `compositions/aroll.html`
**What's wrong:** The A-Roll video is set to `object-fit: cover` and fills the entire 1080x1920 frame. While bold, it completely ignores the "safe zones" for the face. The `mograph_overlays.html` then proceeds to slap text directly over where the speaker's face likely is.
**Why it matters:** You're literally covering the speaker's mouth or eyes with "USER SURVEY" and "47%". It looks like a mistake, not a design choice.
**Fix it:** Scale the A-Roll video down or use a mask that respects the rule of thirds. If you're going full-screen, your overlays need to be pushed to the extreme margins.

### Caption Chaos

**Where:** `compositions/captions.html`
**What's wrong:** You have words jumping from `font-size: 50px` to `140px` with a `line-height: 0.9`. In a 9:16 portrait format, this is going to cause massive, ugly overlaps and erratic wrapping.
**Why it matters:** Readability is the first casualty of "cool" design. If the viewer has to squint or decode which word comes next because they're stacked like a game of Tetris, you've failed.
**Fix it:** Standardize the scale variance. 50px to 140px is too wide a gap. Try 80px to 120px. Increase the `line-height` to at least `1.1` to give the descenders some breathing room.

### The "Dead" Background

**Where:** `compositions/background.html`
**What's wrong:** A `#FAF5E8` (off-white) background with a `0.05` opacity noise filter is basically just a flat, boring beige on most mobile screens. The grid lines are too thin (`1px`, `2px`) to feel intentional; they just look like screen artifacts.
**Why it matters:** It lacks depth. It feels like a default template rather than a premium "New Typography" aesthetic.
**Fix it:** Increase the noise opacity to `0.1` or `0.15`. Make the grid lines bolder—use `4px` and `8px` consistently to create a real sense of structure.

---

## Design Improvements

Things that aren't broken but are boring, lazy, or could be significantly better.

### Robotic Motion

**Where:** `compositions/mograph_overlays.html`
**The problem:** The diagonal lines and markers just "drift" linearly. It’s the most basic GSAP animation possible.
**Make it better:** Add some "snap" to the entrance. Use `expo.out` or `back.out` for the markers. Give the lines a slight pulse in opacity or thickness to make them feel like they're reacting to the audio, not just floating in space.

### Hero Moment Hierarchy

**Where:** `compositions/hero_moment.html`
**The problem:** The "75%" is `280px` while the supporting text is `120px`. It’s a bit of a "shouting match" between elements.
**Make it better:** Lean into the Tschichold asymmetry. Move the "75%" off-center. Use a much heavier weight for the number and a much lighter, tracked-out weight for the text. Contrast is your friend; stop making everything "big."

---

## What Actually Works

The use of **Bauhaus Red (#BE1E2D)** against the off-white is a classic for a reason. When it hits, it hits hard. The "rail" concept in the captions is a genuine nod to modernist layout principles—it just needs better execution. The "wipe-line" entrance in the A-Roll is actually quite sophisticated and provides a nice "editorial" feel.

---

## Design Verdict

**Visual Impact:** 6/10 - It has a clear direction, but it's playing it too safe.
**Color & Typography:** 5/10 - Good palette, but the typographic hierarchy is a mess of competing scales.
**Motion & Animation Feel:** 4/10 - Too much linear drifting; needs more rhythmic "pop."
**Overall Aesthetic:** 5/10 - It looks like a student project trying to mimic a master.

**Bottom Line:** It’s not a disaster, but it’s forgettable. You’ve got the ingredients for a high-end editorial look, but you’re currently serving it on a paper plate. Fix the face-blocking overlays and the caption scaling before you show this to anyone with a pulse.
