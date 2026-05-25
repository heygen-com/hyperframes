# Step 5: Build Compositions

**Captions rule — read before building anything:** Never create `compositions/captions.html` with an empty transcript (`const script = []`). If the VO/transcript step was skipped or failed, do not create a captions composition at all. An empty captions file silently does nothing and wastes a track slot. Only create it when `transcript.json` has real word timestamps.

**Captions stacking bug:** Every caption word group must start with `opacity: 0` (or `visibility: hidden`) and be positioned `position: absolute`. Never show more than one group at a time — GSAP controls visibility sequentially. If multiple groups are visible simultaneously it means either (a) the initial CSS state isn't hidden, or (b) a group's exit tween is missing before the next group's entrance fires. After building captions.html, take a snapshot at 3–4 timestamps mid-narration and verify only one word group is visible per frame.

**Before building, verify you have:**

- **STORYBOARD.md** — the beat-by-beat plan. Re-read it now if you don't remember every beat's concept, assets, and techniques.
- **DESIGN.md** — if you need to check a specific value (color, font, component style) you can't recall, look it up. Don't re-read the whole file.
- **`capture/extracted/asset-descriptions.md`** — when the storyboard assigns an asset to a beat, check the description to understand what it shows. Re-read this file if you can't recall the asset inventory.
- **transcript.json** — word-level timestamps that drive scene durations.

Load the `hyperframes` skill — it has the rules for data attributes, timeline contracts, deterministic rendering, and layout. Read it now if you haven't already this session.

**For capabilities.md and techniques.md:** read the Table of Contents to orient yourself, then go deep only on the sections your storyboard actually calls for. You don't need to re-read sections for animation engines, registry blocks, or techniques that none of your beats use.

---

## 1. Copy SFX to project

```bash
cp -r skills/website-to-hyperframes/assets/sfx/ <project-dir>/sfx/
# If skill is installed elsewhere:
find . -path "*/website-to-hyperframes/assets/sfx" -exec cp -r {} <project-dir>/sfx/ \;
```

## 2. Build the root index.html

Create `index.html` yourself. This is the orchestrator — it holds beat slots, narration audio, SFX, and shader transitions (if any).

**Critical CSS — every beat must overlap in the same frame:**

```css
.scene {
  position: absolute;
  top: 0;
  left: 0;
  width: 1920px;
  height: 1080px;
  overflow: hidden;
}
```

**Beat structure:**

```html
<div
  id="root"
  data-composition-id="main"
  data-start="0"
  data-duration="TOTAL"
  data-width="1920"
  data-height="1080"
>
  <div
    id="beat-1"
    class="scene"
    data-composition-id="beat-1-hook"
    data-composition-src="compositions/beat-1-hook.html"
    data-start="0"
    data-duration="5.5"
    data-track-index="1"
    data-width="1920"
    data-height="1080"
  ></div>

  <!-- more beats... -->

  <audio
    id="narration"
    src="narration.wav"
    data-start="0"
    data-duration="NARRATION_LENGTH"
    data-track-index="0"
    data-volume="1"
  ></audio>

  <!-- SFX on content moments, NOT on shader transitions -->
  <audio
    id="sfx-impact"
    src="sfx/impact-bass-1.mp3"
    data-start="0.3"
    data-duration="2.1"
    data-track-index="41"
    data-volume="0.35"
  ></audio>
</div>
```

SFX were assigned in the storyboard (Step 3) — implement exactly what STORYBOARD.md specifies. Each SFX entry has a file, trigger time, and volume. Wire each one as an `<audio>` element with the exact `data-start`, `data-duration`, and `data-volume` from the storyboard. Do not add, remove, or substitute SFX beyond what the storyboard says.

**Choose architecture based on pacing (from Step 3)**

| Pacing                        | Architecture                                                                                                                                                                         | Why                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| **Fast** (billboard-per-beat) | Single `index.html`, stacked `<div class="beat">` elements, GSAP opacity sequencing. NO sub-compositions, NO HyperShader. Hard cuts via `tl.set()`. See stacked-beats pattern below. | Sub-compositions add latency; hard cuts need instant swaps. One file = zero load delay. |
| **Moderate / Slow / Arc**     | Sub-compositions with `HyperShader.init()`. Each beat in `compositions/beat-N.html`. CSS crossfades or shader transitions between scenes.                                            | Transitions need HyperShader's compositing. Sub-agents build each beat independently.   |

