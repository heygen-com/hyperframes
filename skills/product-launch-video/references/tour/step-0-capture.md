# Step 0: Capture

The capture pipeline downloads the site and extracts structured data for the rest of the workflow to read. Step 0 is a single command plus a sanity check. **All analysis (reading files, viewing contact sheets, deriving brand voice, picking assets) happens in Steps 1–3, not here.**

## Run the capture

No API keys required for the base capture. However, before running, ask the user:

> "For the best results, it is recommended to set a Gemini API key — it gives me AI-powered descriptions of every captured image, which helps me choose the right assets for each scene. It costs about $0.001 per image. You can skip this if you want, but the video quality will be better with it. To set it up: add `GEMINI_API_KEY=your-key` to a `.env` file in the project root. You can get a free key at ai.google.dev."

If the user provides the key or already has one set, proceed. If they skip it, proceed anyway — the capture works without it, but `asset-descriptions.md` will have DOM-context descriptions only (position, size, alt text) instead of AI vision descriptions.

Create a project directory for your video if it doesn't exist yet, then capture the website into a `capture/` subfolder within it:

```bash
npx hyperframes capture <URL> -o <project-dir>/capture
```

Example: `npx hyperframes capture https://stripe.com -o videos/stripe-launch/capture`

Keeping capture artifacts (`screenshots/`, `assets/`, `extracted/`, `AGENTS.md`, `CLAUDE.md`) in a dedicated `capture/` subfolder keeps them isolated from later build files (`SCRIPT.md`, `STORYBOARD.md`, `DESIGN.md`, `compositions/`, `index.html`, `narration.wav`, `transcript.json`, `renders/`, `snapshots/`), which all live at `<project-dir>/` root.

For exploratory captures that aren't becoming a video yet, the default `./capture/` (or any `-o <name>` you pick) is fine — the isolation convention only matters when you're building a video on top of the capture.

## Confirm it succeeded

Wait for the capture to complete. Print one line summarizing what was captured:

> "Captured N screenshots, M assets, K SVGs, F fonts. Ready for Step 1."

If the command exited non-zero, the counts are all zero, or required directories (`extracted/`, `assets/`, `screenshots/`) are missing, surface the error and stop — don't advance to Step 1 with a broken capture.

## What lives in `capture/` (reference table — DO NOT read these here)

Each downstream step reads only what it needs. Don't pre-fetch everything in Step 0; that bloats context and produces summaries that get stale by the time they're used.

| Path                                      | First read in                                 |
| ----------------------------------------- | --------------------------------------------- |
| `capture/extracted/tokens.json`           | Step 1 (DESIGN.md — colors / fonts)           |
| `capture/extracted/design-styles.json`    | Step 1 (DESIGN.md — typography / components)  |
| `capture/extracted/fonts-manifest.json`   | Step 1 (font identification)                  |
| `capture/extracted/asset-descriptions.md` | Step 2 (brief grounding) and Step 3 (assets)  |
| `capture/extracted/visible-text.txt`      | Step 2 (brief) and Step 3 (script)            |
| `capture/assets/contact-sheet-*.jpg`      | Step 3 (asset picking)                        |
| `capture/assets/svgs/contact-sheet-*.jpg` | Step 3 (SVG / logo picking)                   |
| `capture/screenshots/contact-sheet-*.jpg` | Step 3 (visual mood reference)                |
| `capture/extracted/animations.json`       | Step 3 / Step 5 (only if site has animations) |
| `capture/extracted/lottie-manifest.json`  | Step 3 (only if site uses Lottie)             |
| `capture/extracted/video-manifest.json`   | Step 3 (only if site embeds video)            |
| `capture/extracted/shaders.json`          | Step 3 / Step 5 (only if site has WebGL)      |
| `capture/assets/<individual files>`       | Step 5 (only when placing a specific asset)   |

## Gate

Capture exits 0. Asset / screenshot / font counts non-zero. Proceed to Step 1.
