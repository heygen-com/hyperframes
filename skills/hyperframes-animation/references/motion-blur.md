# Motion blur — shutter smear on any animated element

## Read this part before you blur anything

Blur is not polish. It is the smear a real shutter leaves while the subject
crosses the frame, so it only reads as correct when the subject crosses enough
of the frame to have smeared. Applied to motion that was never fast enough, it
reads as a soft, cheap render: the eye sees mush where it expected an edge.

Do not blur:

| Case                                             | Why                                                                                                    | Do instead                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Travel under about one element-width per frame   | The copies pile up inside the element's own silhouette, so the result is a softer element, not a smear | Leave it sharp                      |
| A fade, a color change, a blur-in, a filter beat | Nothing reaches `transform`, so there is no trajectory to integrate and no smear to draw               | Leave it sharp                      |
| Text meant to be read at that moment             | A smeared word is an unreadable word, which is usually the opposite of the brief                       | Blur the approach, land sharp, hold |
| A slow drift, a parallax layer, a breathing loop | Below the half-pixel deadband it renders sharp anyway; above it, it looks like a mistake               | Leave it sharp                      |
| The whole scene, or a container of many elements | Cost is the copies of an entire subtree, and a container that never moves smears nothing inside it     | Point it at the element that moves  |

Blur the beats that snap: a slam, a whip, a hard cut in position, a spin, a
scale punch. One to three of them in a composition, not every tween.

## Two routes, and they are not interchangeable

| Route                                   | What it is                                                                                                       | Use when                                                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| The `motion-blur` registry component    | A DOM shutter synthesised in the page: N+1 additively blended copies of the element along its sampled trajectory | You want the smear visible in the preview, on selected elements, authored per element                                |
| The engine's `motionBlur` render option | The renderer integrates real sub-frame samples of the whole frame                                                | You want every moving thing smeared, including canvas, video and transformed ancestors, and only in the final render |

The component smears what a `transform` can express, on the elements you mark.
The engine smears the frame. The component is the one an agent authors; the
engine option is a render-time decision and shows nothing in a preview.

## The contract: one attribute

Paste the component's snippet into the composition, then mark the element:

```html
<div id="root" data-composition-id="hero" data-duration="4" data-fps="30">
  <div id="slam" data-hf-motion-blur></div>
  <div id="title" data-hf-motion-blur='{"shutterAngle": 360}'></div>
</div>
```

Nothing to call and no ordering to get right. A marked element is attached as
soon as its composition's timeline is registered, and the registry is also
polled for about eight seconds after load, so a composition that mounts
asynchronously is picked up too. An element takes the timeline registered under
the `data-composition-id` of its nearest ancestor carrying that attribute, so a
sub-composition's targets follow that sub-composition.

Empty attribute means defaults. Any other value must parse as a JSON object, so
it needs double quotes on the keys. A value that parses to something else,
`null` or a bare number, warns and is skipped rather than quietly taken as
defaults.

`attachMotionBlur(target, timeline, options)` is for an element created later
than that window. It has an ordering contract, after every tween so the
timeline's final duration is known, and getting it wrong is silent. For markup
that is already in the document, use the attribute.

## Options

