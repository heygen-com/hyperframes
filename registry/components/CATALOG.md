# Hero primitive catalog (the shelf of 21)

How to use this file, frame worker:
1. Check this shelf FIRST. When a Scene's mechanic matches a primitive's use_when, mount that primitive; do not rebuild it.
2. Mount via `data-composition-src` on a `class="clip"` div pointing at the installed component HTML, with `data-start`, `data-duration`, `data-track-index`.
3. Pass variables as JSON in `data-variable-values` on the clip. Every variable has a default; pass only what you change.
4. Slots: units that show media or custom content expose named `data-slot` elements (filled in your installed copy) or host-page `<template data-slot="...">` elements (browser-device-stage). Each unit's README documents its exact slot mechanism.
5. The accent enum is shared: `green` rides `--brand`, `blue` rides `--accent`, `violet` rides `--accent-2`. Theme tokens do the coloring; never hardcode brand colors into a mount.
6. `exit` defaults to `none` everywhere: primitives hold their final frame and the frame root owns transitions. Opt into `fade` or `up` only when the frame itself must depart.
7. `cues` (where present) is comma-separated seconds from mount start for each beat of the unit's sequence; empty keeps the authored rhythm. Use it to lock reveals to narration.
8. All units are elastic: no fixed dimensions, they fill the host clip's box. Extra duration becomes HOLD, never a time-stretched animation.
9. Compose bespoke HTML only when nothing on this shelf serves the mechanic. Bespoke work follows the same mount contract.
10. `avoid_when` lines are real misuse patterns seen in QA; treat them as hard steers, not suggestions.

## Text effects

### per-word-rise
group: Text effects.
what: Words or characters rise into place in a controlled blur-to-sharp cascade, drift gently, and hold until the cut.
use_when: A headline or key line should land word by word in sync with narration beats.
avoid_when: The line must swap or replace text mid-scene; this unit only reveals one static line.
pairs_with: kinetic-type-swap, count-up, cta-close.
variables: text (string, default "WORDS IN MOTION"): the displayed line. split (enum word or char, default word): the unit that rises. cues (string, default empty): comma seconds for each unit's landing. accent (enum green, blue, violet, default green): text color. exit (enum none, fade, up, default none).

### scramble-reveal
group: Text effects.
what: A deterministic hacker-style reveal that cycles fixed glyph rows and locks the target string left to right.
use_when: A product name, feature name, or technical claim should resolve with a terminal or engineering flavor.
avoid_when: The brand voice is calm or premium; the glyph churn reads noisy against quiet scenes (use titlecard-lockup or per-word-rise).
pairs_with: titlecard-lockup, cut-the-curve.
variables: text (string, default "HYPERFRAMES"): target string. style (enum terminal or clean, default terminal): framed terminal or bare text. accent (enum green, blue, violet, default green): text, prefix, and frame color. exit (enum none, fade, up, default none).

### kinetic-type-swap
group: Text effects.
what: A held sentence keeps its fixed prefix and suffix while one masked word slot rolls through alternatives and settles on the final option.
use_when: One sentence must carry multiple value words ("Ship faster, smarter, together") without reflowing the line.
avoid_when: The alternatives differ wildly in length or you need more than a handful of swaps; the slot pre-sizes to the widest option and long lists drag.
pairs_with: per-word-rise, browser-device-stage, cta-close.
variables: prefix (string, default "Ship"): fixed text before the slot. options (string, default "faster,smarter,together"): comma words shown in order; the last is final. suffix (string, default empty): fixed text after the slot. cues (string, default empty): comma seconds per swap. accent (enum green, blue, violet, default green): slot color. exit (enum none, fade, up, default none).

### oversized-cursor
group: Product demo.
what: A deliberately oversized macOS-style pointer enters off-screen, glides to a target, clicks to visibly ignite it, then accelerates back off-screen.
use_when: The scene needs a personified "someone clicks the thing and it works" beat with theatrical scale.
avoid_when: The click target is your own slotted UI or the pressed state must persist; use press-ripple, which presses a slot and holds it.
pairs_with: browser-device-stage, cut-the-curve.
variables: cursor_variant (enum light or dark, default light): pointer body tone. target_x (number percent, default 55) and target_y (number percent, default 55): tip landing point. click_label (string, default "Generate"): label on the clicked pill. exit (enum none, fade, up, default none): fade and up also depart the ignited target.

