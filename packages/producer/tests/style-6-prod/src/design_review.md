# HyperFrames Design Review

## First Impression
This looks like a high-energy sports broadcast package that's trying way too hard to be "extreme" but ends up feeling like a template from a 2012 "Epic Sports Opener" pack. The "Volt" green is doing all the heavy lifting while the layout and typography are just shouting into the void.

---

## CRITICAL Design Failures

### The "Volt" Overdose & Contrast Suicide
**Where:** `compositions/intro.html`, `compositions/stats.html`
**What's wrong:** You've picked `#CDFF00` (Volt) as your primary accent, which is fine for a "sporty" look, but you're using it on white backgrounds or with white text in ways that make my eyes bleed. In `intro.html`, you have a 15% opacity Volt wipe behind white text. In `stats.html`, you have "3 OUT OF 4" where "OUT OF" is Volt and "3" and "4" are white. 
**Why it matters:** The contrast ratio between white and that specific neon green is abysmal. It’s vibrating. It’s unreadable. It looks like a mistake, not a design choice.
**Fix it:** Use the Volt green *only* against black or very dark backgrounds. Never put white text directly next to or on top of it without a massive dark stroke or shadow to separate them.

### The "Floating Head" Caption Problem
**Where:** `compositions/captions.html`
**What's wrong:** You have massive 80px Oswald Bold caps just sitting at the bottom 20% of the screen with a generic `2px 2px 4px` drop shadow. It looks like a DVD player's default subtitle setting from 2005.
**Why it matters:** It completely clashes with the "premium" sports aesthetic you're trying to build in the stats layer. It feels like an afterthought.
**Fix it:** Give the captions some container love. Use a skewed black background box (matching the `.stat-label` style) or at least use a more modern text-shadow (multiple layers of blur, not just a 2px offset).

### Layout Suffocation
**Where:** `compositions/stats.html` - `.right-side`
**What's wrong:** You've positioned your stats with `right: 100px`. On a 1920px wide screen, with 280px font size and `-10px` letter spacing, your text is practically hugging the edge of the frame.
**Why it matters:** It feels cramped and amateur. Professional broadcast design respects "Action Safe" zones and uses negative space to create impact.
**Fix it:** Increase the margin to at least 150px-200px. Let the composition breathe. If the text is too big, scale it down. Impact comes from contrast and placement, not just raw font size.

---

## Design Improvements

### Robotic Motion Curves
**Where:** `index.html`, `compositions/stats.html`
**The problem:** You're using `back.out(1.7)` for almost every major transition. It’s the "I just discovered GSAP" of easing functions. It makes the video and the title card feel like they're bouncing on a trampoline.
**Make it better:** Use more sophisticated easing. `expo.out` for fast, aggressive entrances; `power4.out` for smooth settles. Reserve the "back" ease for small UI elements, not the entire 1920x1080 video frame.

### Static Background Slashes
**Where:** `compositions/stats.html` - `.slash`
**The problem:** You have these diagonal slashes at 5% opacity with a 40px blur. They aren't "ambient motion"; they're just "smudges on the screen."
**Make it better:** Give them some actual personality. Vary their widths, use different opacities, and maybe add a subtle "glitch" or "shimmer" effect. Right now, they look like CSS gradients that didn't load properly.

---

## What Actually Works

### The "Reveal Bar" Concept
The use of `reveal-bar top` and `reveal-bar bottom` to split the screen and introduce the video at 3s is actually a solid broadcast technique. It creates a clear transition from the "Intro" phase to the "Content" phase. The 4px Volt border on the bars adds a nice "laser-cut" feel.

---

## Design Verdict

**Visual Impact:** 6/10 - It’s loud and aggressive, which fits the brief, but it lacks finesse.
**Color & Typography:** 4/10 - The Oswald/Bebas combo is a cliché, and the contrast issues are amateur hour.
**Motion & Animation Feel:** 5/10 - Too much "bouncing," not enough "snapping."
**Overall Aesthetic:** 5/10 - It looks like a mid-tier YouTube sports channel intro.

**Bottom Line:** It’s functional, but it’s not "premium." If you want this to look like Nike or ESPN, you need to stop relying on font size and start caring about white space and contrast. Fix the Volt-on-White crime immediately.