| Option            | Default                                                      | Meaning                                                                                                                                                |
| ----------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shutterAngle`    | 720                                                          | Degrees of the frame interval the shutter is open. 720 is two frames, measured off a real After Effects export. 360 is one frame. 0 disables the smear |
| `shutterPhase`    | -360                                                         | Degrees the window start sits from the frame time. -360 centres the window on the frame                                                                |
| `samplesPerFrame` | 16                                                           | Sub-intervals of the window, so this many plus one copies, each at 1 over this many opacity. Max 64                                                    |
| `fps`             | the `data-fps` of the target's own composition root, else 30 | Composition frame rate. Pass it explicitly when rendering with an fps override                                                                         |

A key that is none of these four, and a value that is not a finite number, are
both refused by name rather than read as defaults. `{"shutterAngle": "720deg"}`
is a refusal, not a 720 degree shutter.

There is no axis, no strength and no radius. The smear is the trajectory,
integrated; its extent is speed times shutter time and is not a free parameter.
A template that passes `axis`, `blurMax` or `blurScale` carries an older fork of
this snippet and its options do nothing in the current one.

## The failure modes are all silent

Every one of these renders a plausible-looking sharp element and reports
nothing except where noted:

| Symptom                                                                  | Cause                                                                                                               | Fix                                                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Console warns that no composition registered a timeline for an element   | The element is outside every `data-composition-id`, or that composition never registers a timeline                  | Put it inside the composition's root, or register the timeline                       |
| Console warns the attribute is not JSON                                  | Single quotes, unquoted keys, a trailing comma                                                                      | Double-quoted JSON, or an empty attribute for defaults                               |
| Console warns the attribute is not a JSON object                         | `null`, a bare number, a quoted string, an array                                                                    | An object, or an empty attribute for defaults                                        |
| Console warns the attribute names no such option                         | A misspelled key, for example `samplesperframe`                                                                     | Use one of the four names above, case-sensitive                                      |
| Console warns the attribute needs a number for an option                 | A quoted or unit-suffixed value, for example `"720deg"`                                                             | A bare JSON number                                                                   |
| Console warns it cannot blur a target inside another target              | Both an element and one of its ancestors carry the attribute                                                        | Mark one of them, the one that moves                                                 |
| Console warns one call cannot blur compositions at different frame rates | One `attachMotionBlur` call named elements in two compositions whose `data-fps` differ                              | One call per composition                                                             |
| Console warns a second timeline registered for an element                | The same `data-composition-id` key was registered twice with different timelines; the copies still follow the first | Register once per composition                                                        |
| No smear, no warning                                                     | The beat animates `left`, `top`, `width` or `height`; the snippet reads the resolved `transform`                    | Animate `x`, `y`, `scale`, `rotation`                                                |
| No smear on a container's children                                       | The marked element does not move; its children do                                                                   | Mark the elements that move                                                          |
| A smear that lags the element                                            | A transformed ancestor is doing the moving                                                                          | Move the element itself, or use the engine route                                     |
| Blur only on the first frame, or never in a preview                      | The host never seeks the timeline                                                                                   | HyperFrames seeks every frame; a paused timeline nobody seeks shows nothing          |
| A smear left behind in the old parent                                    | The target was reparented after attaching; the group stays where it was inserted and is never moved                 | Do not reparent a blurred element. Animate `x`/`y` instead, or attach after the move |
| A selector stops matching after attaching                                | A copy keeps the element's classes, because a class rule is the only thing that can style a copy's pseudo-elements  | Address the element by id or by reference, never by a class a copy also carries      |

## Cost

Each target costs N+1 copies of its whole subtree. Those are restyled on attach
and on resize, and re-transformed every frame, and the timeline is seeked N+1
times per frame to sample the trajectory. At the default 16 that is 17 copies
and 17 seeks per target per frame. Three marked elements is fine. Thirty is a
different render.

Drop `samplesPerFrame` before you drop the effect: 8 halves the cost and the
staircase is still smooth on a fast beat.

## The numbers, so you can argue with them

The defaults are measured against a 1920x1080 30 fps After Effects export of
translating text, not chosen. In that export the outermost trailing copy sits
exactly at the previous frame's position and the outermost leading copy exactly
at the next frame's, with 8 evenly spaced copies between on each side: a window
of two frames, phase minus one frame, 16 sub-intervals. The staircase across a
stroke steps by 0.063 plus or minus 0.002 of the sharp text intensity, a flat
1/16 per copy with no taper toward the window edges. Triangle weighting scores
1.6 dB worse against the same export.

Per-beat PSNR against that reference, sharp render versus this component:
translate +3.38 dB, scale +0.62, rotate X +0.43, rotate Y +0.84, rotate Z
+1.15. A beat that only scales or only rotates smears, which the earlier
SVG-filter stage could not do.

## See also

`../../registry/components/motion-blur/motion-blur.html` is the snippet and its
full header. `shutter-slam` is the same model as an installable component: the
After Effects reference case, six beats, elastic to the container.