### press-ripple
group: Product demo.
what: A cursor decel-arrives from off-stage, lands slightly off-center on a caller-positioned target, compresses with it in lockstep, releases with ink ripple rings, and holds the pressed state.
use_when: The payoff beat: the user presses the button and the film rests on that satisfied pressed state.
avoid_when: The cursor itself is the star or must leave after the click; use oversized-cursor for the enter-click-exit arc.
pairs_with: browser-device-stage, cta-close.
variables: label (string, default "Get started"): text in the default pill; ignored when the target slot is replaced. target_x (number percent, default 50) and target_y (number percent, default 50): zone center. press_at (number seconds, default 1.4): press cue. cursor (enum light or dark, default light): pointer tone. accent (enum green, blue, violet, default green): ripple ink and pressed fill. exit (enum none, fade, up, default none).

### browser-device-stage
group: Product demo.
what: A generic app surface in token-native chrome (browser, window, or phone); the screen area is a slot with a skeleton default, one settle entrance, a readable hold, and an optional screen swap.
use_when: A real screenshot or product UI needs a credible stage: this is the default way to show "the product" in a launch film.
avoid_when: The content is seek-synced footage; slotted video is not framework-synced, so use a media clip composition instead.
pairs_with: oversized-cursor, before-after-wipe.
variables: chrome (enum browser, window, phone, default browser): device frame. title (string, default "app.example.com"): address pill or title bar text. swap_at (number seconds, default 0): crossfade to the second screen slot; 0 disables. accent (enum green, blue, violet, default green): skeleton accent. exit (enum none, fade, up, default none). Slots: host-page templates data-slot="browser-device-stage-screen" and "browser-device-stage-screen-b".

## Proof and stats

### count-up
group: Proof and stats.
what: A token-native stat counter that eases from start to end, lands on the exact final integer with one restrained scale pulse, and holds.
use_when: One number is the proof: users, revenue, speedup, and it should land exactly as narration states it.
avoid_when: The stat needs context or comparison; a lone number without a chart or label reads hollow, reach for chart-story.
pairs_with: chart-story, count-up.
variables: start (number, default 0) and end (number, default 100): count range; always lands exactly on end. prefix (string, default empty) and suffix (string, default "%"): fixed text around the value. accent (enum green, blue, violet, default green): count color. glow (boolean, default false): opt-in soft accent glow. exit (enum none, fade, up, default none).

### chart-story
group: Proof and stats.
what: One chart builds from data in reading order and lands the exact supplied values: staggered bars, a left-to-right line with area fill, a sweeping donut, or filling progress bars, with an accent callout on the emphasized datum.
use_when: The proof is a trend or comparison across several values and one datum should carry the story.
avoid_when: There is only one number to show (use count-up) or the data needs live interactivity; this is an authored build, not a chart widget.
pairs_with: count-up, chart-story, scroll-feed.
variables: type (enum bars, line, donut, progress, default bars): chart form. data (string, default "12, 28, 45, 64"): comma numbers, landed exactly. labels (string, default "Q1, Q2, Q3, Q4"): comma labels per datum. emphasize (number index, default 3): accented datum with the callout. unit (string, default "%"): value suffix. accent (enum green, blue, violet, default green). exit (enum none, fade, up, default none).

### titlecard-lockup
group: Intros and reveals.
what: The calm breather titlecard: an optional mono kicker fades up, the wordmark settles dead-center with one restrained move, a hairline rule draws left to right, a mono label fades beneath, then a truly still hold.
use_when: The film needs a breath: the opening card, a chapter break, or a name reveal where low motion IS the statement.
avoid_when: The scene needs energy or a second development phase; this unit refuses spring chains by design (use per-word-rise or scramble-reveal).
pairs_with: scramble-reveal, logo-brand-close, titlecard-lockup.
variables: wordmark (string, default "HYPERFRAMES"): the centered display line. label (string, default "WRITE HTML. RENDER VIDEO."): mono caption under the rule; empty hides. kicker (string, default "INTRODUCING"): small mono label above; empty hides. rule (enum show or hide, default show): the hairline rule and its draw. accent (enum green, blue, violet, default green): carried by the rule. exit (enum none, fade, up, default none).

### svg-stroke-trace
group: Intros and reveals.
what: An authored SVG path draws from its measured length, holds with subtle drift, and fills after the stroke when the path is closed with Z.
use_when: A custom mark, signature, underline flourish, or simple line drawing should draw itself on screen.
avoid_when: The artwork is multi-stroke or needs a visible pen; use whiteboard-ink, which sequences strokes with a nib actor.
pairs_with: whiteboard-ink, titlecard-lockup.
variables: path (string, default a wave path): SVG path data in a 1024x520 viewBox; trailing Z enables fill. stroke_width (number, default 12): stroke width in viewBox units. accent (enum green, blue, violet, default green): trace and fill color. exit (enum none, fade, up, default none).

