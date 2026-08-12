# Component quality bar

What a catalog component has to be for us to keep shipping it. Every criterion here comes from a
defect found and verified on this branch, not from taste.

A registry component is a motion primitive an author installs into their own composition and
ships. The catalog page is marketing; the installed file is the product. Every criterion below is
therefore evaluated against **the item's own `<name>.html`, mounted alone**, never against
`demo.html` and never against the catalog page, because both of those carry scaffolding the author
does not receive.

Read this before auditing, scoring or cutting anything. It exists so several people auditing in
parallel reach the same verdict on the same item.

## The one rule

> An item earns its place when the file the author installs, mounted by itself on the ground it
> was designed for, renders the subject its name promises and moves the way its description says.
> Anything that fails that and cannot be fixed into something no other item already does is cut.

## How an audit runs

Two passes, in this order. The mechanical pass is free and runs across every item in seconds; the
visual pass costs a browser and eyes, so it is spent only on what the mechanical pass could not
decide. A mechanical signal is a **candidate**, never a verdict.

| Pass           | Cost           | Decides                                                                                  |
| -------------- | -------------- | ---------------------------------------------------------------------------------------- |
| **Mechanical** | grep and hash  | duplicates, missing timeline, banned hexes, empty markup, name gaps, unbounded variables |
| **Visual**     | render and eye | renders at all, implements its description, legible, deterministic                       |

`hyperframes check` is not a visual gate. It passes compositions that render nothing: a blank plot
produces no error, no warning and no layout finding, because an empty render is a valid render. No
criterion below may rest on `check` alone.

### The mount harness

Three ways to get a false verdict from a working item, all of them the harness's fault. Build the
shell like this or the audit invents defects.

1. **Two shapes of item, two ways to mount.** If the file, with HTML comments stripped, contains a
   `data-composition-id`, it is a sub-composition: mount it with
   `data-composition-src="./<name>.html"` on a clip. If it does not, it is a snippet: paste it
   inline inside a `class="clip"` div. Inlining a sub-composition nests a document in a document
   and renders black, which reads exactly like a dead item.
2. **Use the item's own ground.** Take the background off its `demo.html` body rule. A snippet
   whose ink defaults to `#18181b` is a 16:1 headline on its own `#f7f7f8` and an invisible 1.5:1
   smudge on a dark stage. The stage is not evidence.
3. **Load GSAP and register a paused root timeline**, then snapshot with
   `hyperframes snapshot . --at 0.05,1.2,2.5,4.0 --no-end` and read the contact sheet.

An item whose own `data-duration` is shorter than the shell's will be blank in the last frames.
That is arithmetic, not a defect.

## Fatal, cut the item

Fatal means there is nothing worth keeping underneath the defect: no edit short of writing a
different item fixes it, or the fix produces something the catalog already ships. Cite the named
evidence; a fatal verdict without it does not count.

**F1. Does not implement its own description.** The markup contains no trace of the subject the
item is named and described for. Not "renders badly", but "the thing is absent from the file".
`ecosystem-constellation`, `hero-device-assemble` and `terminal-to-browser-deploy` are the same
file holding empty card divs with different headings.
_Check:_ read the markup, then swap the name for any other item's name. If nothing in the file
would have to change, the name is a label on a generic shell.
_Evidence:_ the named subject has no element (no nodes in a constellation, no terminal in a
terminal deploy).

**F2. Redundant duplicate.** Same **motion fingerprint** and same **markup skeleton** as another
item that survives. Fingerprint is the gsap call list with selectors neutralised, keeping props,
durations and eases; skeleton is the tag sequence with classes and text stripped. One wipe
currently ships eight times with the same properties, durations and easings; one word-stagger
ships seven times.
_Evidence:_ both hashes match a sibling, and the sibling wins the tie-break below.

**F3. Renders nothing.** Frames are blank, or the named subject never appears, with the item
mounted correctly on its own ground and its recipe applied.
_Evidence:_ four blank frames plus the cause, in the item rather than the harness: a missing
sibling asset, a `ReferenceError` in the console, a subject that never enters the viewport. A
frame-capture artifact that renders correctly live is a false alarm, so confirm on a real page
before recording it.

**F4. The description is a different item.** The frames show the promised event never happening: a
wipe that never reveals its second panel, a chart that draws no series. Not a wording gap.

**F5. Cannot be made seekable.** Frame N genuinely depends on frame N-1 with no closed form and no
bounded replay, and making it seekable would make it a different effect. Rare. Most accumulators
have a trivial rewrite, so reach for this only after establishing there is none; a seeded,
index-derived replacement for `Math.random()` is X7, not F5.
_Evidence:_ two snapshots of the same timestamp reached by different seek paths differ.

