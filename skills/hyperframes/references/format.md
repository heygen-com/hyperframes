# Composition format

The detail behind the contract in `SKILL.md`. Full references: `npx hyperframes docs compositions`, `docs data-attributes`, `docs troubleshooting`.

## Shape of a project

```html
<!-- index.html: a normal document; declares variables, mounts scenes -->
<html
  data-composition-variables='[{"id":"headline","type":"string","label":"Headline","default":"…"}]'
>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="12"
      data-width="1920"
      data-height="1080"
    >
      <div
        id="intro"
        data-composition-id="intro"
        data-composition-src="compositions/intro.html"
        data-start="0"
        data-duration="4"
        data-track-index="1"
        data-width="1920"
        data-height="1080"
      ></div>
    </div>
    <script>
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
```

```html
<!-- compositions/intro.html: everything inside <template> -->
<template>
  <style>
    #root {
      position: absolute;
      inset: 0;
    }
  </style>
  <div id="root" data-composition-id="intro" data-width="1920" data-height="1080">
    <h1 id="headline" class="clip" data-start="0.4" data-duration="3" data-var-text="headline">
      …
    </h1>
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    tl.fromTo(
      "#headline",
      { opacity: 0, filter: "blur(8px)" },
      { opacity: 1, filter: "blur(0px)", duration: 0.18, ease: "power4.out" },
      0.4,
    );
    window.__timelines["intro"] = tl;
  </script>
</template>
```

- Give the host, the scene root and the timeline key the same id. A host id that differs from its scene's makes each render wait 45 s per scene, then show static frames. Styles and scripts outside `<template>` are dropped.
- Size the scene root with `inset: 0`, never hard-coded pixels; the canvas is `data-width` × `data-height`.
- Keep ids unique across the assembled page (prefix them: `#intro-title`). A scene's timeline can't reach elements outside its file.
- Use `fromTo`, not `from`, inside a scene: the host re-seeks the scene each time it shows, and `from` records its start state once, so it drifts on seek-back.
- Never `add()` a scene's timeline to the root's; the runtime drives each scene itself, and nesting seeks it twice.

## Attributes you'll use most

| Attribute                                      | Meaning                                                                                             |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `data-start`, `data-duration`                  | Seconds, local to the file that declares the element                                                |
| `data-track-index`                             | Studio lane only; paint order is CSS `z-index`                                                      |
| `data-track-kind`                              | `graphics` or `captions` on scene hosts (video and audio come from the tag)                         |
| `data-composition-src`, `data-variable-values` | Mount a scene file; per-mount variable values (a JSON object)                                       |
| `data-media-start`                             | Offset into the source media (a trim)                                                               |
| `data-playback-rate`                           | Constant speed, 0.1–10                                                                              |
| `data-has-audio="true"`                        | A `<video>` keeps its own sound; a timed `<video>` with neither this nor `muted` fails lint         |
| `data-volume`, `data-fade-in`, `data-fade-out` | Gain (1 = 0 dB, up to 3.98 = +12 dB) and edge fades; envelopes use `data-automation` (`/media-use`) |
| `data-link`, `data-sync-origin`                | A video and audio edited as one (see Linked clips)                                                  |
| `data-hidden`                                  | Hidden in preview and render; reversible                                                            |
| `data-no-timeline`                             | On the root of a still composition: no timeline to wait for                                         |

## Variables

- Declare an array of `{id, type, label, default}`: the video's own on `index.html`'s `<html>`, a scene or block file's on that file's `<html>` (or root element), where they stay inside each mount. Types: `string` (`placeholder`, `maxLength`), `number` (`min`, `max`, `step`, `unit`), `color`, `boolean`, `enum` (`options: [{value, label}]`).
- Bind without script: `data-var-text="id"`, `data-var-src="id"` (keep a real fallback `src` on media with audio), `var(--id)` in CSS; for logic, `window.__hyperframes.getVariables()` once at init.
- Values are an object keyed by id. A host's `data-variable-values` sets one mount; Studio's Variables panel and batch renders set only the root's variables, so to vary a block, change its host's values. Variables can't change the root's `data-duration`.

## Fonts

