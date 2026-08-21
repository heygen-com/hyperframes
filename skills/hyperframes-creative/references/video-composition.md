# Video Composition

Video frames are not web pages. Use these rules for design-led compositions while respecting the requested format, brand, and scope. Minimal technical compositions and intentionally sparse formats may need less detail.

## The Design Spec Is Brand, Not Layout

The design spec (`frame.md` or `design.md`) defines what the brand looks like: colors, fonts, personality, constraints. It does NOT define how to compose a video frame. Use brand colors at video-appropriate intensity — not at web-UI opacity.

**Strict from the design spec:** hex values (including background color), font families, weight relationships, Do's and Don'ts. If the user chose a light canvas, use a light canvas. If they chose dark, use dark. Do not override their palette.

**Adapt for video:** type sizes, spacing, decorative opacity, border weight, component treatments. A web UI card at `border: 1px solid #e2e3e6` with `box-shadow: 0 2px 4px rgba(0,0,0,0.06)` is invisible on video. The brand color is sacred; the application is yours.

## Density

Choose density from the message and format. A brand or sizzle frame often needs several visual roles to feel produced; a lower-third, logo sting, or static title may need only a few.

For a scene that should feel layered, plan these roles:

- **Background treatment** — radial glow, oversized ghost type, color panel, grain, grid, or an intentionally flat field justified by the concept.
- **Midground content** — the actual message. Cards, stats, code blocks, images.
- **Foreground accents** — dividers, labels, data bars, registration marks, monospace metadata. The details that make it feel produced, not generated.

For produced marketing frames, roughly 6–10 visual roles can be a useful starting point, not a contract. Add decoration only when it reinforces hierarchy, motion, or the concept. Decorative treatment must not become new user-facing content, new scenes, or unrequested claims.

## Color Presence

Muted is fine. Flat is not. Every scene should have at least one color that pulls the eye.

- Brand accent should be VISIBLE — not a 5% opacity glow lost in compression. 15-25% for atmospheric, full saturation for focal elements.
- **Light canvases work differently than dark.** On dark: accent glows pop naturally. On light: use bolder borders (2px+ solid), stronger structural elements (rules, dividers), and full-saturation accent hits. Light backgrounds need texture (subtle grain, patterns) to avoid the "blank slide" feel. Don't switch to dark — make light cinematic.
- **No full-screen linear gradients on dark backgrounds.** They band visibly under H.264 compression. Use a radial gradient, a solid fill, or solid + localized glow instead.
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
