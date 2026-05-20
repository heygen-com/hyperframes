# Step 0: Capture & Understand the Brand

You're capturing the site **to understand a brand and a product** — not to inventory building blocks. Reading the assets tells you what the product is, who it's for, what voice the brand speaks in, and what mood it lives in. That understanding is the strategic foundation for the video; the assets themselves are decoration the storyboard will reach for late, only where they serve the concept. **The video is not a recombination of the captured assets.**

## Run the capture

No API keys required for the base capture. However, before running, ask the user:

> "For the best results, it is recommended to set a Gemini API key — it gives me AI-powered descriptions of every captured image, which helps me choose the right assets for each scene. It costs about $0.001 per image. You can skip this if you want, but the video quality will be better with it. To set it up: add `GEMINI_API_KEY=your-key` to a `.env` file in the project root. You can get a free key at ai.google.dev."

If the user provides the key or already has one set, proceed. If they skip it, proceed anyway — the capture works without it, but `asset-descriptions.md` will have DOM-context descriptions only (position, size, alt text) instead of AI vision descriptions (what the image actually shows).

Create a project directory for your video if it doesn't exist yet, then capture the website into a `capture/` subfolder within it:

```bash
# ⚠ ALWAYS use the local CLI — never `npx hyperframes capture`:
npx tsx packages/cli/src/cli.ts capture <URL> -o <project-dir>/capture
```

Example: `npx tsx packages/cli/src/cli.ts capture https://stripe.com -o videos/stripe-launch/capture`

Keeping the capture artifacts (`screenshots/`, `assets/`, `extracted/`, `AGENTS.md`, `CLAUDE.md`) in a dedicated `capture/` subfolder keeps them isolated from the later build files (`SCRIPT.md`, `STORYBOARD.md`, `DESIGN.md`, `compositions/`, `index.html`, `narration.wav`, `transcript.json`, `renders/`, `snapshots/`), which all live at `<project-dir>/` root.

For exploratory captures that aren't becoming a video yet, `-o captures/<name>` at the repo root is fine — the isolation convention only matters when you're building a video on top of the capture.

Wait for the capture to complete. Print how many screenshots, assets, sections, and fonts were extracted.

## Read and summarize

Read every file below. After each one, **write a 3-4 sentence summary** of what you learned. These summaries carry forward — the raw file content may be cleared from context later, and your summaries are what keep the capture data usable through the rest of the pipeline.

### Read these

1. **View the contact sheets — carefully, every cell, not a glance.** Contact sheets are labeled grids that let you see many images at once. They are paginated: look for `contact-sheet-1.jpg`, `contact-sheet-2.jpg`, etc. (or `contact-sheet.jpg` for older captures). View ALL pages for each category. **For each page, name at least 5 specific assets you can see in it before moving on** — this forces you to actually look at every cell instead of scrolling past. Past agents have reported "viewed the contact sheet" after literally one glance, then later in Step 3 they wrote beats using assets that didn't exist or missed the brand logo entirely. Don't be that agent. The contact sheet is your single best opportunity to learn what's actually available in the capture.
   - `capture/screenshots/contact-sheet-*.jpg` — scroll screenshots grid. View FIRST. Each cell numbered with scroll percentage. List the directory if unsure how many pages exist.
   - `capture/assets/contact-sheet-*.jpg` — all downloaded raster images grid. Each cell labeled with filename.
   - `capture/assets/svgs/contact-sheet-*.jpg` — all SVGs rendered as thumbnails. Each cell labeled with filename. Check `capture/assets/` root too — some captures store SVGs there instead of `svgs/`.

   After viewing the screenshot contact sheets, write 3-4 sentences describing the site's visual mood, layout patterns, color strategy, and overall feel. Then list, by filename, the 5-10 captured assets that look most promising for video use (logo, hero illustration, brand mark, gradient backgrounds, product art). **Open and view those promising assets individually** — the contact sheet thumbnails are too small to judge fine detail, but once you've narrowed to the 5-10 candidates, read each one carefully. Don't just trust the thumbnail.

2. **`capture/extracted/tokens.json`** — Note the top 5-7 colors (HEX), all font families with their weights (e.g. `Inter (400,700)` or `Sohne (100-900 variable)`), number of sections, and number of headings/CTAs.

