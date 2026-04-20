# Step 1: Capture & Understand

## Run the capture

Create a project directory for your video, then capture the website into a `capture/` subfolder within it:

```bash
npx hyperframes capture <URL> -o <project-dir>/capture
```

Example: `npx hyperframes capture https://stripe.com -o videos/stripe-launch/capture`

Keeping the capture artifacts (`screenshots/`, `assets/`, `extracted/`, `AGENTS.md`, `CLAUDE.md`) in a dedicated `capture/` subfolder keeps them isolated from the later build files (`SCRIPT.md`, `STORYBOARD.md`, `DESIGN.md`, `compositions/`, `index.html`, `narration.wav`, `transcript.json`, `renders/`, `snapshots/`), which all live at `<project-dir>/` root.

For exploratory captures that aren't becoming a video yet, `-o captures/<name>` at the repo root is fine — the isolation convention only matters when you're building a video on top of the capture.

No API keys required. The capture extracts design tokens, screenshots, fonts, and assets with DOM-context descriptions automatically.

**Optional:** Set `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) in a `.env` file at the repo root for richer AI-powered image descriptions via Gemini 3.1 Flash Lite vision (~$0.001/image).

Wait for it to complete. Print how many screenshots, assets, sections, and fonts were extracted.

## Read and summarize

Read each file below. After reading each one, **write a 1-2 sentence summary** of what you learned. These summaries are your working memory — the raw file content may be cleared from context later.

### Must read (do not skip)

1. **View the scroll screenshots** — viewport-sized captures covering the full page height (the number depends on the page length). Start with:
   - `capture/screenshots/scroll-000.png` — the hero section at full 1920x1080 resolution. This is the most important image. Describe: is the background light or dark? What's the dominant visual element? What colors jump out?
   - Then scan through the rest to see the full page. Each screenshot overlaps the previous by ~30%.

   After viewing them, write 3-4 sentences describing the site's visual mood, layout patterns, color strategy, and overall feel.

2. **`capture/extracted/tokens.json`** — Note the top 5-7 colors (HEX), all font families with their weights (e.g. `Inter (400,700)` or `Sohne (100-900 variable)`), number of sections, and number of headings/CTAs.

3. **`capture/extracted/visible-text.txt`** — Each line is prefixed with the HTML tag: `[h1] Heading`, `[p] Body text`, `[a] Link text`. Use these tags to understand hierarchy — headings are key messages, paragraphs are supporting copy. Strip the `[tag]` prefix when quoting text in the script.

4. **`capture/extracted/asset-descriptions.md`** — One-line-per-file summary of all downloaded assets. Note which assets are most visually striking or useful for video (hero images, logos, product screenshots).

### Read if they exist

5. **`capture/extracted/animations.json`** — Note if the site uses scroll-triggered animations, marquees, canvas/WebGL, or named CSS animations.

6. **`capture/extracted/lottie-manifest.json`** — View each preview image at `capture/assets/lottie/previews/` to see what the animations look like.

7. **`capture/extracted/video-manifest.json`** — View each preview at `capture/assets/videos/previews/` to see what each video shows.

8. **`capture/extracted/shaders.json`** — If present, this contains the actual GLSL shader code that powers the site's WebGL visual effects (gradient waves, particle systems, noise fields). Read the fragment shaders to extract: color values used in gradients, noise algorithms, blend functions. You can recreate similar effects in your compositions using Canvas 2D or by embedding the shader patterns with a `<canvas>` + WebGL context. See the Canvas 2D and procedural art patterns in `techniques.md`.

### On-demand (read when building scenes)

9. **Individual images in `capture/assets/`** — Use `capture/extracted/asset-descriptions.md` as your index. View specific images when you need them for a beat.

10. **`capture/extracted/assets-catalog.json`** — Use to find remote URLs when you need an asset that wasn't downloaded.

### For rich captures (30+ images)

Launch a sub-agent to view all images and SVGs:

> "Read every image in capture/assets/ and every SVG in capture/assets/svgs/. For each, write one line: filename — what it shows, dominant colors, approximate size. Return the complete catalog."

Use the sub-agent's catalog as your asset reference for the rest of the workflow.

## Gate

Print your site summary before proceeding to Step 2:

- **Site:** [name]
- **Colors:** [top 3-5 HEX values with roles]
- **Fonts:** [font families]
- **Sections:** [count] sections, [count] headings, [count] CTAs
- **Key assets:** [3-5 most useful assets for video]
- **Vibe:** [one sentence describing the visual identity]
