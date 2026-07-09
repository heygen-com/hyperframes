# Contributing a Block or Component to the Registry

Guide the user from idea to merged PR for a new registry block or component.

## Workflow

```
1. Clarify -> 2. Scaffold -> 3. Build -> 4. Validate -> 5. Preview -> 6. Ship
```

### Step 1: Clarify

Ask what they're building. The registry has two item types:

- **Block** (`registry/blocks/`, type `hyperframes:block`): a full standalone composition with fixed dimensions and duration. Caption styles, VFX effects, title cards, lower thirds.
- **Component** (`registry/components/`, type `hyperframes:component`): a reusable snippet with no fixed dimensions or duration. CSS effects, text treatments, overlays that adapt to any composition size.

Then ask:

- One-sentence description of the effect
- Visual reference (URL, screenshot, or description)
- Who uses this and when?

### Step 2: Scaffold

Create the registry structure:

**For blocks:**

```
registry/blocks/{block-name}/
  {block-name}.html
  registry-item.json
```

**For components:**

```
registry/components/{component-name}/
  {component-name}.html
  registry-item.json
```

**Naming convention:**

| Item name        | ID prefix | Example IDs            |
| ---------------- | --------- | ---------------------- |
| `cap-hormozi`    | `hz`      | `hz-cg-0`, `hz-cw-3`   |
| `cap-typewriter` | `tw`      | `tw-cg-0`, `tw-ch-0-5` |
| `vfx-chrome`     | `vc`      | `vc-canvas`            |

Use a 2-3 letter prefix. ALL element IDs must use this prefix to avoid collisions in sub-compositions.

**registry-item.json**: use the canonical templates in [templates.md](templates.md), block and component variants, both with all required fields.

### Step 3: Build

Apply the correct template based on type. See [templates.md](templates.md) for copy-paste starters.

#### Caption blocks

**Non-negotiable caption rules:**

- Font: **96px minimum** for proportional fonts. **64-72px acceptable for monospace** because wider characters need less size.
- Readability: `-webkit-text-stroke: 2-3px` OR multi-layer `text-shadow`
- Overflow: call `window.__hyperframes.fitTextFontSize()` on every group
- Karaoke: highlight active word with anime.js timeline calls at `WORDS[wi].start * 1000`
- Hard kill: add a zero-duration anime.js step at `g.end * 1000` that sets `opacity: 0` and `visibility: "hidden"` on EVERY group
- Never put a zero-duration show step and a separate hidden-from entrance step at the same position. Author the entrance as one explicit property-keyframe `.add()` so the initial and final values are in the same call.

**Anime.js caption idioms:**

```js
const tl = anime.createTimeline({ autoplay: false });

// Show immediately at the group start.
tl.add(groupEl, { opacity: 1, visibility: "visible", duration: 0 }, g.start * 1000);

// Entrance from scale 1.3 to 1 over 150ms.
tl.add(
  groupEl,
  {
    scale: [
      { to: 1.3, duration: 0, ease: "linear" },
      { to: 1, duration: 150, ease: "outBack(2)" },
    ],
  },
  g.start * 1000,
);

// Karaoke highlight.
tl.add(wordEl, { color: "#FFD700", scale: 1.1, duration: 60 }, WORDS[wi].start * 1000);
tl.add(wordEl, { color: "#FFFFFF", scale: 1, duration: 80 }, WORDS[wi].end * 1000);

// Hard kill.
tl.add(groupEl, { opacity: 0, visibility: "hidden", duration: 0 }, g.end * 1000);
```

**Non-default GSAP adapter path.** Existing or ported GSAP caption styles may keep `tl.to(...)`, `tl.set(...)`, and `tl.from(...)` patterns, but new contributions default to anime.js.

**Per-character animation** (typewriter, scramble):

- Wrap each character in `<span>` with ID `{prefix}-ch-{group}-{char}`
- Stagger via zero-duration anime.js `.add()` calls at computed intervals from word timestamps
- Cursors/decorative elements: use timeline steps at intervals, NOT CSS animation, so the effect is seekable

**Positioning variants:**

