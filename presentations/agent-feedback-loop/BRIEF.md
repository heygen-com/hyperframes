---
workflow: slideshow
flow: automation
storyboard: no
message: "Put the HyperFrames feedback command inside the agent's existing verification loop, and every render becomes a structured learning opportunity."
destination: internal-heygen-presentation
aspect: 1920x1080
language: en
audience: "HeyGen engineering, product, and developer-experience teams"
length: "10-12 slides, approximately 12 minutes"
angle: evidence-led-product-loop
---

## Intent

Create a fully English, internally presentable HyperFrames deck explaining how the CLI turns the normal AI-agent video workflow into a reliable user-feedback loop. Start with the workflow agents already follow—author, lint/check, inspect frames, get approval, render—then show the leverage of inserting `hyperframes feedback` immediately after verified output. Keep the explanation accessible to engineers and non-engineers, with source-backed Mermaid-style flow diagrams and real PostHog evidence.

## Assets

- HyperFrames repository source and `DESIGN.md` — implementation truth and brand system.
- HyperFrames CLI feedback documentation and agent skills — exact command, privacy model, cadence, reproduction packet, and structural census behavior.
- Authenticated PostHog project 356858 aggregate analysis — feedback per day/week and defensible before-versus-after comparisons; never include authored feedback text or user-level records.

## Customizations

- Use the HyperFrames dark brand palette, TT Norms Pro-style typography, IBM Plex Mono for command surfaces, flat bordered panels, and deliberate green/blue/purple accents.
- Include a clear old-loop versus instrumented-loop diagram, a compact rollout timeline, and a data story that distinguishes instrumentation correctness from observed adoption.
- Include presenter notes with source references and definitions for every metric.
- Deliver a live navigable slideshow with per-slide review snapshots rather than treating the deck as a single MP4 render.

## Notes

- Internal audience; concise, technical, and candid rather than promotional.
- Do not invent PostHog numbers. Use only the verified aggregate-only union of legacy `survey sent` / `render_satisfaction` and current `cli_render_feedback`, with America/Los_Angeles windows and no raw feedback output.
- Do not include raw feedback comments, file paths, project names, identities, IP addresses, or other sensitive fields.
- No narration, music, or extra media unless explicitly requested later.
