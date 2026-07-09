---
name: caption-template-motion
description: The named flow + climax entrance/exit recipes (anime.js, seek-safe) that the per-template files reference, plus the motion numerics (ease palette, exit=75% entry, climax dwell, restraint, mood→motion). Every template picks a FLOW_IN/OUT and a CLIMAX_IN/OUT from here, look up only the 2-3 recipes a template names (grep the `### name`), this is a catalog, not a read-through.
metadata:
  tags: animejs, easing, entrance, exit, timing, restraint, mood-matching, captions
---

# Caption Template - Motion Language

`_anatomy.md` wires four hooks onto one paused anime.js timeline: `FLOW_IN`, `FLOW_OUT`, `CLIMAX_IN`, `CLIMAX_OUT`. This file is the catalog each template picks from. Each recipe maps to `tl.add(target, params, positionMs)` calls on the climax `span` (or a flow `.w`); placed at an absolute millisecond time it is fully **seek-safe**. Multi-stage looks use anime.js `keyframes:{}` (still seek-safe), never CSS keyframes.

## Numerics (shared)

**Ease palette** (sanctioned, reads clean on video, stays distinct):

| Curve           | anime.js                              | Use                                                 |
| --------------- | ------------------------------------- | --------------------------------------------------- |
| overshoot entry | `outBack(1.4-1.7)`                    | confident arrivals (premium/epic/creator)           |
| heavy/refined   | `outQuart`                            | hero/secondary entrances, slides                    |
| general         | `outCubic`                            | fades, scales                                       |
| exit accel      | `inCubic`                             | the _exit_ side of any move (departure accelerates) |
| snappy          | `outExpo`                             | warp/fly/sonic confident snaps                      |
| breathing       | `inOutSine`                           | gentle wellness drift                               |
| impact thud     | `outBack(1.5-2)` or a quick `outExpo` | slam/stomp/stamp landings                           |
| linear driver   | `linear`                              | the asr active-word envelope driver only            |
| digital stutter | `steps(n)`                            | glitch/vhs/blink/possess/cut                        |

**Forbidden:** `outBounce`, `outElastic(1, .3)` everywhere **except** the Playful cluster (explicit playfulness, KIDS drop-bounce, CANDY jelly). Elsewhere real objects decelerate; they don't bounce. Use low `outBack(...)` for sanctioned overshoot.

**Durations**: flow word enter 300-500 ms · climax entrance 600-1600 ms · **exit ≈ 75 % of entry** (arrival deliberate, departure swift) · stagger 50-150 ms / word.

**Restraint (the rule that makes it premium):** the FLOW stays clean, a tasteful reveal + the active-word accent, no effects. The big mood move + any scene effect (flash, shockwave, shake) happens **only at the CLIMAX**, then clears. Never sprinkle effects across the flow.

**Climax dwell ≥ 1 s** after the entrance finishes, the climax is the headline beat.

**Mood → motion** (pick an entrance whose physics match the theme):

| Mood                            | Entrances                                            |
| ------------------------------- | ---------------------------------------------------- |
| premium                         | deblur · rise · expose · breathe · flip              |
| epic                            | slam · monument · fly · grandrise                    |
| cyber                           | glitch · type · scan · boot                          |
| horror                          | loom · possess · glimpse · seep (never bouncy/clean) |
| luxury                          | tracking-expand · hairrise                           |
| retro                           | vhs · stamp · blink · type                           |
| neon                            | ignite · buzz                                        |
| hype                            | stomp · punch · slap                                 |
| playful                         | jelly · dropb · scrawl · popr                        |
| creator                         | boxpop · slideup · flip · shimmer                    |
| ultra (flash in the type)       | volt · hyper · liquid · prism · shatter · extrude    |
| atelier (design)                | editwipe · rise · block · vert · ink · weight        |
| impact (scene effect at climax) | nuke · meteor · sonic · seismic · judge              |

---

## FLOW entrances / exits (per word `.w`)