If the storyboard says "fast" pacing: use the stacked-beats pattern below. Do not use HyperShader — it adds scene registration overhead that creates gaps between hard cuts. Every frame is content, no transition frames.

**Stacked-beats pattern (fast pacing):**

Each beat composes from whatever primitives the storyboard called for — HTML/CSS, SVG, captured assets, WebGL, Canvas, Three.js, kinetic typography, Lottie — alone or in combination. Narrow no-go: never a full-bleed product-UI screenshot as load-bearing content. Each beat's structure comes from the storyboard's Composition + Accents spec.

```html
<div
  data-composition-id="video"
  data-width="1920"
  data-height="1080"
  data-start="0"
  data-duration="TOTAL"
  style="position:relative;width:1920px;height:1080px;"
>
  <!-- Beat 1: kinetic-typography hook (composed from per-word spans) -->
  <div class="beat" id="b01" style="opacity:1;">
    <div class="mega">
      <span class="w">Stop</span>
      <span class="w">context-switching.</span>
    </div>
  </div>

  <!-- Beat 2: composed kanban — 3 columns of cards-as-divs, NOT a screenshot -->
  <div class="beat" id="b02">
    <div class="kanban">
      <div class="col">
        <div class="card">Triage tickets</div>
        <div class="card">Review PR</div>
      </div>
      <div class="col">
        <div class="card active">Design spec</div>
      </div>
      <div class="col">
        <div class="card">Ship v2.1</div>
      </div>
    </div>
  </div>

  <!-- Beat 3: SVG logo draw — composed, not an <img> -->
  <div class="beat" id="b03">
    <svg viewBox="0 0 200 200"><path class="mark" d="..." /></svg>
  </div>
  <!-- more beats — each a composed scene with its own visual world -->
</div>
```

If you ever find yourself writing `<img src="capture/assets/...">` as a beat's primary visual where the asset is a product-UI screenshot, stop. That's the slideshow pattern this skill exists to break. Build the element from divs and CSS using the brand colors from DESIGN.md. The legitimate `<img>` uses are: (a) the brand logo when it's purely raster, (b) a hero illustration layered as ambient depth behind composed content, (c) a gradient/texture image as a background wash. Never a product UI screenshot as the load-bearing visual.

```css
.beat {
  position: absolute;
  inset: 0;
  width: 1920px;
  height: 1080px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  overflow: hidden;
}
```

```javascript
var beats = [
  { id: "b01", at: 0, dur: 1.8 },
  { id: "b02", at: 1.8, dur: 1.0 },
  // ...
];
beats.forEach(function (b) {
  var el = document.getElementById(b.id);
  if (b.id !== "b01") tl.set(el, { opacity: 1 }, b.at);
  gsap.set(el, { scale: 1.012 });
  tl.to(el, { scale: 1, duration: 0.25, ease: "power2.out" }, b.at);
  if (b !== beats[beats.length - 1]) tl.set(el, { opacity: 0 }, b.at + b.dur);
});
```

Each beat gets its own visual world — different background, different color, different energy. No two consecutive beats should look alike. Scale pulse (1.012→1.0) on every beat entry is subtle but felt.

If the storyboard says "slow" or "cinematic": build each beat as a sub-composition. Use long crossfades (0.8–1.2s `duration` with no `shader` key = CSS crossfade). Inside each beat, use continuous subtle motion — nothing is static:

