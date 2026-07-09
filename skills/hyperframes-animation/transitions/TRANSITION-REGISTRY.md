# Transition Registry - machine source of truth

Single source of truth for **PLV scene-to-scene transitions**. The deterministic
injector (`product-launch-video/scripts/inject-transitions.mjs`) reads the JSON
block below and stamps the matching `gsap_template` onto the master timeline.
The planner (`product-launch-video/agents/visual-design.md`) names a transition
by its `name`; everything else is harness.

> This registry intentionally still emits GSAP templates because `skills/product-launch-video/scripts/inject-transitions.mjs` is out of scope for this port. Anime.js support for that injector is follow-up work, not part of U11 batch 2.

This file is **not** the catalog of all transitions - that is `catalog.md` +
`css-*.md` (≈40 CSS + shader). This registry is the curated subset that is
**Tier-B-ready**: pure transform / opacity / filter on the two scene **clip
wrappers** (`#el-<sid>`), no injected overlay DOM, no per-scene cooperation.
Overlay families (staggered blocks, blinds, light leak, grid dissolve, page
burn) and shader transitions are deferred to later phases.

## How the injector applies a transition

At a `break` boundary between scene _i_ (`from`) and scene _i+1_ (`to`), the
injector:

1. Extends `#el-<from>` wrapper `data-duration` by `duration_s` (holds its final
   frame - verified: `core/src/runtime/init.ts:1393-1410` external-slot branch).
2. Pulls `#el-<to>` wrapper `data-start` earlier by `duration_s` (creates the
   overlap window).
3. Reassigns **all** clip `data-track-index` as a 0/1 ping-pong so the two
   overlapping wrappers never share a track (same-track overlap is illegal -
   `core/src/lint/rules/composition.ts`). Higher track composites on top.
4. Stamps the `gsap_template` into `window.__timelines["main"]` at `T = overlap-start`.

Verified by prototype render (2026-05-31): the master-timeline wrapper tween is
seeked and rendered (no double-seek with the sub-comp's own paused timeline -
the runtime drives them independently), the extended wrapper holds scene _i_'s
final frame, and the higher-track incoming wrapper composites over + blends with
the outgoing one.

## Template placeholders

The injector substitutes these tokens in each `gsap_template` line:

| Token                              | Meaning                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `__OLD__`                          | `"#el-<from>"` - outgoing clip wrapper selector (quoted)                 |
| `__NEW__`                          | `"#el-<to>"` - incoming clip wrapper selector (quoted)                   |
| `__T__`                            | overlap-start time in seconds (master clock)                             |
| `__DUR__`                          | `duration_s` for this boundary                                           |
| `__DX__`                           | horizontal travel for directional types: `-1920` (LEFT) / `1920` (RIGHT) |
| `__DY__`                           | vertical travel: `-1080` (UP) / `1080` (DOWN)                            |
| `__ORIGIN_OUT__` / `__ORIGIN_IN__` | transformOrigin pair for `squeeze`                                       |

`filter` / `scaleX` / `transformOrigin` are lint-clean on the master timeline
(verified: `core/src/lint/rules/gsap.ts` has no per-property whitelist and scopes
its checks to `data-composition-id` ranges; the x/y/scale/rotation/opacity
whitelist is a _scene-worker_ prompt rule only - it does not bind index.html).

## Registry

