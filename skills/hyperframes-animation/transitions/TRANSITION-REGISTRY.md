# Transition Registry: machine source of truth

Single source of truth for **PLV scene-to-scene transitions**. The deterministic
injector (`transitions.mjs`, vendored identically into `product-launch-video/scripts/`,
`pr-to-video/scripts/`, and `faceless-explainer/scripts/`) reads the JSON block
below and stamps the matching template onto the master timeline: `gsap_template`
for a GSAP target composition, `anime_template` for anime.js (the anime-first
default — see "Runtime selection" below). The planner (`product-launch-video/agents/visual-design.md`)
names a transition by its `name`; everything else is harness.

## Runtime selection

The injector detects the target composition's runtime from index.html (a
whole-file classifier consistent with `@hyperframes/parsers`'
`classifyAnimationRuntime`, vendored rather than imported because skill scripts
ship standalone under plain node) and picks the template family accordingly:
`gsap` stamps `gsap_template*`; anything else (`animejs`, `mixed`, `none`)
defaults to `anime_template*`, per the anime-first contract. Anime templates
stamp onto `hyperframesAnime.get("main").instance` (registered via the
createTimeline+register anchor from `packages/core/src/runtime/adapters/animejs.ts`),
never `window.__timelines`, since `window.__timelines` is itself a GSAP signal.

This file is **not** the catalog of all transitions: that is `catalog.md` +
`css-*.md` (≈40 CSS + shader). This registry is the curated subset that is
**Tier-B-ready**: pure transform / opacity / filter on the two scene **clip
wrappers** (`#el-<sid>`), no injected overlay DOM, no per-scene cooperation.
Overlay families (staggered blocks, blinds, light leak, grid dissolve, page
burn) and shader transitions are deferred to later phases.

## How the injector applies a transition

At a `break` boundary between scene _i_ (`from`) and scene _i+1_ (`to`), the
injector:

1. Extends `#el-<from>` wrapper `data-duration` by `duration_s` (holds its final
   frame: verified: `core/src/runtime/init.ts:1393-1410` external-slot branch).
2. Pulls `#el-<to>` wrapper `data-start` earlier by `duration_s` (creates the
   overlap window).
3. Reassigns **all** clip `data-track-index` as a 0/1 ping-pong so the two
   overlapping wrappers never share a track (same-track overlap is illegal -
   `core/src/lint/rules/composition.ts`). Higher track composites on top.
4. Stamps the matching template — `gsap_template` into `window.__timelines["main"]`,
   or `anime_template` into `hyperframesAnime.get("main").instance` — at
   `T = overlap-start`.

Verified by prototype render (2026-05-31): the master-timeline wrapper tween is
seeked and rendered (no double-seek with the sub-comp's own paused timeline -
the runtime drives them independently), the extended wrapper holds scene _i_'s
final frame, and the higher-track incoming wrapper composites over + blends with
the outgoing one.

## Template placeholders