- Slow camera drift on the composed scene root: `tl.fromTo(scene, {scale:1.05, x:20}, {scale:1, x:-20, duration: BEAT, ease:"none"})` (Ken-Burns style, but on your composed elements — not on a screenshot)
- Parallax text layers: `tl.fromTo(text, {y:30}, {y:-30, duration: BEAT, ease:"power1.inOut"})`
- 1–2s breathing room before text enters (don't animate everything at t=0)
- Soft easing: `expo.out` for entrances, `power1.inOut` for drifts

**Multi-scene index.html with HyperShader — for moderate/slow/arc pacing**

For videos with sub-composition beats and scene transitions, `index.html` MUST use `HyperShader.init()`. This is the entire scene orchestration layer. Do NOT try to use registry block sub-compositions (e.g. `compositions/domain-warp-dissolve.html`) for transitions — those are standalone showcase demos, not how HyperShader works in multi-scene compositions.

Copy the local shader build first:

```bash
cp packages/shader-transitions/dist/index.global.js <project-dir>/hyper-shader-local.js
```

Full working `index.html` pattern — every field matters:

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script src="hyper-shader-local.js"></script>

<div id="root" data-composition-id="main" data-start="0" data-duration="TOTAL"
     data-width="1920" data-height="1080">

  <!-- Host divs: MUST have both id AND data-composition-id matching the same value.
       HyperShader.init() uses getElementById() — without id="beat-1" it fails with
       "scene ids not found in DOM". -->
  <div id="beat-1" class="scene"
    data-composition-id="beat-1-hook"
    data-composition-src="compositions/beat-1-hook.html"
    data-start="0"        <!-- transition INTO this beat starts here -->
    data-duration="4.5"   <!-- must match the GSAP BEAT constant in the composition -->
    data-track-index="1"
    data-width="1920" data-height="1080"
    style="background: #YOUR_BEAT_BG_COLOR;"><!-- background here OR in sub-comp CSS — both work -->
  </div>

  <div id="beat-2" class="scene"
    data-composition-id="beat-2-features"
    data-composition-src="compositions/beat-2-features.html"
    data-start="4.0"
    data-duration="5.5"
    data-track-index="2"  <!-- use sequential track indices (1,2,3...) to avoid linter errors -->
    data-width="1920" data-height="1080"
    style="background: #YOUR_BEAT_BG_COLOR;">
  </div>

  <!-- ... more beats ... -->

  <!-- ALWAYS add a dummy s-end scene as the LAST entry.
       HyperShader renders scenes[N-1] as black in some contexts.
       s-end is invisible — it just prevents your CTA from being last. -->
  <div id="s-end" class="scene"
    data-composition-id="s-end"
    data-start="TOTAL_MINUS_0.1"
    data-duration="0.1"
    data-track-index="N"
    data-width="1920" data-height="1080">
  </div>

</div>

<script>
  window.__timelines = window.__timelines || {};
  var tl = HyperShader.init({
    bgColor: "#000000",
    accentColor: "#YOUR_ACCENT",
    scenes: ["beat-1", "beat-2", "beat-3", ..., "s-end"],
    transitions: [
      { time: 4.0, shader: "sdf-iris", duration: 0.7 },    // WebGL shader
      { time: 9.5, duration: 0.5 },                         // CSS crossfade (no shader)
      // ... one transition per scene boundary ...
      { time: TOTAL_MINUS_0.1, duration: 0.1 }              // dummy → s-end
    ],
  });
  // Add ALL beat animations to the returned tl AFTER init()
  window.__timelines["main"] = tl;
</script>
```

**Track index and the linter:** Use sequential track indices (`data-track-index="1"`, `"2"`, `"3"`...) for each beat — NOT all on track `"1"`. The linter flags overlapping clips on the same track as an error, and HyperShader compositions always have overlapping beats (the transition window). Using sequential indices silences the linter; HyperShader manages which scene is VISIBLE via opacity regardless of track index.

**Scene background colors:** setting `style="background: #3139FB"` on the host `<div id="beat-1">` in index.html is the simplest pattern — it's visible at a glance from the root file. Setting background inside the sub-composition's CSS also works. Either is fine; host div is preferred for clarity.

**Critical: beat host divs must have sequential `data-start` and matching `data-duration`.** Do NOT set `data-start="0"` on all beats — the render engine seeks each beat's GSAP timeline to `global_time - data_start`. At t=10s with `data-start=0`, a 5.5s timeline is seeked past its end and all content disappears.

`data-duration` must match the GSAP `BEAT` constant in the composition (the length of the sub-composition's internal timeline). If the two disagree, animations get cut off.

**Storyboard Beat Timing section** tells you both values — use them directly:

- `data-start` = "Transition in at:" value from the storyboard
- `data-duration` = "GSAP duration:" value from the storyboard

**Font handling:** Common fonts are auto-resolved by the renderer: use `"Inter"` (not `"Inter Variable"` — the compiler only maps the base name), `"Roboto"`, `"JetBrains Mono"`, `"Poppins"`. If a composition uses `"Inter Variable"` it will log compiler warnings and may fall back incorrectly — always use `"Inter"`. Only brand-specific fonts (GT Walsheim, Aeonik, etc.) need `@font-face`. Check `capture/assets/fonts/` — hashed filenames are Google Fonts subsets that auto-resolve; recognizable filenames (e.g. `BrandSans-Bold.woff2`) are brand fonts that need `@font-face` declarations.

**Brand font @font-face:** If the storyboard's BRAND VALUES lists a brand-specific font with a path in `capture/assets/fonts/`, add the `@font-face` block at the top of each composition that uses it — sub-agents won't do this unless you tell them explicitly. Paste the exact `@font-face` declaration in the sub-agent prompt's BRAND VALUES section. Without this, every composition falls back to `system-ui` and the brand typeface never loads.

**⚠ ASSET PATHS — most common sub-agent mistake (5+ agents per run):** When a composition references a captured accent (logo, gradient layer, hero illustration), the path must be relative to the **PROJECT ROOT**, not to the composition file. `compositions/beat-N.html` lives one directory deep, but paths must be written as if from the root.

- ✅ `capture/assets/logo.svg`
- ❌ `../capture/assets/logo.svg`

The Studio preview server rewrites base URLs to the project root — `../` paths that seem to work locally will 404 in preview and in renders. Add this verbatim to every sub-agent prompt's RULES section.

## 3. Build each composition — USE SUB-AGENTS

**Before dispatching, re-read DESIGN.md and STORYBOARD.md.** You wrote these files earlier in the session and you think you remember them. You don't — not the exact hex values, not the specific font families, not the button border-radius, not the Do's/Don'ts. Re-read them now so you can paste accurate brand rules and beat specs into each sub-agent prompt.

**If your runtime supports parallel sub-agents** (Claude Code, Cursor, most agent frameworks): dispatch one sub-agent per beat — 3 to 4× faster than building sequentially. For 3+ beats, always dispatch in parallel. For 1–2 beats, sequential is fine.

**If your runtime does not support parallel sub-agents** (some Codex setups, serial-only models): build sequentially using the same context-packing template below. The template gives each build pass the same context a sub-agent would get — paste prev/this/next beat + brand values — so output quality is the same, just slower.

In either case, use the template. Do not skip it and build from memory.

Each sub-agent reads [beat-builder-guide.md](beat-builder-guide.md) — it has everything: rules, easing, file references, validation commands. **Do not try to paste all rules into the prompt yourself.** Instead, tell the sub-agent to read the guide file. You paste only the beat-specific context: the storyboard sections, brand values, and asset paths.

```
Build the composition for Beat N. Save to compositions/beat-N-name.html.

FIRST: Locate and read the beat-builder guide. Your CWD is the project directory, so
the skill lives outside it — run this to find it:

  find "$HOME" -path '*/website-to-hyperframes/references/beat-builder-guide.md' -maxdepth 10 2>/dev/null | head -1

Read that file end to end. It has your full workflow, all rules, easing vocabulary,
and file references. Follow its workflow exactly:
  build → lint (`npx hyperframes lint .`)
        → snapshot (`npx hyperframes snapshot . --frames 3`)
        → view contact sheet AND read snapshots/descriptions.md
        → fix issues

After you finish, the main agent will READ your composition HTML top-to-bottom
and cross-check it against DESIGN.md and STORYBOARD.md — does the brand bg/accent
hex actually appear in your CSS, are the captured assets the storyboard called
for actually referenced, is the headline ≥80px, does the GSAP timeline cover
the full beat duration. Do the work honestly. Reports of "looks good" without
the work being done will be caught when the main agent opens the file.

═══ PREVIOUS BEAT (Beat N-1) ═══
[paste the FULL previous beat section from STORYBOARD.md]

═══ THIS BEAT (Beat N) ═══
[paste the FULL beat section from STORYBOARD.md — this IS the build spec]

═══ NEXT BEAT (Beat N+1) ═══
[paste the FULL next beat section from STORYBOARD.md]

═══ BRAND VALUES (from DESIGN.md) ═══
Colors:
  --bg:        #[hex]   primary background
  --fg:        #[hex]   primary text
  --accent:    #[hex]   CTA / highlights
  --surface:   #[hex]   card / panel backgrounds
  [add more if needed]

Fonts:
  Headlines: [font family], [weight]
  Body:      [font family], [weight]
  [brand font path if needed: capture/assets/fonts/Brand.woff2]

Key component styles:
  [paste relevant lines from DESIGN.md]

═══ CAPTURED ASSETS FOR THIS BEAT ═══
[Paste ACTUAL file paths + descriptions from asset-descriptions.md:

- capture/assets/hero-dashboard.png — full-bleed product dashboard, dark theme
- capture/assets/logo.svg — brand wordmark, white on transparent

Do NOT say "see asset-descriptions.md". Paste the paths here.]
```

The storyboard beat already contains everything — the concept, the visual choreography with exact timings, the CSS values, the SFX cues. The sub-agent's job is to translate that description into working HTML/CSS/GSAP, not to re-invent the creative direction. If you want, you can also paste any other relative and useful context to subagents if think it's good, why not.

### Per-composition process

For each beat:

**1. Read the storyboard beat.** The storyboard IS the build spec. It tells you what elements exist, how they enter, what they do during the beat, and how they exit. Follow it. If something in the storyboard isn't clear or seems impossible, research how to do it or ask — don't silently skip it.

**2. Build the static end-state first.** Position every element at its most visible moment. HTML+CSS only, no GSAP yet. The CSS position is the ground truth.

**3. Add the animation sequence.** Follow the storyboard's choreography — it specifies what happens and when. Use `tl.fromTo()` (not `tl.from()`) for entrances. Build the timeline in the order the storyboard describes.

**4. Add exit** (if CSS transition out). If shader transition — no exit animation needed.

**5. View the result.** After building, take a snapshot of this beat at different timestamps (where things are supposed to happen, animate, move and etc) and look at it from all angles, corners and positinos. Is the frame full and everything is exactly where it supposed to be? Are you sure??? Are elements readable? Does it match what the storyboard describes?

### Technical rules

- **No `repeat: -1`** — calculate exact repeats from beat duration
- **No `Math.random()`** — use a seeded PRNG
- **No bare `gsap.to()`** — all tweens on `tl`, never standalone
- **No full-screen dark linear gradients** — H.264 banding
- **Minimum fonts**: 80px+ headlines, 20px+ body
- **WCAG contrast on gradient backgrounds:** The contrast validator samples actual background pixels under the text element — if the background is a gradient image, darker parts of the image make the measured ratio _worse_ when you darken the text color, not better. Fix: either place text over a solid-color zone, or add `data-layout-ignore` attribute to decorative labels that don't need WCAG compliance. Don't blindly darken text color when the background isn't solid.

## 4. After all compositions are built — reconciliation check

Before moving to Step 6, run this sanity check:

```bash
# List every file in compositions/ and verify each one has a host div in index.html
ls compositions/
```

For every `.html` file in `compositions/`, confirm that `index.html` has a `data-composition-src="compositions/<filename>"` pointing to it. If any composition file is not referenced in `index.html`, add the missing host div now — an unreferenced composition is completely invisible at runtime.

**Captions stub rule:** Never create a `compositions/captions.html` with an empty transcript (`const script = [];`). If the VO/transcript step was skipped or failed, do not create the captions composition at all. An empty captions file that returns immediately is worse than no captions file — it silently does nothing and wastes a track slot.

### Parallel sub-agent snapshots are stale — re-snapshot after all complete

When you dispatch sub-agents in parallel (one per beat), each sub-agent snapshots a project where sibling beats may not exist yet. Their per-beat snapshots are valid for THEIR beat in isolation, but **any snapshot at a beat boundary or during a shader transition will show the wrong content** — typically the previous beat's content because the next beat hasn't been built.

Example: Beat 6's sub-agent took a snapshot at t=25.7s and saw Beat 1's content because Beat 5 didn't exist yet when Beat 6's sub-agent ran. The sub-agent reported this as "shader transition behavior showing previous scene" — a plausible-sounding but wrong diagnosis.

**Required after all sub-agents complete:**

```bash
node /<repo-root>/packages/cli/dist/cli.js snapshot <project-dir> --frames <N>
```

where N follows the snapshot formula: `max(beats × 3, ceil(duration_seconds / 2))`. This is the canonical snapshot that Step 6's DoD uses — not any individual sub-agent's intermediate snapshots.

Sub-agents' snapshots are still useful as per-beat sanity checks, but they are not the deliverable. The post-completion snapshot is. Don't skip it because "the sub-agents already snapshotted."

## 5. Read each beat HTML top-to-bottom — REQUIRED gate before Step 6

**This gate is non-skippable.** "I read it and it looks fine", "the sub-agent confirmed", "the snapshots look right" are NOT acceptable. Snapshots are 3 frames out of 300+ in motion — they hide everything that goes wrong between them.

**Why this gate exists:** Earlier sessions had sub-agents reply "looks good, 0 errors" and the main agent trusted them — that's how videos shipped with mismatched colors, missing logos, headlines too small to read, and SFX firing 1 second late because the agent typed timestamps "by eye" instead of computing them.

For each `compositions/beat-N.html`:

1. **Open the file and read it top-to-bottom.** Not a glance. Not a grep. Read the `<style>` block, then the markup, then the `<script>` block.
2. **Fill in this evidence block — every line, with quoted values from the file:**

```
Beat N: compositions/beat-N-NAME.html
  BG color in CSS:        <hex from line Y>      ← quote the exact line
  Accent color in CSS:    <hex from line Z>      ← quote the exact line
  Headline font-size:     <px from line>         (≥80? yes/no)
  Headline font-family:   <stack from line>      (matches DESIGN.md? yes/no)
  @font-face src paths:   <list>                 (each path exists? yes/no)
  Captured assets used:   <full list of paths from <img src=>, inline SVG ids, background-image url()>
  Storyboard called for:  <list from STORYBOARD.md beat N>
  Assets match storyboard? yes/no — if no, specify the gap
  GSAP first event:       tl.X("...", {...}, <t>)   beat-local t=<num>
  GSAP last event:        tl.X("...", {...}, <t>)   beat-local t=<num>
  Beat duration:          <N>s                   (events span full duration? yes/no)
  SFX trigger:            <element> data-start=<num>
  Storyboard SFX line:    "<quote the line>" → expected t=<num>
  SFX timestamp matches?  yes/no — if no, specify the drift
  Technical gates:        data-composition-id matches window.__timelines key? yes/no
                          script INSIDE <template>? yes/no
                          no Math.random / no repeat:-1 / no bare gsap.to? yes/no
  VERDICT: PASS / FIX (specify exactly what)
```

If you cannot fill any line (e.g., "I see no SFX trigger" or "headline font-family not specified"), that IS a finding — fix or escalate, don't paper over.

3. **Open each frame in `snapshots/beat-N/`** and confirm visually that entrance/hold/exit match the storyboard.

**Anything off — fix it inline (small CSS/GSAP correction) or re-dispatch the sub-agent with the specific problem quoted.** Do not move to Step 6 until every beat has its evidence block filled and PASS.

### SFX timestamp computation — compute, don't eyeball

Every SFX `data-start` value MUST be computed from STORYBOARD.md, not estimated visually.

For each SFX entry:

1. Storyboard names beat-local time (e.g. "Beat 2 at 1.2s into the beat").
2. Get the beat's global start time from beat ordering (e.g. Beat 1: 0–3.5s → Beat 2 starts at 3.5s globally).
3. Add beat-local + global start: `3.5 + 1.2 = 4.7s`.
4. Write `data-start="4.7"` in index.html.

**Forbidden:** writing `data-start="<approximate visual moment>"` by reading the storyboard and estimating by eye. The evidence block above MUST quote both the storyboard SFX line and the index.html `data-start` line — and confirm they match within ±0.1s (≈3 frames at 30fps; same tolerance `w2h-verify.mjs` enforces and `step-6-validate.md` uses for playback verification). A 1-second drift is not a rounding error; it's a build failure.

### Surface recurring sub-agent workarounds to the user

When 2+ sub-agents independently report the same workaround (e.g., "I had to base64-encode the data URI because the linter false-positives on inline SVG"), that's a tooling bug worth surfacing. List these in your Step 5 final report under "Tooling issues encountered" even if each instance was resolved. Format:

```
TOOLING ISSUES (worth filing):
- 3 sub-agents (beats 1, 4, 6) hit `root_missing_composition_id` false positive on
  inline SVG data URI in CSS. Workarounds: base64 (beat 1), removed overlay (beats 4, 6).
  Worth filing as a regression against packages/core/src/lint.
```

Burying recurring workarounds means the next session hits the same bug and works around it again. Don't.

### Brand-defaults check (whole-video, after every beat passes its own read)

These are defaults for most brand videos, not hard requirements:

- First beat references the brand logo / wordmark SVG from `capture/assets/svgs/`
- Last beat references the brand logo / wordmark
- The site's signature visual (hero illustration, gradient wave, distinctive UI mark) shows up at least once

If any are missing, check the storyboard — if STORYBOARD.md deliberately delays brand reveal or omits the signature visual for a concept reason, that's fine. If the omission was unintentional, fix it (or ask the main agent / user before adding).

Once every beat reads clean, move to Step 6 (Validate & Deliver) for lint, validate, snapshots, and visual review.
