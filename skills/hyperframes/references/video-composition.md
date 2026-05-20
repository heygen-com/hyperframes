# Video Composition

Video frames are not web pages. These rules apply to every composition regardless of brand, style, or design.md.

## design.md Is Brand, Not Layout

design.md defines what the brand looks like: colors, fonts, personality, constraints. It does NOT define how to compose a video frame. Use brand colors at video-appropriate intensity — not at web-UI opacity.

**Strict from design.md:** hex values (including background color), font families, weight relationships, Do's and Don'ts. If the user chose a light canvas, use a light canvas. If they chose dark, use dark. Do not override their palette.

**Adapt for video:** type sizes, spacing, decorative opacity, border weight, component treatments. A web UI card at `border: 1px solid #e2e3e6` with `box-shadow: 0 2px 4px rgba(0,0,0,0.06)` is invisible on video. The brand color is sacred; the application is yours.

## Density

Density depends on the beat's purpose. A dramatic single-word reveal or a keynote-style hero moment can have 1-2 elements — that's intentional. A data showcase or feature grid should have 8-10. Match the storyboard's intent, not a number target.

Every scene needs:

- **Background texture** — radial glow, oversized ghost type, color panel, grain, grid. Never solid flat color.
- **Midground content** — the actual message. Cards, stats, code blocks, images.
- **Foreground accents** — dividers, labels, data bars, registration marks, monospace metadata. The details that make it feel produced, not generated.

Every scene should have content at all three layers — background, midground, and foreground — even a sparse beat. A 1-element hero moment isn't really 1 element if the background has a radial glow and the foreground has a corner label; it's a 1-element _focal point_ with two layers around it doing quiet work. That's different from a frame with one element and nothing else, which reads as unfinished.

Total element count follows from the storyboard's density spec for that beat. The thing to check for is whether all three layers are present, not whether the count hits a target.

## Color Presence

Muted is fine. Flat is not. Every scene should have at least one color that pulls the eye.

- Brand accent should be VISIBLE — not a 5% opacity glow lost in compression. 15-25% for atmospheric, full saturation for focal elements.
- **Light canvases work differently than dark.** On dark: accent glows pop naturally. On light: use bolder borders (2px+ solid), stronger structural elements (rules, dividers), and full-saturation accent hits. Light backgrounds need texture (subtle grain, patterns) to avoid the "blank slide" feel. Don't switch to dark — make light cinematic.
- Tint neutrals toward the brand hue. Dead gray reads as undesigned.

## Scale

Web sizes are invisible on video. Everything scales up.

| Element            | Web     | Video    |
| ------------------ | ------- | -------- |
| Headlines          | 32-48px | 64-120px |
| Body text          | 14-16px | 28-42px  |
| Labels             | 12px    | 18-24px  |
| Decorative opacity | 3-8%    | 12-25%   |
| Borders            | 1px     | 2-4px    |
| Padding            | 16-32px | 60-140px |

If you're writing a font-size under 24px in a video composition, justify it. If you're writing decorative opacity under 10%, it's invisible.

## Motion Intensity

Subtle reads as static at 30fps. Err toward more movement than feels safe.

- Every decorative element should have ambient motion: breathe, drift, pulse, orbit. Static decoratives feel dead.
- Vary motion per scene — don't repeat the same ambient pattern.
- Scene entrances should use 3+ different eases and directions. If every element enters from `y: 30, opacity: 0`, the scene has no choreography.

## Frame Composition

- **Two focal points minimum.** The eye needs somewhere to travel.
- **Fill the frame.** Hero text: 60-80% of frame width.
- **Anchor to edges.** Pin content to left/top or right/bottom. Centered-and-floating is a web layout pattern.
- **Split frames.** Data panel left, content right. Top bar with metadata, full-width below. Zone-based layouts over centered stacks.
- **Structural elements.** Rules, dividers, border panels. They create visual paths and animate well (`scaleX: 0` → `1`).