### whiteboard-ink
group: Intros and reveals.
what: A whiteboard sketch draws one measured stroke at a time while a pen nib rides the active ink front; preset sketches (bulb, flow, rocket) or your own multi-stroke paths via the strokes slot.
use_when: An idea, flow, or concept should feel hand-drawn and explanatory, sketched live as narration describes it.
avoid_when: The mark is a single path or a logo trace; svg-stroke-trace is the lighter tool for one stroke.
pairs_with: svg-stroke-trace, per-word-rise, grid-card-assemble.
variables: sketch (enum bulb, flow, rocket, default bulb): preset; ignored when the strokes slot holds paths. caption (string, default "Draw the idea"): line shown after the sketch completes; empty hides. pen (enum show or hide, default show): the nib actor. accent (enum green, blue, violet, default green): strokes marked data-ink="accent". exit (enum none, fade, up, default none). Slot: fill the data-slot="strokes" SVG group with your own path elements in the installed copy.

## Call to action

### cta-close
group: Call to action.
what: The action-only close: one oversized action line rises into frame, one CTA capsule pops beneath it, and the lockup holds completely still.
use_when: The film ends on an ask: sign up, start now, try it; the last thing on screen is the action.
avoid_when: The film should end on who made it rather than what to do; use logo-brand-close for the identity ending.
pairs_with: logo-brand-close, press-ripple, count-up.
variables: action_line (string, default "Make it happen"): two to four word closing action. button_label (string, default "Start now"): capsule text. accent (enum green, blue, violet, default green): capsule color. exit (enum none, fade, up, default none): closes films, so keep none.

### logo-brand-close
group: Call to action.
what: Wordmark letters cascade left to right into a centered lockup, an optional tagline and mono URL line settle beneath, then a dead-still identity hold ends the film.
use_when: The final frame is the brand: name, tagline, URL, held to the last frame.
avoid_when: The ending should push a button-press or signup; that is cta-close, which is action, not identity.
pairs_with: cta-close, titlecard-lockup, count-up.
variables: wordmark (string, default "HYPERFRAMES"): letters cascade individually; a brand period is appended in accent. tagline (string, default "Write HTML. Render video."): settles beneath; empty hides. url (string, default "hyperframes.heygen.com"): mono line below; empty hides. accent (enum green, blue, violet, default green): colors the brand period. exit (enum none, fade, up, default none): a film ender, keep none.

## Feature tour

### grid-card-assemble
group: Feature tour.
what: N labeled token cards stagger-assemble into a grid or vertical list with a fade plus short slide directly into slot, no overshoot, then hold perfectly still.
use_when: Several features, steps, or capabilities should land as one composed inventory the viewer can scan.
avoid_when: The features relate to one central thing and the relationship matters; constellation-hub draws that structure.
pairs_with: browser-device-stage, cta-close.
variables: items (string, default "Capture,Compose,Render,Publish"): comma tile labels, 3 to 12. layout (enum grid or list, default grid). columns (number 0 to 4, default 0): 0 auto-picks. cues (string, default empty): per-item entrance times. accent (enum green, blue, violet, default green): tile dot color. exit (enum none, fade, up, default none). Slot: author children inside data-slot="items" to replace generated tiles.

### before-after-wipe
group: Before / after.
what: Two full-bleed content slots compare before and after states as a persistent divider wipes the after layer over the before layer and rests at a configurable split.
use_when: The improvement is visual: old UI versus new, raw versus polished, and one wipe tells it.
avoid_when: The two states are sequential rather than comparative; a straight scene cut or cut-the-curve reads better than a held split.
pairs_with: browser-device-stage, chart-story.
variables: label_a (string, default "Before") and label_b (string, default "After"): side chips; blank hides. rest_split (number percent, default 50): divider resting position. wipe_at (number seconds, default 0.25): wipe start. accent (enum green, blue, violet, default green): divider handle and after chip. exit (enum none, fade, up, default none). Slots: replace the children of data-slot="before" and data-slot="after" in the installed copy; both panels share one coordinate space.

## Transitions

### cut-the-curve
group: Transitions.
what: A velocity-matched directional hard cut: the outgoing subject accelerates, swaps identity at peak velocity, and the incoming subject continues in the same direction and decelerates to rest.
use_when: Two scenes or subjects should hand off with kinetic energy instead of a dissolve; the seam hides inside the speed.
avoid_when: The moment calls for calm; a hard velocity cut in a quiet passage reads like a glitch. Also never as a hold, it has no elastic phase, retime via mount duration only.
pairs_with: oversized-cursor, scroll-feed, browser-device-stage.
variables: subject (enum cursor, card, scene, default cursor): payload on both sides. direction (enum left, right, up, down, default left): shared travel vector. cutFraction (number 0 to 1, default 0.33): normalized swap point. blurPx (number, default 12): seam blur. exit (enum none, fade, up, default none): departs the incoming subject after it lands.

