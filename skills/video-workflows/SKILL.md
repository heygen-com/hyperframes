---
name: video-workflows
description: >
  Router for all video creation workflows. Use FIRST whenever the user wants to
  make a video — launch video, promo, explainer, tutorial, social ad, testimonial,
  feature reveal, hook reel, motion poster, or any "make me a video / create a /
  generate a video / build a [X] video" intent. Maps the request to the right
  workflow via an INPUT × OUTPUT-length decision table, and asks clarifying
  questions when the intent is under-specified. Always consult before invoking
  a specific workflow.
metadata:
  tags: router, index, video-workflows, intent-routing, disambiguation
---

# Video Workflow Router

The single entry point for "I want to make a video" intent. Routes to the correct workflow based on **INPUT type** and **OUTPUT length**. Asks clarifying questions when the request is under-specified.

This router knows ONLY top-level workflows. It does not load workflow-internal phases, domain skills (`hyperframes-*`), or technical references.

## Decision table

| Length / Input   | URL                     | Brief / text | Pre-written script | Existing footage |
| ---------------- | ----------------------- | ------------ | ------------------ | ---------------- |
| < 15s hook       | —                       | —            | —                  | —                |
| 15-30s ad        | —                       | —            | —                  | —                |
| **30-90s promo** | `/product-launch-video` | —            | —                  | —                |
| 2-5min tutorial  | —                       | —            | —                  | —                |
| 5min+ deep dive  | —                       | —            | —                  | —                |
| Static / loop    | —                       | —            | —                  | —                |

Currently `/product-launch-video` is the only workflow. Empty cells mean **no workflow exists for that combination** — tell the user so directly rather than picking a near-fit.

## Routing procedure

1. **Information complete** (you know INPUT type + target length) → pick the matching cell, invoke that workflow.
2. **Information incomplete** → ask at most 2 clarifying questions:
   - "What's your input — a URL, a brief, a pre-written script, or existing footage?"
   - "Target length — under 30s, 30-90s, 2-5 minutes, or longer?"
3. **No matching cell** → tell the user explicitly: "We don't have a workflow for this combination yet." Do NOT route to a wrong workflow as a fallback.

## Workflow descriptions (for disambiguation)

### `/product-launch-video`

- **Input:** Product URL (crawled with headless Chrome for assets, brand tokens, page structure)
- **Output:** 60-90s product launch / SaaS explainer / promo video as a HyperFrames composition rendered to MP4
- **Triggers:** "make me a launch video for X", "promo for our website", "explain my SaaS in a minute", "feature reveal for X.com", "marketing video for our product"
- **Do NOT use for:** tutorials, customer interviews, social ads under 30s, motion graphics without a product context, static brand assets

## Out of scope for this router

- **Domain skills** (`/hyperframes-core`, `/hyperframes-animation`, `/hyperframes-cli`, `/hyperframes-creative`, `/hyperframes-media`, `/hyperframes-registry`) — technical references loaded by a workflow's build phase, not user-triggered through this router.
- **Workflow-internal phases** — phases live inside each workflow's folder and are dispatched by that workflow's orchestrator, not by this router.

## Adding a new workflow

When a new video workflow lands at `skills/<workflow-name>/`:

1. Add a row / cell to the decision table above.
2. Add a description block under "Workflow descriptions" with **Input**, **Output**, **Triggers**, **Do NOT use for**.
3. Update existing workflows' `Do NOT use for` lines to reference the new workflow where appropriate (mutual reverse-edges keep router precision).
4. If two workflows could legitimately match the same cell, refine each one's `Triggers` and `Do NOT use for` until they are mutually exclusive.
