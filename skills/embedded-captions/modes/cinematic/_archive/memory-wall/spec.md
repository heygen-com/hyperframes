# Template: memory-wall

**Look:** introspective monologue, italic poem stacking on a back wall,
right-aligned cascade for the climax. Sam Harris / Pico Iyer territory.

**Visual identity (LOCKED — do not change):**

- 4-slot typography arc: italic 600 → italic 500 hanging-indent → upright
  700 pivot → uppercase 900 climax
- `mix-blend-mode: screen` over warm-bone color (#fff4dc)
- soft text-shadow + brightness boost
- Per-word fade with subtle Y-drift (soft tone) or pop+scale (present tone)

## When to apply

✅ **Good fit:**

- Talking-head with a flat back wall (acoustic foam, plain plaster, soft
  bookshelf) on one side
- Single subject, fixed or near-fixed camera
- Voice-over feel: introspective, narrative, "I was thinking…"
- Mid-tone or dark backdrop (luminance < 180)

❌ **Wrong fit:**

- Bright window/sky backdrop → screen blend blows out
- Cluttered backdrop with text/graphics → conflicts with caption text
- Energetic / vlog / TikTok style → wrong vibe
- Multiple speakers / hard cuts → caption arc breaks

## What agent decides per scene

| Field                          | What                                                                                                               | Example                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `plane.top/right/width/height` | Where the wall plane sits in frame. Plane should HUG the side of the wall, not float over the subject.             | `{top: 90, right: 30, width: 720, height: 520}` for 1280×720       |
| `plane.rotateY`                | Match the wall's perspective angle. Negative for right-side wall (text recedes left), positive for left-side wall. | `-13` for a right-side wall at slight angle                        |
| `plane.rotateX`                | Tiny vertical tilt if wall is angled up/down. Usually 0-2 deg.                                                     | `1`                                                                |
| `font_scale`                   | Multiplier on the locked cap-N base sizes. Tune for frame height.                                                  | `1.0` for 1280×720, `~1.5` for 1920×1080, `~0.7` for 720p portrait |
| `groups[].slot`                | Which of the 4 typography slots this group uses (1/2/3/4). Drives the arc.                                         | See below                                                          |
| `groups[].tone`                | "soft" or "present" — drives motion curve                                                                          | `"soft"` for opening lines, `"present"` for pivot+climax           |

## Slot assignment rules

Aim for ONE arc across the video: `1 → 2 → 3 → 4`. Don't repeat slots if you
can avoid it; don't skip slots without reason.

| Slot | Use for                                                                                                                                  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | The opener. The "I was thinking" line. Italic, soft entry.                                                                               |
| 2    | The dreamy continuation / modifier. Smaller italic, hanging-indent — feels like the second half of a sentence with some staggered drift. |
| 3    | The pivot. Upright (no italic), the syntactic turn. ("but suddenly", "and then…")                                                        |
| 4    | The climax. Big uppercase 900. The payoff line. Aim for ≤4 short words so the right-aligned cascade naturally wraps to 2-3 lines.        |

If the script is longer than 4 groups, repeat slot 1 or 2 for additional
soft lines, but reserve slot 4 for the SINGLE climax.

## Plan.json shape

```json
{
  "mode": "template",
  "template": "memory-wall",
  "duration": 8.04,
  "fps": 24,
  "width": 1280,
  "height": 720,
  "plane": {
    "top": 90,
    "right": 30,
    "width": 720,
    "height": 520,
    "rotateY": -13,
    "rotateX": 1
  },
  "font_scale": 1.0,
  "groups": [
    {
      "id": "cg-0",
      "slot": 1,
      "tone": "soft",
      "in": 0.2,
      "out": 4.85,
      "words": [
        { "text": "Some", "start": 0.24, "end": 0.44 },
        { "text": "memories", "start": 0.48, "end": 0.82 },
        { "text": "feel", "start": 0.92, "end": 1.14 },
        { "text": "soft", "start": 1.2, "end": 1.64 }
      ]
    },
    {
      "id": "cg-1",
      "slot": 2,
      "tone": "soft",
      "in": 2.55,
      "out": 4.85,
      "words": [
        { "text": "like", "start": 2.66, "end": 2.78 },
        { "text": "old", "start": 2.86, "end": 3.02 },
        { "text": "film", "start": 3.16, "end": 3.46 }
      ]
    },
    {
      "id": "cg-2",
      "slot": 3,
      "tone": "present",
      "in": 4.9,
      "out": 8.04,
      "words": [
        { "text": "but", "start": 5.04, "end": 5.18 },
        { "text": "suddenly", "start": 5.24, "end": 5.76 }
      ]
    },
    {
      "id": "cg-3",
      "slot": 4,
      "tone": "present",
      "in": 6.7,
      "out": 8.04,
      "words": [
        { "text": "everything", "start": 6.82, "end": 7.14 },
        { "text": "is", "start": 7.18, "end": 7.28 },
        { "text": "sharp", "start": 7.32, "end": 7.52 },
        { "text": "again", "start": 7.58, "end": 7.92 }
      ]
    }
  ]
}
```

## Don't fight the template

If the user wants different typography, different blend, or different motion:
**use Standard mode** (`../../../standard/`). Don't try to override the locked CSS — the
template's visual consistency is the whole point.