The flow caption reveals word-by-word from the transcript. The active word gets `.act` (→ `--cacc`). Exit hard-hides the group.

- **fade-up** (premium/atelier default) - `tl.add(w,{opacity:0,y:14,duration:0},atMs); tl.add(w,{opacity:1,y:0,duration:420,ease:'outQuart'},atMs)`
- **pop** (epic/hype) - `tl.add(w,{opacity:0,scale:.5,duration:0},atMs); tl.add(w,{opacity:1,scale:1,duration:340,ease:'outBack(1.6)'},atMs)`
- **whip** (kinetic) - `tl.add(w,{opacity:0,x:-30,filter:'blur(10px)',duration:0},atMs); tl.add(w,{opacity:1,x:0,filter:'blur(0)',duration:320,ease:'outExpo'},atMs)`
- **glitch** (cyber) - `tl.add(w,{opacity:0,clipPath:'inset(45% 0 45% 0)',duration:0},atMs); tl.add(w,{opacity:1,clipPath:'inset(0)',duration:400,ease:'steps(6)'},atMs)`
- **type** (terminal/retro) - `tl.add(w,{opacity:0,duration:0},atMs); tl.add(w,{opacity:1,duration:200,ease:'steps(3)'},atMs)` staggered as the cadence
- **blur-in** (horror) - `tl.add(w,{opacity:0,filter:'blur(10px)',y:'.1em',duration:0},atMs); tl.add(w,{opacity:1,filter:'blur(0)',y:0,duration:600,ease:'outCubic'},atMs)`
- **karaoke** (creator) - words start visible-dim; on `w.start` use zero-duration `tl.add(...)` events to set active color (`--cacc`) and return the prior word to spoken. The signature verbatim mechanic.
- **flow exits** - fade-up-out `tl.add(w,{opacity:0,y:-10,duration:420,ease:'inCubic'},atMs)` · horror smear `tl.add(w,{opacity:0,x:6,skewX:10,filter:'blur(5px)',duration:420,ease:'inCubic'},atMs)` · all ≈400-550 ms.

---

## CLIMAX entrances

Each is expressed as `{from}→{to}` shorthand. Implement it with `tl.add(span, {...from, duration:0}, atMs); tl.add(span, to, atMs)`. Where a `keyframes:{}` is shown, pass it inside the anime.js params object.

### premium

- **deblur** - `{opacity:0,scale:.96,filter:'blur(8px)'}→{opacity:1,scale:1,filter:'blur(0)',duration:800,ease:'outQuart'}`
- **rise** - `{opacity:0,yPercent:48}→{opacity:1,yPercent:0,duration:900,ease:'outQuart'}`
- **expose** - `{opacity:0,filter:'brightness(3.2) blur(5px)',scale:1.05}→{opacity:1,filter:'brightness(1) blur(0)',scale:1,duration:1000,ease:'outCubic'}`
- **breathe** - `{opacity:0,scale:1.09,filter:'blur(8px)'}→{opacity:1,scale:1,filter:'blur(0)',duration:1200,ease:'outSine'}`
- **flip** - `{opacity:0,rotationX:93,transformPerspective:720}→{opacity:1,rotationX:0,duration:900,ease:'outQuart'}`

### epic

- **slam** - `{opacity:0,scale:1.6,filter:'blur(12px)'}→{opacity:1,scale:1,filter:'blur(0)',duration:700,ease:'outBack(1.6)'}` (lands with a thud; overshoot ~1.03 mid)
- **monument** - `{opacity:0,scale:1.42,letterSpacing:'.12em'}→{opacity:1,scale:1,letterSpacing:'0',duration:1300,ease:'outQuart'}`
- **fly** - `{opacity:0,scale:.3,filter:'blur(14px)'}→{opacity:1,scale:1,filter:'blur(0)',duration:800,ease:'outExpo'}`
- **grandrise** - `{opacity:0,yPercent:66,scale:1.05}→{opacity:1,yPercent:0,scale:1,duration:1150,ease:'outQuart'}`