## Problem setup

### scroll-feed
group: Problem setup.
what: A loop-friendly column of varied skeleton post cards scrolls upward with subtle motion trails at an agitated pace.
use_when: Establishing the pain: noise, doom-scrolling, endless feeds, the "before" world your product fixes.
avoid_when: The content of the cards matters; these are anonymous skeletons, so real posts or testimonials need a bespoke scene.
pairs_with: cut-the-curve, before-after-wipe, count-up.
variables: speed (enum doom or frantic, default doom): scroll pace. card_count (number 4 to 10, default 6): cards per cycle. cues (string, default empty): each cue advances the feed one card, a stepped rhythm; empty keeps the continuous loop-compatible scroll. exit (enum none, fade, up, default none): the loop guarantee only holds with empty cues and exit none.

### scroll-camera-story
group: Camera moves. A compressed forced-scroll cinematic pass: four depth layers move at different rates while section cards rise as the camera reaches them, decelerating into a held final section.
use_when: a multi-section story should feel like one continuous cinematic travel.
avoid_when: only one subject exists; ui-focus-zoom frames a single surface better.
pairs_with: titlecard-lockup, cta-close, whip-pan-cut.
variables: sections (2-4), travel (cqh), cues, accent, exit.

### iris-reveal
group: Transitions. A circle opens from an authored origin revealing full-color state B over a grayscaled state A; an accent rim rides the clip edge.
use_when: a before-to-after or reveal beat should land as one confident punch from a point.
avoid_when: both states must stay inspectable side by side; that is before-after-wipe.
pairs_with: before-after-wipe, browser-device-stage, logo-brand-close.
variables: iris_x, iris_y, open_at, register (color or plain), accent, exit.

### particle-image-reveal
group: Intros and reveals. A seeded deterministic particle field converges to materialize a slotted image, the trail thinning to zero as it completes.
use_when: a logo or key visual deserves a crafted materialize moment.
avoid_when: the register is strictly sober enterprise; titlecard-lockup is the quiet reveal.
pairs_with: logo-brand-close, titlecard-lockup, beat-pulse-background.
variables: density (low med high), direction (ltr center), accent, exit.

### telemetry-hud
group: Product demo. Quiet mono debug-HUD readouts frame a slotted subject: corner brackets draw on, values tick on cues, one readout emphasized.
use_when: a technical product should feel instrumented and precise around its hero shot.
avoid_when: the audience is non-technical; the HUD reads as noise.
pairs_with: browser-device-stage, typed prompt beats via code-terminal-run, count-up.
variables: readouts (label:value list), emphasize, cues, accent, exit.

### native-notification-pop
group: Product demo. One system-faithful iOS or macOS notification banner drops over any scene with an accurate interruptible spring and backdrop blur.
use_when: the payoff is "it notifies you" or a moment should feel native to the OS.
avoid_when: several notifications tell the story; that is notification-stack.
pairs_with: browser-device-stage, press-ripple, scroll-camera-story.
variables: title, body, app_label, os (ios macos), at, accent, exit.

### whip-pan-cut
group: Transitions. A velocity-matched whip pan with directional motion blur and a speed-ramp profile carries scene A off as scene B lands; cut-the-curve's louder sibling.
use_when: a rapid-fire montage needs energy between beats.
avoid_when: the film's register is quiet enterprise; use cut-the-curve.
pairs_with: cut-the-curve, scroll-feed, spring-stack-shuffle.
variables: direction, whip_at, accent, exit.

### spring-stack-shuffle
group: Product demo. A stack of slotted cards reshuffles with real mass on cues; a mid-flight redirect preserves velocity (the interruptible-spring law).
use_when: browsing or cycling through screens, results, or options should feel physical.
avoid_when: items should assemble once and rest; that is grid-card-assemble.
pairs_with: screen-flow-carousel, browser-device-stage, whip-pan-cut.
variables: cards (3-5), cues, accent, exit.

### vox-annotate
group: Text effects. A keyword inside a held sentence gets a hand-drawn marker while a thin connector draws to a mono callout label, one annotate gesture on the cue.
use_when: a phrase needs an editorial aside or explanation, documentary style.
avoid_when: plain emphasis with no callout is enough; keep the sentence clean instead.
pairs_with: per-word-rise, line-swap, titlecard-lockup.
variables: text, keyword, note, style (highlight circle underline scribble), draw_at, accent, exit.