- Bundled, so they resolve by name: Inter, Montserrat, Outfit, Nunito, Oswald, League Gothic, Archivo Black, Space Mono, IBM Plex Mono, JetBrains Mono, EB Garamond, Playfair Display, Source Code Pro, Noto Sans JP, Roboto, Open Sans, Lato, Poppins. Common system fonts (Helvetica, Arial, Times, Menlo and the like) are swapped for the nearest of these.
- The bundle only has Latin text at a few weights per family (Inter: 400, 700, 900). The compiler still fetches each of these families from Google Fonts for the other weights and scripts, and caches the result in `~/.cache/hyperframes/fonts`.
- Any other family needs `@font-face` in the file that uses it, or lint fails `font_family_without_font_face`: `src: url('assets/fonts/x.woff2')` for a file in the project (a capture's own fonts, or one you download there), or `local('Exact Name')` for a font installed on this machine.

## Timing and the timeline

- A clip shows over `[start, start + duration)`: an end state landing exactly on its end is never rendered.
- Only a composition's root timeline is paused; timelines nested inside it are not. Never `tl.play()`.
- A scene's clock starts at 0 at its host's `data-start`; media `data-start` is local to its composition. `<video>` / `<audio>` without `data-duration` play their full length; an `<img>` without one lasts 3 s.
- A host's `data-duration` is the scene's slot: a shorter scene timeline holds its last frame, and a slot shorter than the video goes blank when it ends.
- Root children with `data-start` are laid out full-frame by the runtime; an untimed full-bleed background needs `position: absolute; inset: 0` or it collapses to nothing.
- A fill on the composition root is dropped when the video has shader transitions or HDR media; put it on a full-bleed child.
- `data-start="intro + 0.5"` starts after `intro` ends (spaces required). A typo, a missing id or a cycle silently resolves to 0, so snapshot what you time this way.
- A clip nested inside another timed element counts its `data-start` from the composition, not from that element, and shows only while that element shows. `timeline` lists it under its parent and warns `never visible` when the windows miss (`lint`: `nested_clip_never_visible`).
- `npx hyperframes timeline --json` lists every clip by kind with `absStart`, `absEnd`, `file`, `src`, `playbackRate`, `nested`, `host` and `durationSource`: read it instead of opening every file. It reads one level of nesting (a deeper scene shows `children=unread`); `laneError` means a `data-automation` or `data-fx-chain` that doesn't parse.

## Adding media

Write what a Studio drop writes, so the clip behaves like one the person dropped:

- `id`, `class="clip"`, `data-start` (the playhead or the requested time, never a silent 0) and `data-track-index`. Video with sound: `playsinline data-has-audio="true"`; silent footage: `muted playsinline`. Audio: `data-volume="1"`.
- Images and video fill the frame: `position: absolute; left: 0; top: 0`, width and height equal to the canvas, `object-fit: contain`.
- `z-index` is the number of top-level clips already in that file plus one.
- Raise the root's `data-duration` to cover the new clip's end, or it never plays.

## Linked clips

Studio's Detach audio writes a muted `<video>` and an `<audio>` of the same file sharing `data-link` and `data-sync-origin`; Studio moves, trims, splits and deletes them as one.

- Prefer one `<video data-has-audio="true">`; link only when the sound needs its own track, volume or effects.
- Every member keeps the same `data-start`, `data-duration`, `data-media-start` and `data-playback-rate`; retime them all together.
- Unlink by removing `data-link` from every member. Leave `data-sync-origin` alone while they are still one source.

## Layout audit opt-outs

`check` measures boxes at sampled times; `overflow: hidden` does not silence a finding. Use the narrowest opt-out:

| Attribute                        | Silences                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `data-layout-allow-overflow`     | Overflow on the element and every descendant, including text-clipping checks: keep it on the smallest decorative wrapper |
| `data-layout-bleed="true"`       | One intentional crop of primary text                                                                                     |
| `data-layout-allow-overlap`      | Deliberate text layering, on that block only (not inherited)                                                             |
| `data-layout-allow-occlusion`    | An element meant to cover text                                                                                           |
| `data-layout-allow-caption-zone` | Intentional copy in the caption band                                                                                     |
| `data-layout-ignore`             | A decorative element never audited                                                                                       |

## Lint errors you'll meet first

| Rule                                                   | Fix                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `video_missing_muted`                                  | A timed `<video>` gets `data-has-audio="true"` or `muted`                                              |
| `gsap_css_transform_conflict`                          | Set the start inside the tween (`gsap.fromTo`) instead of a CSS `transform`                            |
| `gsap_animates_clip_element`                           | Animate a child of the `.clip`, or its `opacity`                                                       |
| `video_nested_in_timed_element`                        | Time the `<video>` or its wrapper, not both                                                            |
| `media_missing_id`, `media_crossorigin_breaks_preview` | Give every `<audio>` an `id`; drop `crossorigin`                                                       |
| `gsap_timeline_registered_before_async_build`          | Register the timeline at the end of the async callback                                                 |
| `standalone_composition_wrapped_in_template`           | Only scene files use `<template>`                                                                      |
| `subcomposition_root_styled_by_class`                  | Style a scene's root as `#root`                                                                        |
| `subcomposition_blanks_before_host`                    | Make the scene's slot span the time it should show                                                     |
| `clip_ends_past_root_duration`                         | Raise the root's `data-duration`                                                                       |
| `linked_clips_out_of_sync`, `linked_clip_orphan`       | Retime every linked member together; unlink from all of them                                           |
| `sweep_static`                                         | A 3 s+ video with no visible change: spread the motion, or mark a still composition `data-no-timeline` |
| `missing_data_no_timeline`                             | A root or host with no timeline: add `data-no-timeline`, or every render waits 45 s                    |