### cyber

- **glitch** - `{opacity:0}→{opacity:1,duration:600,ease:'steps(8)',keyframes:{clipPath:['inset(40% 0 40% 0)','inset(0)','inset(60% 0 10% 0)','inset(0)'],x:[-8,5,-2,0],textShadow:['4px 0 #ff003c,-4px 0 #00ffd1','none']}}`
- **type** - `{opacity:1,clipPath:'inset(0 100% 0 0)'}→{clipPath:'inset(0 0 0 0)',duration:850,ease:'steps(13)'}` (typewriter L→R)
- **scan** - `{opacity:0,scaleY:.02,filter:'brightness(2.4)'}→{opacity:1,scaleY:1,filter:'brightness(1)',duration:750,ease:'outQuart'}`
- **boot** - `{opacity:0,scaleY:.1}→{opacity:1,scaleY:1,duration:1000,ease:'steps(1)',keyframes:{opacity:[0,.6,.1,.85,.2,1]}}` (hologram power-up flicker)

### horror (never bouncy, never clean)

- **loom** - `{opacity:0,scale:.6,filter:'blur(17px)'}→{opacity:1,scale:1,filter:'blur(0)',duration:1600,ease:'inCubic',keyframes:{scale:[.6,.93,1.07,1]}}` (slowly approaches out of the dark, then a lurch closer)
- **possess** - `{opacity:0}→{opacity:1,duration:1150,ease:'steps(1)',keyframes:{x:[0,-5,6,-4,5,-2,0],skewX:[0,9,-10,7,-5,3,0],textShadow:['none','4px 0 #c00,-4px 0 #0aa','-6px 0 #c00,6px 0 #0aa','none']}}` (materialise then violent demonic shudder)
- **glimpse** - `{opacity:0}→{opacity:1,duration:1350,ease:'steps(1)',keyframes:{opacity:[0,1,0,0,1,0,0,1,.05,1,.15,1],x:[0,0,0,3,0,-2,0]}}` (subliminal failing-light flicker)
- **seep** - `{opacity:0,clipPath:'inset(-15% -8% 100% -8%)',filter:'blur(4px)'}→{opacity:1,clipPath:'inset(-15% -8% -15% -8%)',filter:'blur(0)',duration:1350,ease:'inOutQuad'}` (blood seeps down into the word; negative insets so script tops aren't clipped)

### luxury

- **tracking** - `{opacity:0,letterSpacing:'-.05em'}→{opacity:1,letterSpacing:'.28em',duration:1400,ease:'outQuart'}` (the most "expensive" move)
- **hairrise** - `{opacity:0,yPercent:32,letterSpacing:'.07em'}→{opacity:1,yPercent:0,letterSpacing:'0',duration:1100,ease:'outQuart'}`

### retro

- **vhs** - `{opacity:0}→{opacity:1,duration:800,ease:'steps(1)',keyframes:{x:[0,-7,6,-3,2,0],textShadow:['none','3px 0 #ff3b5c,-3px 0 #3aa0ff','none']}}` (tracking-lock jitter + chroma)
- **stamp** - `{opacity:0,scale:1.7,rotation:-5}→{opacity:1,scale:1,rotation:0,duration:700,ease:'outBack(2)'}` (printing-stamp thud)
- **blink** - `{opacity:0}→{opacity:1,duration:750,ease:'steps(1)',keyframes:{opacity:[0,0,1,0,1,0,1,1]}}` (8-bit blink-in)

### neon

- **ignite** - `{opacity:0}→{opacity:1,duration:1300,ease:'steps(1)',keyframes:{opacity:[.2,1,.2,1,.3,1,1]}}` (tube strikes + buzzes alight; glow is a style `text-shadow`)
- **buzz** - `{opacity:0}→{opacity:1,duration:1200,ease:'steps(1)',keyframes:{opacity:[0,.7,.1,.85,.2,1,.5,1]}}` (slower warm-up rhythm)

### hype

- **stomp** - `{opacity:0,scale:1.5,filter:'blur(8px)'}→{opacity:1,scale:1,filter:'blur(0)',duration:900,ease:'outBack(1.6)'}`
- **punch** - `{opacity:0,xPercent:-55,scale:1.1,filter:'blur(9px)'}→{opacity:1,xPercent:0,scale:1,filter:'blur(0)',duration:600,ease:'outExpo'}` (whip from the side)
- **slap** - `{opacity:0,rotation:12,scale:1.5,filter:'blur(7px)'}→{opacity:1,rotation:0,scale:1,filter:'blur(0)',duration:700,ease:'outBack(2)'}` (sticker/tag slap)

### playful (bounce allowed here)

- **jelly** - `{opacity:0,scale:.5}→{opacity:1,scale:1,duration:800,ease:'outBack(2.2)',keyframes:{scale:[.5,1.12,.92,1.04,1],skewX:[0,0,6,-4,0]}}`
- **dropb** - `{opacity:0,yPercent:-85}→{opacity:1,yPercent:0,duration:950,ease:'outCubic',keyframes:{yPercent:[-85,0,-22,0,-8,0]}}` (drop + multi-bounce). **❗opacity must reach 1 and stay** - declare it at the end of the keyframes.
- **scrawl** - `{opacity:0,clipPath:'inset(-12% 100% -12% 0)',rotation:-3}→{opacity:1,clipPath:'inset(-12% 0 -12% 0)',rotation:0,duration:800,ease:'outCubic'}` (handwritten write-on, for script faces)
- **popr** - `{opacity:0,scale:.4,rotation:8}→{opacity:1,scale:1,rotation:0,duration:600,ease:'outBack(2)'}`

### creator

- **boxpop** - `{opacity:0,scale:.5}→{opacity:1,scale:1,duration:500,ease:'outBack(1.8)'}` (the active flow word's highlight box is a style)
- **slideup** - `{opacity:0,yPercent:44}→{opacity:1,yPercent:0,duration:550,ease:'outQuart'}`
- **flip** - see premium
- **shimmer** - `{opacity:0,scale:.7,filter:'brightness(2.2)'}→{opacity:1,scale:1,filter:'brightness(1)',duration:750,ease:'outCubic'}`

### ultra (the flash lives in the type)

- **volt** - `{opacity:0}→{opacity:1,duration:1100,ease:'steps(1)',keyframes:{opacity:[0,1,.12,1,.35,1],x:[0,0,0,2,-2,0]}}` then settle to glow `text-shadow:0 0 8px #fff,0 0 22px #43f4ff,0 0 48px #1e90ff` (electric strike)
- **hyper** - `{opacity:0,scale:.05,filter:'blur(3px) brightness(3)'}→{opacity:1,scale:1,filter:'blur(0) brightness(1)',duration:900,ease:'outExpo'}` (warp from depth)
- **liquid** - `{opacity:0,scale:.9,yPercent:6,filter:'blur(10px)'}→{opacity:1,scale:1,yPercent:0,filter:'blur(0)',duration:1000,ease:'outCubic'}` + the `.climax` _container_ carries SVG `filter:url(#liquid)`; in HF drive `feDisplacementMap@scale` from the timeline (don't use SMIL - not seek-safe)
- **prism** - `{opacity:0,textShadow:'-38px 0 #ff003c,38px 0 #00ffd1',filter:'blur(5px)',scale:1.08}→{opacity:1,textShadow:'-3px 0 #ff003c,3px 0 #00ffd1',filter:'blur(0)',scale:1,duration:1000,ease:'outQuart'}` (chromatic dispersion converge)
- **shatter** - `{opacity:0,scale:1.9,rotation:-3,filter:'blur(14px)'}→{opacity:1,scale:1,rotation:0,filter:'blur(0)',duration:1000,ease:'outBack(1.4)',keyframes:{scale:[1.9,.9,1.06,.98,1]}}` (+ a 1-frame white `text-shadow` flash on landing)
- **extrude** - `{opacity:0,rotationY:42,scale:.9,transformPerspective:700}→{opacity:1,rotationY:-9,scale:1,duration:900,ease:'outQuart'}` (3D turn; depth via stacked `text-shadow` in the style)

### atelier (design-forward)

- **editwipe** - `{opacity:1,clipPath:'inset(-15% 100% -15% 0)'}→{clipPath:'inset(-15% -4% -15% 0)',duration:700,ease:'inOutQuint'}` (Swiss precise wipe; negative top/bottom so glyph tops aren't clipped)
- **rise** - see premium (slower, `duration:900`)
- **block** - `{opacity:0,scaleY:0,transformOrigin:'bottom center'}→{opacity:1,scaleY:1,duration:700,ease:'outQuart'}` (constructed/Bauhaus)
- **vert** - `{opacity:0,clipPath:'inset(0 0 100% 0)'}→{opacity:1,clipPath:'inset(0 0 0 0)',duration:900,ease:'outCubic'}` (vertical ink-drop; `writing-mode:vertical-rl` is a style, climax sits at `left:81%`)
- **ink** - `{opacity:0,clipPath:'inset(-28% 100% -28% -4%)',filter:'blur(3px)'}→{opacity:1,clipPath:'inset(-28% -8% -28% -4%)',filter:'blur(0)',duration:900,ease:'outCubic'}` (brush write-on; generous negative insets for the script face)
- **weight** - `{opacity:0,fontVariationSettings:"'wght' 100",letterSpacing:'.18em'}→{opacity:1,fontVariationSettings:"'wght' 900",letterSpacing:'0',duration:1000,ease:'outCubic'}` (variable-font morph; needs a variable face, e.g. Inter `wght@100..900`)

### impact (the ONE sanctioned scene effect, at the climax only)

Each pairs the type move with a scene element (`<div class="flash">` / `<div class="ring">`) and/or a stage shake. Keep it to the climax beat.

- **nuke** - type: `{opacity:0,scale:.3,filter:'brightness(8) blur(10px)'}→{opacity:1,scale:1,filter:'brightness(1) blur(0)',duration:1000,ease:'outExpo'}` + white `.flash` `add{opacity:0,duration:300,ease:'inCubic'}` + brief stage `x` shake
- **meteor** - `{opacity:0,yPercent:-45,scale:1.12,filter:'blur(12px) brightness(2.2)'}→{opacity:1,yPercent:0,scale:1,filter:'blur(0)',duration:1000,ease:'inQuint'}` (accelerate DOWN) + on-land stage shake
- **sonic** - `{opacity:0,scale:1.4,filter:'blur(8px)'}→{opacity:1,scale:1,filter:'blur(0)',duration:900,ease:'outExpo'}` + a `.ring` scaling `0→3` opacity `1→0`
- **seismic** - `{opacity:0,scale:1.1}→{opacity:1,scale:1,duration:900,ease:'outQuart'}` + stage `x`/`y` quake `keyframes:[3,-3,2,-2,0]` decaying
- **judge** - `{opacity:0,yPercent:-45,scale:1.12,filter:'blur(12px) brightness(2.2)'}→{opacity:1,yPercent:0,scale:1,filter:'blur(0)',duration:1000,ease:'outQuart'}` (descends from above) + light-shaft `.flash`

---

## CLIMAX exits

Default is **fade** unless a template names another. **Every exit ends at `opacity:0`** (or fully-clipped) so nothing lingers, declare opacity:0 at the end even on transform/clip exits. `add{...}` below means a single `tl.add(span, {...}, atMs)` event.

- **fade** - `add{opacity:0,scale:1.03,duration:600,ease:'inCubic'}` (premium/epic/most defaults)
- **rise-off** - `add{opacity:0,yPercent:-42,duration:600}` · **sink** - `add{opacity:0,yPercent:16,scale:.97}` · **lift** - `add{opacity:0,yPercent:-26,letterSpacing:'.1em'}`
- **expose-off** - `add{opacity:0,filter:'brightness(3.6) blur(4px)'}` · **breathe-off** - `add{opacity:0,scale:1.08,filter:'blur(7px)'}`
- **flip-off** - `add{opacity:0,rotationX:-90}` · **fly-off** - `add{opacity:0,scale:2.5,filter:'blur(13px)'}`
- **untype** - `add{clipPath:'inset(-15% 100% -15% 0)',opacity:0,ease:'steps(11)'}` (backspace) · **scan-collapse** - `add{opacity:0,scaleY:.02}` · **power-off** - `keyframes:{opacity:[1,.3,1,.1,.5,0]}` + scaleY collapse
- **drag** (horror) - `add{opacity:0,xPercent:-40,skewX:-20,filter:'blur(11px)',duration:550,ease:'inCubic'}` (dragged away)
- **snap** (horror) - `keyframes:{x:[0,7,-6,0],skewX:[0,-13,0],scale:[1,1.1,1.16,1.32],opacity:[1,1,1,0],textShadow:['none','8px 0 #c00,-8px 0 #0aa','none','none']}` (violent jerk then gone)
- **cut** (horror) - `keyframes:{opacity:[1,0,1,0,.8,0]},ease:'steps(1)'` (frame-drop) · **bleed** - `add{opacity:0,yPercent:50,scale:.97,filter:'blur(6px)'}` (drips down)
- **knock** - `add{opacity:0,xPercent:55,filter:'blur(9px)'}` · **peel** - `add{opacity:0,rotation:14,xPercent:42,scale:.9}` · **spin-out** - `add{opacity:0,rotation:180,scale:.3}`
- **hop** - `keyframes:{yPercent:[0,-26,120],opacity:[1,1,0]},scaleY:.7` · **popout** - `add{opacity:0,scale:.3,rotation:-10}` · **slidedown** - `add{opacity:0,yPercent:42}` · **scrawl-off** - `add{opacity:0,yPercent:-14,rotation:2}`
- **vhs-out** - `keyframes:{x:[0,-9,8,0],opacity:[1,1,0]},scaleY:.2` (tracking-lost roll) · **blink-out** - `keyframes:{opacity:[1,0,1,0,1,0,0]},ease:'steps(1)'` · **power-down** - `keyframes:{opacity:[1,.2,.7,.1,0]},ease:'steps(2)'` · **lift2** - `add{opacity:0,scale:1.12,filter:'blur(3px)'}` (stamp lift) · **shim-out** - `add{opacity:0,scale:.8,filter:'brightness(1.9)'}`
- **iris-close** - `add{opacity:0,clipPath:'circle(0% at 50% 46%)'}` (Bond) · **un-shine** - `add{opacity:0,clipPath:'inset(0 0 0 100%)',filter:'brightness(1.7)'}` · **sweep-off** - `add{opacity:1,clipPath:'inset(0 100% 0 0)'}`
- ultra family exits: **glitch-out**, **neon-out**, **hyper-out** `add{opacity:0,scale:2.6,filter:'blur(13px)'}`, **liquid-out** `add{opacity:0,yPercent:40,scale:.96,filter:'blur(9px)'}`, **prism-out** (channels split apart), **shatter-out** `add{opacity:0,scale:1.45,filter:'blur(9px)',textShadow:'7px 0 #ff003c,-7px 0 #00ffd1'}`

## Pairs with HF skills

- `hyperframes-animation` - single paused timeline, transform aliases, ease list, the animated-property allowlist.
- `_anatomy.md` - where these four hooks attach.
- `hyperframes-animation/rules/asr-keyword-glow.md` - the verbatim active-word envelope for the flow.