The injector substitutes these tokens. `gsap_template*` lines use the seconds
tokens (`__T__`/`__DUR__`); `anime_template*` lines use the milliseconds tokens
(`__T_MS__`/`__DUR_MS__` — anime.js's native time unit) instead. `__DX__`/`__DY__`
are shared as-is (px) since anime's `translateX`/`translateY` are px-equivalent
to GSAP's `x`/`y`.

| Token                    | Meaning                                                                  |
| ------------------------ | ------------------------------------------------------------------------ |
| `__OLD__`                | `"#el-<from>"`, outgoing clip wrapper selector (quoted)                  |
| `__NEW__`                | `"#el-<to>"`, incoming clip wrapper selector (quoted)                    |
| `__T__` / `__T_MS__`     | overlap-start time — seconds (GSAP) / milliseconds (anime)               |
| `__DUR__` / `__DUR_MS__` | `duration_s` for this boundary — seconds (GSAP) / milliseconds (anime)   |
| `__DX__`                 | horizontal travel for directional types: `-1920` (LEFT) / `1920` (RIGHT) |
| `__DY__`                 | vertical travel: `-1080` (UP) / `1080` (DOWN)                            |

`filter` / `scaleX` / `transformOrigin` are lint-clean on the master timeline
(verified: `core/src/lint/rules/gsap.ts` has no per-property whitelist and scopes
its checks to `data-composition-id` ranges; the x/y/scale/rotation/opacity
whitelist is a _scene-worker_ prompt rule only: it does not bind index.html).

`anime_template*` entries always use explicit `[from, to]` arrays (the boundary's
start position can be > 0, so an implicit from-value is never safe under a cold
seek), decomposed transform keys (`translateX`/`translateY`/`scale`/`scaleX`,
never a CSS `transform` string), and `tl.set(...)` for immediate non-tweened
writes instead of a zero-duration `tl.add(...)`. `squeeze`'s `transformOrigin`
uses percentage pairs (`"0% 50%"` / `"100% 50%"`), never CSS keyword syntax
(`"left center"`) — verified in real Chrome (anime.js 4.5.0) that keyword syntax
silently resolves both endpoints to `(0,0)` instead of parsing the keywords.
GSAP eases map to anime eases per `core/src/animation/easeMap.ts` (`power2` ->
`Cubic`, `power3` -> `Quart` family).

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
      ],
      "anime_template": [
        "tl.add(__OLD__, { opacity: [1, 0], duration: __DUR_MS__, ease: \"inOutCubic\" }, __T_MS__);",
        "tl.add(__NEW__, { opacity: [0, 1], duration: __DUR_MS__, ease: \"inOutCubic\" }, __T_MS__);"
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
      ],
      "anime_template": [
        "tl.add(__OLD__, { filter: [\"blur(0px)\", \"blur(10px)\"], scale: [1, 1.03], opacity: [1, 0], duration: __DUR_MS__, ease: \"inOutCubic\" }, __T_MS__);",
        "tl.add(__NEW__, { filter: [\"blur(10px)\", \"blur(0px)\"], scale: [0.97, 1], opacity: [0, 1], duration: __DUR_MS__, ease: \"inOutCubic\" }, __T_MS__);"
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
      ],
      "anime_template_horizontal": [
        "tl.add(__OLD__, { translateX: [0, __DX__], duration: __DUR_MS__, ease: \"inOutQuart\" }, __T_MS__);",
        "tl.set(__NEW__, { opacity: 1 }, __T_MS__);",
        "tl.add(__NEW__, { translateX: [__DXIN__, 0], duration: __DUR_MS__, ease: \"inOutQuart\" }, __T_MS__);"
      ],
      "anime_template_vertical": [
        "tl.add(__OLD__, { translateY: [0, __DY__], duration: __DUR_MS__, ease: \"inOutQuart\" }, __T_MS__);",
        "tl.set(__NEW__, { opacity: 1 }, __T_MS__);",
        "tl.add(__NEW__, { translateY: [__DYIN__, 0], duration: __DUR_MS__, ease: \"inOutQuart\" }, __T_MS__);"
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
      ],
      "anime_template": [
        "tl.add(__OLD__, { scale: [1, 2.5], opacity: [1, 0], filter: [\"blur(0px)\", \"blur(8px)\"], duration: __DUR_MS__, ease: \"inQuart\" }, __T_MS__);",
        "tl.add(__NEW__, { scale: [0.5, 1], opacity: [0, 1], filter: [\"blur(8px)\", \"blur(0px)\"], duration: __DUR_MS__, ease: \"outQuart\" }, __T_MS__);"
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
      ],
      "anime_template": [
        "tl.set(__OLD__, { transformOrigin: \"0% 50%\" }, __T_MS__);",
        "tl.add(__OLD__, { scaleX: [1, 0], duration: __DUR_MS__, ease: \"inOutQuart\" }, __T_MS__);",
        "tl.set(__NEW__, { transformOrigin: \"100% 50%\", opacity: 1 }, __T_MS__);",
        "tl.add(__NEW__, { scaleX: [0, 1], duration: __DUR_MS__, ease: \"inOutQuart\" }, __T_MS__);"
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
2. Otherwise use `default_calm` (`blur-crossfade`), the universal default. The
   blur masks any background shift and reads intentional, which keeps the whole
   video to ~2 transition types (the "repeat 2-3" principle).

## Choosing as a planner (the only agent touchpoint)

Pick **2-3 types for the whole video** and repeat them: repetition is what reads
as professional (see `overview.md`). This budget counts the **Tier-B between-scene
types only** (the 5 in the registry above); the Tier-A `shared-element` morph is a
worker-authored bridge driven by narrative `intent: morph`, it is **exempt and
does not count** toward the 2-3. Name the entering transition on each scene:

```
**Transition:** blur-crossfade
**Transition:** push-slide LEFT
**Transition:** zoom-through 0.3s
```

Omit the anchor to accept the default above. Do NOT write GSAP, touch timing, or
edit index.html: the harness stamps the code, computes the overlap, and assigns
tracks.