3. **`capture/extracted/design-styles.json`** — Computed styles extracted from live DOM elements. Contains: typography hierarchy (every text role with exact font-size, weight, line-height, letter-spacing), button variants (background, padding, radius, shadow), card/container styles, navigation styles, spacing scale with base unit, border-radius scale, and box-shadow values with usage counts. This is your primary data source for writing DESIGN.md Sections 3-6.

4. **`capture/extracted/visible-text.txt`** — Each line is prefixed with the HTML tag: `[h1] Heading`, `[p] Body text`, `[a] Link text`. Use these tags to understand hierarchy — headings are key messages, paragraphs are supporting copy. Strip the `[tag]` prefix if quoting text in the script.

5. **`capture/extracted/asset-descriptions.md`** — One-line-per-file summary of all downloaded assets. Note which assets are most visually striking or useful for video.

6. **`capture/extracted/fonts-manifest.json`** — Each downloaded font identified by its real family name (read from the binary's OpenType `name` table, so hashed Next.js/Webpack filenames are resolved automatically). Lists per-family aggregates with weights, variable-font axes, and file counts. Read this in Step 1 instead of guessing fonts from filenames. If the manifest's `unidentified[]` is empty, every captured font has a known identity. Skip the file if it doesn't exist (older captures).

### Required to check and read IF they exist

7. **`capture/extracted/animations.json`** — See for yourself if the site uses scroll-triggered animations, marquees, canvas/WebGL, or named CSS animations. Just good to know.

8. **`capture/extracted/lottie-manifest.json`** — View each preview image at `capture/assets/lottie/previews/` to see what the animations look like. It will help you think of what you can do in the video.

9. **`capture/extracted/video-manifest.json`** — View each preview at `capture/assets/videos/previews/` to see what each video shows.

10. **`capture/extracted/shaders.json`** — If present, this contains the actual GLSL shader code that powers the site's WebGL visual effects (gradient waves, particle systems, noise fields). Read the fragment shaders to extract: color values used in gradients, noise algorithms, blend functions. You are able to recreate similar effects in your compositions using Canvas 2D, Three.js, HTML-in-canvas or by embedding the shader patterns with a `<canvas>` + WebGL context. Absolutely read the patterns in `techniques.md`!!

### Required On-demand (only when actually needed in Step 5)

11. **Individual images in `capture/assets/`** — The contact sheet pages cover all assets. Only open an individual file when:
    - You are placing text over a screenshot and need to check the safe zone / exact content at full resolution
    - A storyboard-assigned asset's contact sheet thumbnail is too small to judge its content

    Do NOT batch-view individual assets at this stage. That is what the contact sheets are for.

### For rich captures (30+ images)

If asset-descriptions.md has mostly bare descriptions (no AI vision — check if entries say things like 'icon: icon 0' instead of actual descriptions), launch a sub-agent to view and describe all of those.

## Carry-forward to Step 1

After reading `tokens.json` and `design-styles.json` here, **summarize the key values** (top colors, font families, key component styles) in your step-0 site summary. Step 1 reads your summary — it does NOT re-read these files. If your summary is thorough, Step 1 can write DESIGN.md without opening them again.

## Gate

Print your site summary before proceeding to Step 1. The summary is **strategy-first, not asset-first**:

- **Site:** [name]
- **What the product does:** [one sentence — the product's actual job, what problem it solves]
- **Who it's for:** [audience — developers, designers, ops teams, consumers, enterprise, etc.]
- **Core value prop:** [the one promise the homepage makes — what the brand is selling, in their own words if visible-text supports it]
- **Brand voice:** [one phrase — confident/playful/clinical/premium/urgent/etc., grounded in the copy you read]
- **Visual identity:** [one sentence — dominant mood, e.g. "dark cinematic with single saturated accent" or "white-and-color clean consumer"]
- **Colors:** [top 3-5 HEX values with roles]
- **Fonts:** [font families]
- **Sections:** [count] sections, [count] headings, [count] CTAs
- **Notable captured assets:** [3-5 assets worth remembering as potential brand accents — typically logo, hero illustration, gradient, brand mark. Note these are candidates, not assignments. Most won't make it into the final video.]

The first 5 bullets are the strategic frame — they tell you what video to make. The last 4 are the brand toolkit you'll inflect that video with.