## Fixable, keep and repair

Real defects, but the item has a reason to exist that nothing else covers and the repair is
bounded. Log the specific fix, never "needs polish".

**X1. No timeline of its own.** No `__timelines` registration, so the installed artifact renders a
still frame while the catalog page looks fine, because the generator transplants the demo's
timeline into the preview. 97 of the 213 new components are in this state.
_Repair:_ fold the trailing `Timeline integration:` recipe into a real `<script>` that builds a
paused timeline and registers it. Roughly 10 to 15 minutes for a single-element item.
_Escalates to fatal_ only when there is no motion anywhere to fold in, which usually means F1 too.

**X2. Name claims a technique the code lacks.** Grep the code region, never the doc header: the
header's prose is full of the exact words you are looking for, and will report a match on an item
that has none.
| Name pattern | Must contain |
| -------------------------------- | -------------------------------------------------- |
| `spring-*` | `elastic`, `back.`, `bounce` or a custom spring ease |
| `mask-*`, `*-mask*` | `mask` or `clip-path` |
| `frosted*`, `*glass*` | `backdrop-filter` |
| `*3d*`, `*depth*`, `*orbit*`, `*camera*` | `perspective`, `rotateX`, `rotateY`, `translateZ` |
| `*-draw`, `*-trace`, `*stroke*` | `stroke-dash` or `pathLength` |
_Repair:_ add the technique, or rename the item. Renaming is often the honest fix.

**X3. Illegible.** At 1920x1080 on its own ground: text under 4.5:1, or a subject whose smallest
meaningful feature is under about 24px.
_Repair:_ one value step, per `placeholder-material.md`. Text never sits below L1.

**X4. Placeholder gradients.** The purple and blue palette standing in for content.
_Repair:_ the monochrome ramp. Already done across the catalog, so a new instance is a regression,
not a legacy defect.

**X5. Hardcoded ink, no theme token.** A literal colour on the item's own text or subject with no
`var(--...)` fallback chain, so it disappears when an author drops it on the opposite theme.
_Repair:_ route it through the theme token with the literal as fallback.

**X6. No markup of its own.** The file is a `<style>` and a `<script>` and nothing else, so
mounting it renders an empty box.
_Repair:_ ship sample markup, or declare it an attachment snippet in `registry-item.json` and give
the demo a host element.

**X7. Unseeded randomness.** Scatter derived from `Math.random()` rather than the element index.
_Repair:_ derive from the index.

**X8. Declared bounds it cannot honour.** A number variable with no `min`/`max`, so the control
offers values the item cannot express, or a default it can never return to.
_Repair:_ declare real bounds, or use a numeric field instead of a slider.

## Duplicates, which one survives

A group is the set of items sharing both hashes from F2. Exactly one survives, chosen in order:

1. **The one whose name describes what the shared motion actually does.** A group where one member
   is a directional wipe and the rest borrowed it keeps the directional wipe.
2. **Then the one with subject-specific markup.** More elements that only make sense for that
   name, not more elements.
3. **Then the one already on `origin/main`.** Removing a shipped item breaks installs.
4. **Never a member whose name claims something the shared implementation does not do.**
   `frosted-glass-wipe` has no `backdrop-filter`, `spring-scale-in` has no spring, `mask-reveal-up`
   has no mask, so none of those three is the survivor. Such a member is F2 and X2 at once, and X2
   cannot be fixed without breaking the group. If no member is honest, keep the plainest name.

**If every member of a group fails F1, the group is cut entire.** Do not preserve a survivor to
soften the count. Twelve names on one empty card shell is one bad item, not twelve, and keeping one
of them keeps the bad item.

Same motion with genuinely different subjects is not a duplicate. A bar chart, a line chart and a
dashboard populate can share a stagger; the subject is the item.

## Never cut

Protection is per criterion, not blanket. A protected item still answers every other row.

**N1. Load-bearing colour** is exempt from X4 only. `chromatic-aberration-wipe` (the RGB split is
the effect), `confetti` (multi-hue is the celebration), `matrix-decode` (green is its identity),
`mesh-gradient-bg` (the gradient is the subject), `multi-device-splay`. `us-map`'s gradient is a
sequential choropleth scale, which is colour carrying data.

**N2. Real product depiction** is exempt from X4 and F1. A Figma logo inside a Figma mock is not
slop; the HyperFrames wordmark in `logo-brand-close` is the subject. Judge the placeholder content,
not the depicted product.

**N3. Deliberate static** is exempt from X1. An item whose description promises no motion is not
failing X1. A style snippet or a passive overlay is allowed to sit still.

