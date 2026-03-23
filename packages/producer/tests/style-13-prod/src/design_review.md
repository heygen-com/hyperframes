# HyperFrames Design Review

## First Impression

This looks like a "hacker aesthetic" template from a 2014 YouTube tutorial. It’s trying so hard to be "techy" with its scanlines and dot grids that it forgets to actually be legible or modern.

---

## CRITICAL Design Failures

Issues that make this look unprofessional or straight-up ugly. These MUST be fixed.

### The "Everything is a Scanline" Obsession

**Where:** `compositions/background.html`, `compositions/transitions.html`, `compositions/overlays.html`
**What's wrong:** You have three different types of scanlines/grids fighting for dominance. The background has a scanline, the transitions are giant scanline blocks, and the overlays have mini scanlines. It’s visual clutter that serves no purpose other than to scream "I just learned CSS gradients."
**Why it matters:** It creates a vibrating, noisy mess that distracts from the actual content. It feels dated and amateur.
**Fix it:** Pick ONE subtle scanline effect for the background and kill the rest. Use clean, solid shapes for UI elements.

### Typography Identity Crisis

**Where:** `compositions/overlays.html`
**What's wrong:** You're mixing 'Space Mono' (thin/techy) with 'Archivo Black' (heavy/brutal) in the same overlay (`#stat-3`). The contrast isn't intentional; it's jarring. Furthermore, the captions use 'Space Mono' at 54px with a 15px gap—it's going to look like a wall of unreadable code.
**Why it matters:** Good design requires a clear typographic hierarchy. This feels like a random font-picker result.
**Fix it:** Commit to one aesthetic. If you want Wim Crouwel, stick to a strict grid and a single, highly structured typeface. Lose the 'Archivo Black' or use it exclusively for headers.

### The "Face Zone" Collision

**Where:** `index.html`, `compositions/captions.html`
**What's wrong:** You've centered the captions vertically (`align-items: center` in `[data-composition-id="captions"]`). In a 9:16 portrait video, the subject's face is almost always in the upper-middle third. You are literally slapping text over the speaker's mouth.
**Why it matters:** It’s the #1 amateur mistake in video editing. You never cover the face.
**Fix it:** Move the captions to the lower third (around `bottom: 20%`).

---

## Design Improvements

Things that aren't broken but are boring, lazy, or could be significantly better.

### Robotic Motion

**Where:** `index.html` (A-roll exit)
**The problem:** The A-roll video exits at 7.3s with a simple `x: -1080`. It’s a flat, linear-feeling slide that lacks any cinematic weight.
**Make it better:** Add a slight `z` depth (scale down more) and a more aggressive `expo.in` ease. If it's leaving the screen, it should feel like it's being pulled away, not just sliding on a rail.

### Color Overload

**Where:** `compositions/transitions.html` (Orange) vs `compositions/captions.html` (Green)
**The problem:** You have "Signal Orange" (#FF6600) and "Spring Green" (#00FF80) competing. It looks like a construction site.
**Make it better:** Choose a primary accent and a secondary. If Green is your "action" color for captions, use a muted version of the Orange or a neutral gray for the UI "scanlines."

---

## What Actually Works

The **Wim Crouwel inspired dot-matrix numbers** in `compositions/overlays.html` are actually sophisticated. The custom grid definitions for '47%', '62%', etc., show a level of craft that the rest of the project lacks. It’s a high-concept detail that deserves a better environment than this "scanline-heavy" graveyard.

---

## Design Verdict

**Visual Impact:** 4/10 - It’s loud, but for all the wrong reasons.
**Color & Typography:** 3/10 - A clashing mess of "tech" tropes and mismatched weights.
**Motion & Animation Feel:** 5/10 - The GSAP logic is sound, but the easing is generic.
**Overall Aesthetic:** 4/10 - Feels like a 2010s "Cyber" template rather than a 2026 "Editor Agent."

**Bottom Line:** Stop hiding behind scanlines and "glitch" effects. Clean up the layout, respect the subject's face, and let those dot-matrix numbers be the star of the show. Right now, it's a mess.
