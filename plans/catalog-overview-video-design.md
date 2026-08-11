# Catalog overview video design

## Goal

Make the Catalog overview immediately understandable without asking a reader to
scan a long page. The page should lead with a short, silent HyperFrames montage
that shows every Catalog section and a strong item from each section, then give
the minimum explanation needed to start using an item.

## Approved direction

Use a curated HyperFrames montage rather than a browser tour or a multi-item
mosaic. The montage keeps the Catalog work itself full-frame, remains legible at
Mintlify content width, and does not couple the film to the current docs chrome.

## Page structure

The revised `docs/catalog/index.mdx` contains, in order:

1. One sentence explaining that the Catalog provides reusable visuals.
2. A 16:9 muted, autoplaying, looping preview of the Catalog montage.
3. Two compact destination cards:
   - **Blocks** — larger scenes and self-contained visuals.
   - **Components** — smaller effects and behaviors used inside a scene.
4. A three-step shortest path: choose an item, replace its example content, and
   review it in the complete video.
5. The existing related-topic links, trimmed to the three useful destinations.

The current six-category card grid, six-step workflow, and quality checklist are
removed. The sidebar already exposes every section, and the film supplies the
visual orientation those repeated summaries were trying to provide.

The loop is a preview, not a film a reader watches intentionally, so the page
uses one plain `<video>` with `muted`, `autoPlay`, `loop`, `playsInline`, and a
poster. It does not use `DocsVideo` or native controls.

## Video structure

- **Format:** 1920×1080, true 60 fps, H.264 MP4, silent.
- **Length:** approximately 20 seconds; short enough to understand in one loop.
- **Pacing:** hard cuts and a small number of match cuts; no fades that waste the
  brief viewing time.
- **Labels:** every beat includes the exact Catalog section name in a consistent
  upper-left label. The visuals remain primary.
- **Coverage:** all 11 navigation sections appear once, in sidebar order:
  Code Animations, Captions, HTML-in-Canvas, Social Overlays, Lower Thirds,
  Shader Transitions, CSS Transitions, Showcases, Data, Effects, and Blocks.
- **Selection rule:** one primary item per section, with a second item only when
  both remain readable in the section's 1.5–2 second beat. Prefer motion that is
  immediately legible, visually distinct from adjacent beats, and representative
  of the section rather than merely new.
- **Loop seam:** the final Blocks beat cuts back to the opening Code Animations
  beat without a blank or title-card pause.
- **Accessibility:** the page includes a concise sentence naming the sections,
  so the video is not the only route to its information. Reduced-motion users
  see the poster rather than forced motion.

## Composition architecture

Build one task-scoped HyperFrames composition that owns the 11-beat timeline.
Each beat mounts a selected registry item from local source, so capture and
render never depend on runtime network access. A single overlay component owns
the section label, beat progress, and safe-area treatment.

The source project lives at `docs/video-sources/catalog-overview/` so later
Catalog changes can regenerate the film without reconstructing this task. The
composition is deterministic and seekable:

- timing is declared with HyperFrames clip attributes;
- any GSAP timelines are paused and registered on `window.__timelines`;
- no `Date.now()`, unseeded randomness, live fetches, or wall-clock playback;
- the final source project is committed with the docs change, not discarded
  after rendering.

The rendered MP4 and poster are uploaded through the existing
`scripts/upload-docs-images.sh` path under a versioned Catalog filename. The MDX
references the immutable CDN URLs.

## Verification

Before handoff:

1. Run HyperFrames lint and browser check on the composition.
2. Render and verify codec, dimensions, frame rate, duration, full decode, and
   absence of adjacent duplicate frames across intended motion beats.
3. Generate and inspect a contact sheet covering all 11 labeled sections.
4. Run the repository's targeted tests and `oxfmt --check` for changed files.
5. Run `mint validate` and `mint broken-links`.
6. Start Mintlify locally and inspect the exact `/catalog` route at desktop and
   narrow widths, including dark mode and reduced motion.
7. Send Miguel screenshots of the local page plus the final video/contact-sheet
   proof in the private DM thread.

## Error and fallback behavior

- The `<video>` has a poster so the page remains useful before media loads or
  when autoplay is blocked.
- The supporting copy names all sections and links to real Catalog destinations;
  a failed video never blocks navigation.
- If an otherwise strong registry item fails deterministic capture, replace it
  with the section's next-best representative instead of weakening render gates.

## Non-goals

- Reorganizing the Catalog sidebar or renaming sections.
- Redesigning individual Catalog item pages.
- Adding narration, music, browser chrome, or a Mintlify screen recording.
- Building a new custom React player for a plain muted preview loop.
