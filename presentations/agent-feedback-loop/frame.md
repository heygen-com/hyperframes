---
name: HyperFrames Internal Signal Deck
canvas:
  background: "#0A0A0A"
  surface: "#141414"
  surface_alt: "#1A1A1A"
colors:
  heading: "#F5F5F5"
  text: "#E5E5E5"
  text_secondary: "#A0A0A0"
  text_tertiary: "#666666"
  border: "#2A2A2A"
  border_light: "#3A3A3A"
  brand: "#3CE6AC"
  brand_cyan: "#06E3FA"
  brand_green: "#4FDB5E"
  info: "#3B82F6"
  special: "#A78BFA"
  warning: "#FBBF24"
  danger: "#FB7185"
  ink: "#101010"
typography:
  display: "TT Norms Pro"
  body: "TT Norms Pro"
  mono: "IBM Plex Mono"
  display_weights: [500, 600, 700]
  body_weights: [400, 500, 600]
  mono_weights: [400, 600]
spacing:
  frame_padding_x: 120
  frame_padding_y: 88
  grid: 8
  content_gap: 32
  section_gap: 56
components:
  corner_radius: [6, 8, 12]
  border_width: [1, 2]
  shadows: none
  depth: "flat bordered surfaces with localized radial light only"
---

# Overview

This deck applies the repository's real HyperFrames dark design system at presentation scale. It should feel like the product's own telemetry became a cinematic technical briefing: precise, quiet, and visibly instrumented.

## The frame

- Use a dark canvas with a persistent 12-column technical grid, sparse registration marks, and one localized cyan-to-green signal path.
- Lead with asymmetric compositions anchored to edges. Center only the final command and isolated proof moments.
- Every slide needs at least two focal points: the claim plus a diagram, metric, terminal, or structural accent.
- Reserve the bottom-right 360×140 region for the slideshow navigation capsule.

## Typography

- TT Norms Pro is the brand voice. Use 72–104px for slide claims, 34–46px for explanatory copy, and 22–28px for labels.
- IBM Plex Mono is reserved for commands, event names, schema boundaries, dates, and technical metadata.
- Light-on-dark body copy uses generous line height and medium rather than heavy weight.

## Components

- Panels are flat: dark surface, 1–2px border, 8–12px radius, no shadow.
- Flow nodes use hard directional connectors and small uppercase mono labels; they should read like a system diagram, not a web card grid.
- Data bars and series use solid fills or localized gradients only. Never use a full-screen linear gradient.
- The real cyan→green mark gradient is allowed for the logo, the feedback insertion node, and one closing signal line.

## Motion

- Slides hold; navigation provides the rhythm.
- Within a slide, claims reveal first, then the proof element 160–260ms later.
- Diagram connectors draw left-to-right; feedback insertion snaps into the existing path; metric bars fill rather than float.
- Keep motion finite and seekable. Ambient grid drift, when used, is a slow finite translate on a decorative layer.

## Do

- Make every slide's headline a complete, defensible sentence.
- Use source dates, event names, and command syntax exactly.
- Distinguish verified facts, measured results, and pending queries visually.
- Keep privacy boundaries legible and explicit.

## Do not

- Do not use generic glassmorphism, heavy shadows, neon glow wallpaper, identical card grids, pie charts, or dashboard density.
- Do not invent PostHog values or imply causality from a simple before/after comparison.
- Do not show raw feedback text, identifiers, paths, project content, environment values, or user-level records.
- Do not let a green accent imply that a pending metric has already passed.