```json
{
  "transitions": [
    {
      "name": "crossfade",
      "tier": "b",
      "overlay": false,
      "energy": "any",
      "default_duration_s": 0.5,
      "directions": [],
      "source": "css-dissolve.md",
      "gsap_template": [
        "tl.to(__OLD__, { opacity: 0, duration: __DUR__, ease: \"power2.inOut\" }, __T__);",
        "tl.fromTo(__NEW__, { opacity: 0 }, { opacity: 1, duration: __DUR__, ease: \"power2.inOut\" }, __T__);"
      ]
    },
    {
      "name": "blur-crossfade",
      "tier": "b",
      "overlay": false,
      "energy": "calm",
      "default_duration_s": 0.6,
      "directions": [],
      "source": "css-dissolve.md",
      "note": "Default when the two scenes' #root backgrounds differ a lot — the blur masks the background-color clash a plain crossfade would expose.",
      "gsap_template": [
        "tl.to(__OLD__, { filter: \"blur(10px)\", scale: 1.03, opacity: 0, duration: __DUR__, ease: \"power2.inOut\" }, __T__);",
        "tl.fromTo(__NEW__, { filter: \"blur(10px)\", scale: 0.97, opacity: 0 }, { filter: \"blur(0px)\", scale: 1, opacity: 1, duration: __DUR__, ease: \"power2.inOut\" }, __T__);"
      ]
    },
    {
      "name": "push-slide",
      "tier": "b",
      "overlay": false,
      "energy": "medium",
      "default_duration_s": 0.5,
      "directions": ["LEFT", "RIGHT", "UP", "DOWN"],
      "default_direction": "LEFT",
      "source": "css-push.md",
      "note": "Directional. The injector picks __DX__/__DY__ from the direction and emits the horizontal OR vertical pair (not both).",
      "gsap_template_horizontal": [
        "tl.to(__OLD__, { x: __DX__, duration: __DUR__, ease: \"power3.inOut\" }, __T__);",
        "tl.fromTo(__NEW__, { x: __DXIN__, opacity: 1 }, { x: 0, duration: __DUR__, ease: \"power3.inOut\" }, __T__);"
      ],
      "gsap_template_vertical": [
        "tl.to(__OLD__, { y: __DY__, duration: __DUR__, ease: \"power3.inOut\" }, __T__);",
        "tl.fromTo(__NEW__, { y: __DYIN__, opacity: 1 }, { y: 0, duration: __DUR__, ease: \"power3.inOut\" }, __T__);"
      ]
    },
    {
      "name": "zoom-through",
      "tier": "b",
      "overlay": false,
      "energy": "high",
      "default_duration_s": 0.4,
      "directions": [],
      "source": "css-scale.md",
      "gsap_template": [
        "tl.to(__OLD__, { scale: 2.5, opacity: 0, filter: \"blur(8px)\", duration: __DUR__, ease: \"power3.in\" }, __T__);",
        "tl.fromTo(__NEW__, { scale: 0.5, opacity: 0, filter: \"blur(8px)\" }, { scale: 1, opacity: 1, filter: \"blur(0px)\", duration: __DUR__, ease: \"power3.out\" }, __T__);"
      ]
    },
    {
      "name": "squeeze",
      "tier": "b",
      "overlay": false,
      "energy": "medium",
      "default_duration_s": 0.4,
      "directions": [],
      "source": "css-push.md",
      "note": "Old compresses to a vertical line on the left edge; new expands from the right edge. Incoming starts off (scaleX 0) so its higher-track stacking is harmless.",
      "gsap_template": [
        "tl.to(__OLD__, { scaleX: 0, transformOrigin: \"left center\", duration: __DUR__, ease: \"power3.inOut\" }, __T__);",
        "tl.fromTo(__NEW__, { scaleX: 0, transformOrigin: \"right center\", opacity: 1 }, { scaleX: 1, transformOrigin: \"right center\", duration: __DUR__, ease: \"power3.inOut\" }, __T__);"
      ]
    }
  ],
  "tier_a_types": ["morph", "shared-element"],
  "default_high_energy": "zoom-through",
  "default_calm": "blur-crossfade",
  "max_duration_s": 2.0
}
```

## Default-derivation (used by prep.mjs when the planner omits `**Transition:**`)

A `break` boundary with no named transition gets a default:

1. If the incoming scene's creative brief reads HIGH energy (explosive / kinetic /
   frenetic keywords), use `default_high_energy` (`zoom-through`).
2. Otherwise use `default_calm` (`blur-crossfade`) - the universal default. The
   blur masks any background shift and reads intentional, which keeps the whole
   video to ~2 transition types (the "repeat 2-3" principle).

## Choosing as a planner (the only agent touchpoint)

Pick **2-3 types for the whole video** and repeat them - repetition is what reads
as professional (see `overview.md`). This budget counts the **Tier-B between-scene
types only** (the 5 in the registry above); the Tier-A `shared-element` morph is a
worker-authored bridge driven by narrative `intent: morph` - it is **exempt and
does not count** toward the 2-3. Name the entering transition on each scene:

```
**Transition:** blur-crossfade
**Transition:** push-slide LEFT
**Transition:** zoom-through 0.3s
```

Omit the anchor to accept the default above. Do NOT write GSAP, touch timing, or
edit index.html - the harness stamps the code, computes the overlap, and assigns
tracks.