- Centered: `display: flex; align-items: center; justify-content: center;`
- Lower-third: `position: absolute; bottom: 100px; left: 0; width: 100%; text-align: center;`
- Left-aligned: `position: absolute; bottom: 100px; left: 120px; text-align: left;`

#### VFX blocks (Three.js)

- Use `three@0.147.0` from CDN (global script)
- Use anime.js by default: `anime.createTimeline({ autoplay: false, onUpdate: renderScene })`
- Call `renderScene()` once synchronously after creating the timeline for the initial paint before seek
- State proxy pattern: anime.js animates a plain JS object, the render function reads it
- Seeded PRNG (`mulberry32`) for randomness
- No `requestAnimationFrame`

#### All types

- `data-composition-id` should match the id passed to `hyperframesAnime.register(id, ...)`
- All element IDs prefixed with block abbreviation
- `anime.createTimeline({ autoplay: false })` by default
- Register with `hyperframesAnime.register(id, instance, { labels })`; labels are seconds
- Anime.js API timing is milliseconds: `duration`, `delay`, `loopDelay`, and timeline positions are all milliseconds
- HyperFrames `data-start`, `data-duration`, and anime registration labels are seconds
- One property owner per element across registered instances. Do not let two independently registered anime.js instances, or an anime.js instance and a GSAP timeline, animate the same property on the same element.
- No `Math.random()`, no `Date.now()`

> **Non-default GSAP adapter path.** GSAP remains accepted for existing and ported items. New registry contributions should set `"runtime": "animejs"` and use anime.js unless there is a specific adapter reason not to.

### Step 4: Validate

```bash
hyperframes lint                    # 0 errors required
hyperframes validate --no-contrast  # 0 console errors required
```

### Step 5: Preview

```bash
# Render preview video
hyperframes render -o preview.mp4

# Snapshot for visual QA
hyperframes snapshot --at "1.0,3.0,5.0,7.0"

# Publish to hyperframes.dev for review
npx hyperframes publish
```

**Catalog preview image**: The catalog card uses a PNG at `docs/images/catalog/{kind}/{name}.png` (where `{kind}` is `blocks` or `components`). Generate it from a snapshot, then:

- **HeyGen internal contributors:** run `scripts/upload-docs-images.sh` (requires AWS profile `engineering-767398024897`)
- **External contributors:** attach the preview MP4 to your PR description. A maintainer will generate and upload the catalog image before merging.

### Step 6: Ship

**All steps are required. Missing any one produces a broken catalog entry.**

`{kind}` is `blocks` or `components` depending on what you built in Step 1.

```bash
# 1. Create branch
git checkout -b feat/registry-{name}

# 2. Format HTML
npx oxfmt registry/{kind}/{name}/*.html

# 3. Update registry/registry.json: add entry to the "items" array:
#    { "name": "{name}", "type": "hyperframes:block" }  (or "hyperframes:component")

# 4. Generate catalog docs page
npx tsx scripts/generate-catalog-pages.ts

# 5. Publish to hyperframes.dev so reviewers can preview
npx hyperframes publish

# 6. Stage everything
git add registry/{kind}/{name}/ registry/registry.json docs/catalog/

# 7. Commit
git commit -m "feat(registry): add {name}: {one sentence}"

# 8. Push and open PR with hyperframes.dev link
git push origin feat/registry-{name}
gh pr create --title "feat(registry): {name}" --body "preview: {hyperframes.dev-url}"
```

**If you don't have a GitHub account:** you need one to open a PR. Sign up at https://github.com/signup, then run `gh auth login`.

## Quality Gate

- [ ] `hyperframes lint` -> 0 errors
- [ ] `hyperframes validate` -> 0 console errors
- [ ] `npx oxfmt --check` passes
- [ ] `registry/registry.json` updated with new entry
- [ ] `scripts/generate-catalog-pages.ts` run (docs page generated)
- [ ] `npx hyperframes publish` run (claim your project URL)
- [ ] Preview MP4 attached to PR (external) or catalog PNG uploaded (internal)
- [ ] All IDs unique and prefixed