**N4. Environment sets** are exempt from F3. An item that is a backdrop rather than a shot is not
failing F3 for being calm. Measured PSNR between frames separates the two: sets score 45 or higher,
things that genuinely run score 17 to 24. Judge against the description.

**N5. A rest state that is the recipe's `from` state** is exempt from F3. `confetti` ships
`.particle` spans sitting at opacity 0 until the timeline fans them out. Still is not dead.

**N6. Attachment snippets** are exempt from F3. A text splitter has no markup by design. Grade X6.

**N7. The 36 items already on `origin/main`** are out of audit scope.

## Mechanical first pass

| Signal              | How                                                                                   | Maps to |
| ------------------- | ------------------------------------------------------------------------------------- | ------- |
| No timeline         | `grep -L __timelines` over each composition                                           | X1      |
| Duplicate           | motion fingerprint AND markup skeleton hashes, matched pairwise                       | F2      |
| Empty shell         | markup skeleton matches an unrelated item, or is `<h3>` + `<p>` + generic panels only | F1      |
| No markup at all    | element count of the comment-, style- and script-stripped file is 0                   | X6      |
| Placeholder palette | grep the six banned hexes                                                             | X4      |
| Name gap            | the X2 table, grepped over the code region only                                       | X2      |
| Unbounded number    | read `min`/`max` in `registry-item.json`                                              | X8      |
| Non-determinism     | grep `Math.random`, `Date.now`, `performance.now`, `requestAnimationFrame`            | X7, F5  |

## Visual pass, required for a verdict

Render at least four frames across the duration from the **composition**, not the demo, mounted per
the harness rules above, and look at them. Then, for anything not scoring clean, confirm on the
real catalog page before recording it.

Record per item: the criteria it fails, the evidence you saw, and fatal or fixable. An unviewed
item is not a pass.

## Calibration

Ten items scored with this rubric, frames rendered and looked at. Three of them corrected the
rubric rather than the other way round.

| Item                         | Expected   | Frames actually showed                                                                                                    | Verdict            |
| ---------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `ecosystem-constellation`    | fatal      | Sidebar with three pill buttons and three empty white panels. No nodes, no edges. Identical at all four timestamps.       | **Cut** F1, F2, F4 |
| `terminal-to-browser-deploy` | fatal      | Pixel-identical to the above, only the `<h3>` and one subtitle differ. No terminal, no browser.                           | **Cut** F1, F2, F4 |
| `frosted-glass-wipe`         | fatal      | One card reading "Before", static, forever; the "After" panel stays clipped. Recipe byte-identical to `directional-wipe`. | **Cut** F2, F4, X2 |
| `char-slam-explode`          | pass       | Letters scattered at 0.05s, assembled into "Impact" by 1.2s, held. Real per-character motion.                             | **Keep**           |
| `echo-trail`                 | pass       | Card travels left to right with a decaying blurred echo trail behind it. Legible on its own light ground.                 | **Keep**           |
| `logo-brand-close`           | pass       | "H" resolves into the full wordmark, tagline and URL land after it. Staged, legible.                                      | **Keep**           |
| `blur-in`                    | borderline | Still, but the still is the correct rest state: legible headline, unique implementation, theme-token ink.                 | **Keep**, X1       |
| `spring-scale-in`            | borderline | Legible on its own `#f7f7f8`. Ease is `power3.out`, no spring anywhere. Shares its recipe with six others.                | **Cut** F2, X2     |
| `confetti`                   | borderline | Card and mesh, no particles visible. Source ships `.particle` spans the recipe fans out from opacity 0.                   | **Keep**, X1       |
| `bottom-up-letters`          | borderline | Four blank frames. The file is a splitter with no markup at all.                                                          | **Keep**, X6       |

Three corrections the calibration forced, all of them false cuts:

- `spring-scale-in` first scored X3 at roughly 1.5:1. That was the harness's dark stage, not the
  item. Hence "use the item's own ground".
- `confetti` first scored F3. Its rest state is its recipe's `from` state. Hence N5.
- `char-slam-explode` first scored F3 with four black frames. It is a sub-composition and was being
  inlined. Hence the two-shapes rule.

A rubric that cuts a working item is wrong even when the verdict is convenient.

## Checklist

Per item, in order. Stop at the first fatal.

- [ ] Mounted the right way for its shape, on its own ground, with GSAP and a paused root.
- [ ] F1: the markup contains the named subject.
- [ ] F2: motion fingerprint and markup skeleton are not both shared with a survivor.
- [ ] F3: it renders something with the recipe applied, or it is protected by N3 to N6.
- [ ] F4: the frames show the event the description promises.
- [ ] F5: frame N is computed from N.
- [ ] X1 through X8 logged with the specific fix.
- [ ] Verdict cites the evidence the criterion names, not an impression.
