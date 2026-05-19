---
name: story-design
description: Design a video's story — pick a storytelling archetype, structure the scene sequence, define each scene's narrative intent, and write narrator scripts. Use when planning a promotional / explainer / launch video from extraction data (assets, tokens, sections). Covers story structure only; visual treatment is a separate concern (see `/visual-design`).
metadata:
  tags: planning, narrative, story, video-direction, storyboard, archetype
---

# Story Design

The story layer of a promotional video. Pick a storytelling archetype, design the scene sequence, define each scene's narrative intent, and write narrator scripts. Output: `narrator_scripts.json`.

## Core principle

Video narrative is independent from webpage structure. A webpage is an information layout; a video is an emotional journey.

- The scene sequence comes from narrative design, not the original order of webpage sections.
- A webpage flows `hero → features → pricing → CTA`; a video flows `hook → pain → hope → proof → action`.
- Reorder, combine, omit, or reframe webpage content as needed.
- Extraction data is the source of information and assets, not the story template.

## Narrative archetypes

Before designing scenes, pick **one** storytelling archetype. Read its overview for guidance and study its golden samples; don't mix sections from different archetypes — each is a coherent emotional journey.

<archetypes>
<pain-agitate-solve path="narrative-archetypes/pain-agitate-solve/overview.md">
**Pain → Agitate → Solve (PAS)** — Build painful recognition, then reveal the remedy. Best for: products solving a known frustration, B2B tools, audiences who already feel the pain.
</pain-agitate-solve>

<future-pacing path="narrative-archetypes/future-pacing/overview.md">
**Future Pacing — Vision → Proof** — Paint a beautiful future, then prove it's achievable. Best for: AI/tech products with novel capabilities, new category products.
</future-pacing>

<demo-loop path="narrative-archetypes/demo-loop/overview.md">
**Demo Loop — Question → Instant Answer** — Minimal narrative around repeated product demos. Best for: UI-centric products, data tools, "seeing is believing".
</demo-loop>
</archetypes>

## Narrative architecture

Define the role of each scene in the story. Each scene needs five narrative fields:

- **Type** — one of: `hook` / `pain_point` / `product_intro` / `feature_showcase` / `benefit_highlight` / `social_proof` / `branding` / `cta`
- **Narrative Role** — what this scene does in the story
- **Key Message** — what the viewer should take away
- **Persuasion** — the persuasion mechanism used
- **Emotional Beat** — the target feeling

## UI demo requirement

At least one scene must function as a UI demo by recreating the product's real interface. Review extraction screenshots and choose the page that best represents the product. Specify:

- which page or surface is shown
- which UI regions are visible
- which region is the primary focus

## Workflow

1. Review extraction data: skim screenshots, read `report.json` for an index, then deep-read `sections.json` + `tokens.json` for pages you care about.
2. Choose a narrative archetype that fits the product and audience (read the relevant `narrative-archetypes/<name>/overview.md`).
3. Design the scene sequence — purely narrative, not webpage order.
4. Define the Narrative Intent for each scene (all 5 fields above).
5. Write narrator scripts for each scene (plain text, no markdown).
6. Set a realistic `estimatedDuration` per scene (e.g. `"5-6s"`). Downstream tooling treats this as the timing contract.
7. Write `narrator_scripts.json` using the canonical schema below.

## Validation checklist

- Does every scene have a complete Narrative Intent (all 5 fields)?
- Does the emotional arc rise and fall meaningfully (not monotone)?
- Is the sequence narrative-driven, not webpage-ordered?
- Is there at least one UI demo scene?
- Only one archetype used (no mixing)?

## `narrator_scripts.json` — canonical schema

The frontend (and downstream agents) expect these **exact** field names. Wrong names (`scene_id` instead of `sceneNumber`, `narration` instead of `script`, flattened intent fields) will cause display + parsing issues.

```json
{
  "project": "project name",
  "narrativeArchetype": "selected archetype",
  "emotionalArc": "description of the emotional journey",
  "scenes": [
    {
      "sceneNumber": 1,
      "sceneName": "scene name",
      "narrativeIntent": {
        "type": "hook|pain_point|product_intro|feature_showcase|benefit_highlight|social_proof|branding|cta",
        "narrativeRole": "what this scene does in the story",
        "keyMessage": "what the viewer should remember",
        "persuasion": "persuasion technique used",
        "emotionalBeat": "target emotion"
      },
      "script": "plain text narration, no markdown",
      "estimatedDuration": "5-6s"
    }
  ]
}
```

Use `sceneNumber` (not `scene_id`), `sceneName` (not `scene_name`), `script` (not `narration`), and nest intent fields inside `narrativeIntent` (not flat on the scene object).

## See also

- `/visual-design` — visual treatment for each scene (consumes `narrator_scripts.json`).
- `/product-launch-video` — orchestrator that calls this skill as one phase of a website-to-launch-video pipeline.
