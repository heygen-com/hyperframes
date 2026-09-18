---
name: frost-sequence-camera-orbit
description: An orbiting camera follows an ice logo as it breaks apart, reforms into two text moments, and fades. HyperFrames block, 1920×1080, 22.5s, 216 variables.
---

# Frost Sequence Camera Orbit

A complete 22.5-second ice sequence: logo, first text, second text, breakup, and fade. The camera orbits the fixed objects with slower front-facing passes for reading. The same particle field carries each transition. Customize the two text moments and SVG logo; the source includes editable camera and assembly timing.

Composition id: `frost-sequence-rig`. Duration 22.5 s at 30 fps, 1920×1080.

## Files

- `.gitignore` (1 KB)
- `LOCAL-RENDER.md` (1 KB)
- `README.md` (4 KB)
- `assets/example-logo.svg` (1 KB)
- `assets/fonts/Geist-Bold.ttf` (65 KB)
- `assets/fonts/Geist-OFL.txt` (4 KB)
- `assets/fonts/Geist-Regular.ttf` (65 KB)
- `assets/fonts/Geist-SemiBold.ttf` (65 KB)
- `assets/frost.js` (1.5 MB)
- `assets/gsap-3.14.2.min.js` (71 KB)
- `assets/logo.svg` (1 KB)
- `assets/shards-atlas.png` (1.4 MB)
- `assets/test-mark.svg` (1 KB)
- `assets/textures/bluenoise64.png` (12 KB)
- `assets/textures/ice-fracture-detail-v1.png` (1003 KB)
- `assets/textures/ice-inclusions-generated.png` (4.8 MB)
- `build.mjs` (2 KB)
- `hyperframes.json` (1 KB)
- `index.html` (119 KB)
- `meta.json` (1 KB)
- `presets/approved-material-v1.json` (4 KB)
- `presets/approved-material-v2.json` (4 KB)
- `presets/approved-material-v3.json` (4 KB)
- `presets/approved-material-v4.json` (4 KB)
- `presets/approved-material-v5.json` (4 KB)
- `presets/approved-material-v6.json` (4 KB)
- `presets/approved-material-v7.json` (4 KB)
- `presets/approved-material.json` (6 KB)
- `presets/catalog.json` (1 KB)
- `presets/current-test.json` (4 KB)
- `presets/saved/FROST_FINAL.json` (6 KB)
- `presets/saved/cool-studio.json` (5 KB)
- `presets/saved/ember-ice.json` (5 KB)
- `presets/saved/ember-organic-assembly-05d4e2ee.json` (6 KB)
- `presets/saved/ember-organic-assembly-38603cdb.json` (6 KB)
- `presets/saved/ember-organic-assembly-917a363c.json` (6 KB)
- `presets/saved/ember-organic.json` (6 KB)
- `presets/source-hero4-material.json` (4 KB)
- `presets/user-ember-ice-2026-09-07.json` (5 KB)
- `presets/user-studio-baseline.json` (5 KB)
- `presets/user-tuned-2026-09-07.json` (6 KB)
- `src/World.ts` (20 KB)
- `src/assets.ts` (1 KB)
- `src/cache.ts` (3 KB)
- `src/core/AdaptiveResolution.ts` (3 KB)
- `src/core/clock.ts` (1 KB)
- `src/core/ease.ts` (1 KB)
- `src/core/interaction.ts` (14 KB)
- `src/core/motion.ts` (2 KB)
- `src/core/schedule.ts` (1 KB)
- `src/core/seed.ts` (1 KB)
- `src/core/state.ts` (3 KB)
- `src/dials/baked.json` (10 KB)
- `src/dials/defaults.ts` (21 KB)
- `src/dials/store.ts` (2 KB)
- `src/erosion/AssemblyField.ts` (5 KB)
- `src/erosion/ErosionField.ts` (23 KB)
- `src/frost.ts` (46 KB)
- `src/ice/CrackPlanes.ts` (2 KB)
- `src/ice/EnvironmentSampling.ts` (1 KB)
- `src/ice/FastOptics.ts` (1 KB)
- `src/ice/GlassMatcap.ts` (2 KB)
- `src/ice/IceMaterial.ts` (20 KB)
- `src/ice/MeshEntry.ts` (1 KB)
- `src/ice/OpticalTransport.ts` (4 KB)
- `src/ice/SharedSurface.ts` (5 KB)
- `src/ice/SurfaceDetail.ts` (2 KB)
- `src/ice/features.ts` (1 KB)
- `src/ice/optics.ts` (1 KB)
- `src/ice/variant.ts` (1 KB)
- `src/motion/editor.ts` (17 KB)
- `src/motion/meshes.ts` (3 KB)
- `src/motion/objectFrame.ts` (1 KB)
- `src/motion/track.ts` (5 KB)
- `src/post/Post.ts` (11 KB)
- `src/powder/Powder.ts` (64 KB)
- `src/powder/returnGroups.ts` (3 KB)
- `src/powder/shardAtlas.ts` (1 KB)
- `src/rewrite.ts` (1 KB)
- `src/rig/LogoRig.ts` (8 KB)
- `src/scene/Backdrop.ts` (2 KB)
- `src/scene/DebugViews.ts` (3 KB)
- `src/scene/Environment.ts` (3 KB)
- `src/scene/Lights.ts` (3 KB)
- `src/scene/Rig.ts` (3 KB)
- `src/shape/deform.ts` (7 KB)
- `src/shape/geometry.ts` (5 KB)
- `src/shape/gpuSdf.ts` (4 KB)
- `src/shape/logo.ts` (12 KB)
- `src/shape/logoRefine.ts` (1 KB)
- `src/shape/sdf.ts` (10 KB)
- `src/shape/text.ts` (2 KB)
- `src/shape/textRefine.ts` (5 KB)
- `src/shape/unionOutlines.ts` (1 KB)
- `src/tsl/noise.ts` (7 KB)
- `src/tsl/t.ts` (1 KB)
- `src/vendor/clipper-README.md` (2 KB)
- `src/vendor/clipper.cjs` (199 KB)
- `tests/shape-resolution.ts` (1 KB)
- `tests/solid-union.ts` (2 KB)
- `tools/compile-preflight.mjs` (1 KB)
- `tools/render-presets.mjs` (1 KB)
- `tools/run-shard-compile.mjs` (1 KB)
- `tools/shard-compile-probe.ts` (5 KB)
- `tools/test-shape.mjs` (1 KB)
- `tools/workbench.mjs` (4 KB)
- `workbench/index.html` (22 KB)
- `workbench/panel.css` (8 KB)
- `workbench/panel.js` (259 KB)

## Install

Copy the files above into a HyperFrames project, keeping `assets/` at the project root (asset paths inside the composition are project-root-relative). Then mount the block from the host `index.html`:

```html
<div
  data-composition-id="frost-sequence-rig"
  data-composition-src="compositions/frost-sequence-camera-orbit.html"
  data-start="0"
  data-duration="22.5"
  data-track-index="1"
  data-width="1920"
  data-height="1080"
></div>
```

Render with custom values by targeting the composition file directly:

```sh
npx --yes hyperframes@0.8.12 render 'index.html' --variables '{"headline1":"Hard to|break.","headline2":"Easy to|remember."}'
```

## Variables

Read at runtime via `window.__hyperframes.getVariables()`; declared on the composition root as `data-composition-variables` (single-quoted attribute, plain JSON).

| id                          | type    | default             | label / range                                                                                 |
| --------------------------- | ------- | ------------------- | --------------------------------------------------------------------------------------------- | ------------- | -------------------------- | ------- | ------- |
| `headline1`                 | string  | `"Hard to           | break."`                                                                                      | First text (  | = line break) max 60 chars |
| `headline2`                 | string  | `"Easy to           | remember."`                                                                                   | Second text ( | = line break) max 60 chars |
| `logoUrl`                   | string  | `"assets/logo.svg"` | Logo SVG asset path (upload in Assets, then paste path) max 200 chars                         |
| `assemblyMode`              | enum    | `"hybrid"`          | Assembly response (physical                                                                   | directed      | hybrid)                    |
| `materialBaseColor`         | color   | `"#ffffff"`         | Base color                                                                                    |
| `baseRoughness`             | number  | `0.31`              | Base roughness 0–0.5 step 0.005                                                               |
| `materialTransmission`      | boolean | `true`              | Transmission                                                                                  |
| `materialBacklight`         | number  | `0.27`              | Backlight through ice 0–2 step 0.01                                                           |
| `ior`                       | number  | `1.675`             | Index of refraction 1–2 step 0.005                                                            |
| `thicknessScale`            | number  | `2.04`              | Thickness scale 0.1–3 step 0.01                                                               |
| `materialAbsorption`        | boolean | `true`              | Absorption / tint                                                                             |
| `attenuationColor`          | color   | `"#d5f4ff"`         | Attenuation colour (white = no absorption, clear glass)                                       |
| `attenuationDistance`       | number  | `6.54`              | Attenuation distance 0.05–12 step 0.01                                                        |
| `materialDispersion`        | boolean | `false`             | Dispersion                                                                                    |
| `dispersion`                | number  | `0.12`              | Dispersion (0 = off; on/off reloads) 0–0.3 step 0.005                                         |
| `materialReflections`       | boolean | `true`              | Reflections                                                                                   |
| `envIntensity`              | number  | `2.04`              | Environment intensity 0–3 step 0.01                                                           |
| `specularIntensity`         | number  | `1.44`              | Specular intensity 0–2 step 0.01                                                              |
| `materialFrost`             | boolean | `true`              | Frost                                                                                         |
| `materialInteriorFrost`     | number  | `0`                 | Uniform frost 0–1 step 0.01                                                                   |
| `frostScale`                | number  | `0.7`               | Scale 0.2–6 step 0.05                                                                         |
| `frostThreshold`            | number  | `0.62`              | Threshold (1 = no frost, clear glass) 0–1 step 0.01                                           |
| `frostSoftness`             | number  | `0.24`              | Softness 0.01–1 step 0.01                                                                     |
| `frostRoughness`            | number  | `0.73`              | Roughness 0–1 step 0.01                                                                       |
| `frostDiffuse`              | number  | `0.11`              | Diffuse (how much light frosted areas catch) 0–1 step 0.01                                    |
| `materialSurfaceBumps`      | boolean | `false`             | Object surface bumps / crack notches                                                          |
| `materialCrystals`          | boolean | `true`              | Crystal bumps                                                                                 |
| `crystalBump`               | number  | `0.01`              | Crystal bump 0–1 step 0.01                                                                    |
| `crystalScale`              | number  | `4`                 | Crystal scale 4–80 step 1                                                                     |
| `materialGrain`             | boolean | `true`              | Grain bumps                                                                                   |
| `materialGrainAmount`       | number  | `0.47`              | Grain strength 0–2 step 0.01                                                                  |
| `materialGrainScale`        | number  | `150`               | Grain scale 1–150 step 1                                                                      |
| `materialCutNormals`        | boolean | `true`              | Fracture normals                                                                              |
| `materialMicro`             | boolean | `true`              | Micro bumps                                                                                   |
| `microBump`                 | number  | `0.445`             | Micro bump 0–1 step 0.005                                                                     |
| `microScale`                | number  | `10`                | Micro scale 10–200 step 1                                                                     |
| `microCoverage`             | number  | `0.25`              | Micro coverage 0–1 step 0.01                                                                  |
| `bumpMaskScale`             | number  | `1.45`              | Mask scale 0.1–6 step 0.05                                                                    |
| `materialRipples`           | boolean | `true`              | Ripples                                                                                       |
| `rippleBump`                | number  | `0.22`              | Ripple bump 0–1 step 0.01                                                                     |
| `rippleScale`               | number  | `23`                | Ripple scale 2–30 step 0.5                                                                    |
| `materialSmudges`           | boolean | `true`              | Smudges                                                                                       |
| `smudgeAmount`              | number  | `0.78`              | Amount 0–1 step 0.01                                                                          |
| `smudgeCoverage`            | number  | `0.58`              | Coverage 0–1 step 0.01                                                                        |
| `smudgeMaskScale`           | number  | `1.85`              | Mask scale 0.1–6 step 0.05                                                                    |
| `smudgeAnisotropy`          | number  | `16.5`              | Anisotropy 1–20 step 0.5                                                                      |
| `smudgeRoughness`           | number  | `0.75`              | Roughness 0–1 step 0.01                                                                       |
| `smudgeWhiteness`           | number  | `0.035`             | Whiteness 0–0.5 step 0.005                                                                    |
| `smudgeScale`               | number  | `1.3`               | Scale 0.5–10 step 0.1                                                                         |
| `materialCracks`            | boolean | `true`              | Cracks                                                                                        |
| `crackLargeScale`           | number  | `2.45`              | Large scale 0.3–8 step 0.05                                                                   |
| `crackWarp`                 | number  | `0.22`              | Warp 0–1.5 step 0.01                                                                          |
| `crackCoverage`             | number  | `0.19`              | Coverage 0–1 step 0.01                                                                        |
| `crackRegionScale`          | number  | `1.8`               | Region scale 0.1–4 step 0.05                                                                  |
| `crackRegionCoverage`       | number  | `0.6`               | Region coverage 0–1 step 0.01                                                                 |
| `veinScale`                 | number  | `8`                 | Vein scale 1–20 step 0.25                                                                     |
| `veinContrast`              | number  | `0.55`              | Vein contrast 0–1 step 0.01                                                                   |
| `crackWidth`                | number  | `0.0025`            | Width 0.0005–0.02 step 0.0005                                                                 |
| `crackBrightness`           | number  | `0.65`              | Brightness 0–3 step 0.01                                                                      |
| `crackDarkness`             | number  | `0.69`              | Darkness 0–1 step 0.01                                                                        |
| `crackRefraction`           | number  | `0.076`             | Refraction 0–0.1 step 0.001                                                                   |
| `crackSurfaceStrength`      | number  | `0.16`              | Surface strength 0–1 step 0.01                                                                |
| `fineScale`                 | number  | `18.4`              | Fine scale 2–20 step 0.1                                                                      |
| `fineAmount`                | number  | `0.52`              | Fine amount 0–1 step 0.01                                                                     |
| `fineCoverage`              | number  | `1`                 | Fine coverage 0–1 step 0.01                                                                   |
| `materialScatter`           | boolean | `true`              | Internal scattering                                                                           |
| `materialInclusionScale`    | number  | `0.05`              | Inclusion scale 0.05–3 step 0.01                                                              |
| `materialInclusionAmount`   | number  | `2`                 | Photographic inclusions 0–2 step 0.01                                                         |
| `interiorScatter`           | number  | `0.09`              | Interior scatter 0–1 step 0.01                                                                |
| `materialClearcoat`         | boolean | `true`              | Clearcoat                                                                                     |
| `clearcoat`                 | number  | `0`                 | Clearcoat 0–1 step 0.01                                                                       |
| `clearcoatRoughness`        | number  | `0`                 | Clearcoat roughness 0–1 step 0.005                                                            |
| `materialShardNormals`      | boolean | `true`              | Shard normals                                                                                 |
| `spriteNormal`              | number  | `0.15`              | Sprite normal strength 0–2.5 step 0.05                                                        |
| `materialShardFrost`        | boolean | `true`              | Shard frost                                                                                   |
| `materialShardTransmission` | boolean | `true`              | Shard transparency                                                                            |
| `spriteSeeThrough`          | number  | `1`                 | See-through (0 = off; on/off reloads) 0–1 step 0.01                                           |
| `materialShardReflections`  | boolean | `true`              | Shard reflections                                                                             |
| `minPixelSize`              | number  | `0.25`              | Minimum pixel size 0–4 step 0.05                                                              |
| `grainSizeMultiplier`       | number  | `1.05`              | Grain size multiplier 0.2–4 step 0.05                                                         |
| `spriteSize`                | number  | `1.9`               | Sprite size 0.3–4 step 0.05                                                                   |
| `spriteTilt`                | number  | `12`                | Sprite tilt 0–70 step 1                                                                       |
| `spriteAlphaCut`            | number  | `0.6`               | Alpha cut 0.05–0.6 step 0.01                                                                  |
| `fontWeight`                | enum    | `"600"`             | Type · Weight (Geist) (400                                                                    | 600           | 700)                       |
| `letterSpacing`             | number  | `0.01`              | Type · Letter spacing -0.1–0.4 step 0.005                                                     |
| `shardAmount`               | number  | `0.44`              | Shards · Visible fraction of the broken volume (Powder amount) 0.02–1 step 0.01               |
| `strayDust`                 | number  | `24`                | Shards · Ambient dust motes around the object (the experiment had 40) 0–200 step 1            |
| `sliceRadius`               | number  | `0.6`               | Break · First (diagonal) slice radius 0.05–1.5 step 0.01                                      |
| `sliceStrength`             | number  | `21.5`              | Break · First slice strength 1–40 step 0.5                                                    |
| `finalEjectBoost`           | number  | `2.5`               | Break · Last break: eject speed and speed cap multiplier 1–6 step 0.1                         |
| `shatterRadius`             | number  | `0.45`              | Break · Follow-up slice radius (sets their spacing too) 0.1–1.5 step 0.01                     |
| `shatterStrength`           | number  | `32.5`              | Break · Follow-up slice strength 1–40 step 0.5                                                |
| `cutThreshold`              | number  | `0.3`               | Tune break · Cut threshold (surface gone above this erosion) 0.3–0.98 step 0.01               |
| `cutSoftness`               | number  | `0.19`              | Tune break · Cut softness 0.005–0.3 step 0.005                                                |
| `edgeWidth`                 | number  | `0.19`              | Tune break · Crumbly edge band width 0.05–0.8 step 0.01                                       |
| `edgeInset`                 | number  | `0`                 | Tune break · Edge inset 0–0.3 step 0.005                                                      |
| `brushSoftness`             | number  | `0.15`              | Tune break · Brush softness (edge falloff of a slice) 0.02–1 step 0.01                        |
| `brushNoise`                | number  | `0.4`               | Tune break · Brush noise (ragged boundary) 0–1 step 0.01                                      |
| `crumbleRate`               | number  | `4.3`               | Tune break · Crumble rate along cracks (high = the whole shape goes at once) 0–6 step 0.05    |
| `crumbleCrackBias`          | number  | `5.1`               | Tune break · Crumble crack bias 0–6 step 0.05                                                 |
| `crumbleDuration`           | number  | `0.35`              | Tune break · Crumble duration after a stroke 0–2 step 0.01                                    |
| `ejectSpeed`                | number  | `0.91`              | Flight · Eject speed 0–4 step 0.01                                                            |
| `ejectSpread`               | number  | `0.48`              | Flight · Eject spread along the normal 0–3 step 0.01                                          |
| `ejectTurbulence`           | number  | `4`                 | Flight · Eject turbulence 0–4 step 0.01                                                       |
| `drag`                      | number  | `0`                 | Flight · Drag (speed decays by this per second) 0–8 step 0.01                                 |
| `gravity`                   | number  | `0`                 | Flight · Gravity (0 = shards never fall) 0–2 step 0.005                                       |
| `turbulence`                | number  | `4`                 | Flight · Turbulence strength (curl noise) 0–4 step 0.01                                       |
| `turbulenceScale`           | number  | `2.65`              | Flight · Turbulence scale 0.2–8 step 0.05                                                     |
| `turbulenceDecay`           | number  | `3.65`              | Flight · Turbulence decay with age (low = keeps swirling) 0.05–4 step 0.01                    |
| `clumpCohesion`             | number  | `0.9`               | Flight · Clump cohesion (shards orbit a leader; 0 = none) 0–10 step 0.05                      |
| `followObject`              | number  | `30`                | Flight · Shards follow the object motion for (s; 30 = whole flight) 0–30 step 0.5             |
| `settleTime`                | number  | `2.2`               | Flight · Settle time (velocity is killed after this; 12 = never) 0.3–12 step 0.05             |
| `settledDrift`              | number  | `1`                 | Flight · Organic drift once settled (curl noise) 0–1 step 0.005                               |
| `maxSpeed`                  | number  | `26.3`              | Flight · Speed cap 1–40 step 0.1                                                              |
| `repelStrength`             | number  | `30`                | Flight · Push out of the solid shape while it breaks 0–30 step 0.1                            |
| `repelRange`                | number  | `0.97`              | Flight · Push range outside the surface 0.02–2 step 0.01                                      |
| `repelRadial`               | number  | `17.5`              | Flight · Push away from the shape centre (clears pockets and the hole) 0–60 step 0.5          |
| `repelRadialRange`          | number  | `3.3`               | Flight · Radial push range (object radii) 1–4 step 0.05                                       |
| `tumble`                    | number  | `1.05`              | Flight · Tumble rate 0–12 step 0.05                                                           |
| `returnGroupStagger`        | number  | `1.35`              | Assembly · Regional delay (seconds) 0–1.5 step 0.05                                           |
| `returnGroupScale`          | number  | `2.55`              | Assembly · Region / noise size 0.1–3 step 0.05                                                |
| `returnGroupSeed`           | number  | `60765`             | Return · Group timing seed 0–65535 step 1                                                     |
| `formSpread`                | number  | `0`                 | Return · Wave spread (nearest shards leave first, seconds) 0–4 step 0.05                      |
| `waveReach`                 | number  | `10`                | Return · Distance over which the wave spreads 0.2–10 step 0.1                                 |
| `formJitter`                | number  | `2.8`               | Return · Per-shard stagger (random delay up to this) 0–3 step 0.05                            |
| `formFill`                  | number  | `3`                 | Return · Fill-in rate for voxels no shard returns to 0.05–3 step 0.05                         |
| `returnSpring`              | number  | `29.9`              | Return · Spring stiffness 0.5–40 step 0.1                                                     |
| `returnDamping`             | number  | `1.34`              | Return · Spring damping 0.2–2 step 0.01                                                       |
| `returnRamp`                | number  | `0.45`              | Return · Spring ramp-in (seconds until it pulls at full strength) 0–3 step 0.05               |
| `returnMaxSpeed`            | number  | `60`                | Return · Speed cap on the way home 1–60 step 0.5                                              |
| `alignToSurface`            | number  | `1`                 | Return · Shards turn to lie on the surface (0 = keep tumbling) 0–1 step 0.01                  |
| `alignCurve`                | number  | `3.75`              | Return · Alignment curve over the flight home (1 linear, higher = later) 0.2–4 step 0.05      |
| `healRate`                  | number  | `3`                 | Return · Neighbour heal rate 0.02–3 step 0.01                                                 |
| `cellRestore`               | number  | `60`                | Return · Cell restore rate 0–60 step 0.5                                                      |
| `landedFade`                | number  | `1.65`              | Return · Landed shard fade 0–2 step 0.01                                                      |
| `refrostTime`               | number  | `10.6`              | Return · Refrost time 0.2–12 step 0.1                                                         |
| `keyColor`                  | color   | `"#f0f7ff"`         | Light · Key colour                                                                            |
| `keyIntensity`              | number  | `5.05`              | Light · Key intensity 0–12 step 0.05                                                          |
| `keyElevation`              | number  | `42`                | Light · Key elevation 10–89 step 0.5                                                          |
| `keyAzimuth`                | number  | `-38`               | Light · Key azimuth -90–90 step 0.5                                                           |
| `keySize`                   | number  | `1.25`              | Light · Key size (softbox) 0.2–3 step 0.01                                                    |
| `fill`                      | number  | `0.18`              | Light · Fill intensity (hemisphere, diffuse only: barely shows on clear ice) 0–1.5 step 0.005 |
| `fillColor`                 | color   | `"#cadde9"`         | Light · Fill sky colour                                                                       |
| `fillGroundColor`           | color   | `"#172635"`         | Light · Fill ground colour                                                                    |
| `rim`                       | number  | `2.5`               | Light · Rim spot intensity 0–5 step 0.01                                                      |
| `rimColor`                  | color   | `"#d9f1ff"`         | Light · Rim colour                                                                            |
| `rimElevation`              | number  | `20`                | Light · Rim elevation (0 = straight behind) 0–89 step 0.5                                     |
| `swayAmplitude`             | number  | `0`                 | Light · Key sway amplitude 0–0.15 step 0.001                                                  |
| `swayPeriod`                | number  | `35`                | Light · Key sway period 2–40 step 0.5                                                         |
| `envSoftbox`                | number  | `1.1`               | Light · Environment softbox (the main light on glass) 0–3 step 0.01                           |
| `envRim`                    | number  | `1.4`               | Light · Environment rim strip 0–3 step 0.01                                                   |
| `envFill`                   | number  | `0.22`              | Light · Environment front fill 0–1 step 0.005                                                 |
| `backdropTop`               | color   | `"#050505"`         | Backdrop · Top colour                                                                         |
| `backdropMid`               | color   | `"#050505"`         | Backdrop · Mid colour                                                                         |
| `backdropBottom`            | color   | `"#050505"`         | Backdrop · Bottom colour                                                                      |
| `backdropCenterX`           | number  | `0.73`              | Backdrop · Bloom centre X 0–1 step 0.005                                                      |
| `backdropCenterY`           | number  | `0.22`              | Backdrop · Bloom centre Y 0–2 step 0.005                                                      |
| `backdropRadius`            | number  | `0.8`               | Backdrop · Bloom radius 0.1–2 step 0.005                                                      |
| `backdropFalloff`           | number  | `0.85`              | Backdrop · Bloom falloff 0.5–6 step 0.01                                                      |
| `backdropNoise`             | number  | `0`                 | Backdrop · Dither noise 0–3 step 0.05                                                         |
| `bloomThreshold`            | number  | `3`                 | Post · Bloom threshold 0–3 step 0.01                                                          |
| `bloomIntensity`            | number  | `0.04`              | Post · Bloom intensity 0–1.5 step 0.005                                                       |
| `bloomRadius`               | number  | `1`                 | Post · Bloom radius 0–1 step 0.005                                                            |
| `monochrome`                | number  | `0.04`              | Post · Monochrome 0–1 step 0.01                                                               |
| `tonemap`                   | enum    | `"aces"`            | Post · Tonemap (agx                                                                           | aces          | neutral                    | linear) |
| `exposure`                  | number  | `1`                 | Post · Exposure 0.1–4 step 0.01                                                               |
| `contrast`                  | number  | `1.03`              | Post · Contrast 0.6–1.6 step 0.005                                                            |
| `blackLift`                 | number  | `0`                 | Post · Black lift 0–0.1 step 0.001                                                            |
| `vignetteStrength`          | number  | `0.14`              | Post · Vignette strength 0–1 step 0.005                                                       |
| `vignetteSoftness`          | number  | `1.2`               | Post · Vignette softness 0.1–1.5 step 0.005                                                   |
| `vignetteRadius`            | number  | `1.2`               | Post · Vignette radius 0.2–1.6 step 0.005                                                     |
| `grainStrength`             | number  | `0`                 | Post · Film grain 0–0.15 step 0.001                                                           |
| `quality`                   | enum    | `"full"`            | Performance · Quality profile (full                                                           | lite)         |
| `upscaler`                  | enum    | `"fsr1"`            | Performance · Upscaler (fsr1                                                                  | taau          | bilinear                   | native) |
| `renderScale`               | number  | `1`                 | Performance · Scene resolution scale (upscaled to 1080p) 0.35–1 step 0.05                     |
| `shapeResolution`           | enum    | `"256"`             | Shape voxel resolution (128                                                                   | 256           | 384)                       |
| `erosionResolution`         | enum    | `"96"`              | Performance · Erosion field resolution (voxels per axis) (64                                  | 96            | 128                        | 192)    |
| `particleCount`             | enum    | `"100k"`            | Performance · Powder particles (100k                                                          | 250k          | 500k                       | 1M)     |
| `logoMeshDetail`            | number  | `2`                 | Shape · Logo mesh detail (1-4; higher = finer surface) 1–4 step 1                             |
| `deformStrength`            | number  | `0`                 | Geometry · Ice deformation strength (0 = original) 0–0.08 step 0.001                          |
| `deformScale`               | number  | `0.41`              | Geometry · Noise feature size (larger = broader) 0.001–0.5 step 0.001                         |
| `deformSeed`                | number  | `7`                 | Geometry · Deformation seed 0–65535 step 1                                                    |
| `rimAzimuth`                | number  | `-146`              | Light · Rim azimuth -180–180 step 1                                                           |
| `rimAngle`                  | number  | `26`                | Light · Rim beam angle 10–89 step 1                                                           |
| `rimSize`                   | number  | `0.45`              | Light · Rim reflection size 0.1–3 step 0.05                                                   |
| `fillReflectionStrength`    | number  | `0.3`               | Light · Fill reflection strength 0–2 step 0.01                                                |
| `accentCoolIntensity`       | number  | `3.71`              | Studio Cool accent · intensity 0–4 step 0.01                                                  |
| `accentCoolReflection`      | number  | `2.31`              | Studio Cool accent · reflection 0–3 step 0.01                                                 |
| `accentCoolElevation`       | number  | `63`                | Studio Cool accent · elevation -85–85 step 1                                                  |
| `accentCoolAzimuth`         | number  | `22`                | Studio Cool accent · azimuth -180–180 step 1                                                  |
| `accentCoolSize`            | number  | `2.65`              | Studio Cool accent · size 0.1–3 step 0.05                                                     |
| `accentCoolColor`           | color   | `"#ff5900"`         | Studio Cool accent · color                                                                    |
| `accentWarmIntensity`       | number  | `2.99`              | Studio Warm accent · intensity 0–4 step 0.01                                                  |
| `accentWarmReflection`      | number  | `0.34`              | Studio Warm accent · reflection 0–3 step 0.01                                                 |
| `accentWarmElevation`       | number  | `30`                | Studio Warm accent · elevation -85–85 step 1                                                  |
| `accentWarmAzimuth`         | number  | `-30`               | Studio Warm accent · azimuth -180–180 step 1                                                  |
| `accentWarmSize`            | number  | `1.2`               | Studio Warm accent · size 0.1–3 step 0.05                                                     |
| `accentWarmColor`           | color   | `"#75aaff"`         | Studio Warm accent · color                                                                    |
| `returnNoiseAmount`         | enum    | `"2"`               | Assembly · Regional pattern (2                                                                | 1             | 0)                         |
| `assemblyFrontDuration`     | number  | `3.2`               | Assembly · Growth duration (seconds) 0–6 step 0.05                                            |
| `assemblyOriginX`           | number  | `-0.65`             | Assembly · Growth start X -1–1 step 0.01                                                      |
| `assemblyOriginY`           | number  | `0.55`              | Assembly · Growth start Y -1–1 step 0.01                                                      |
| `assemblyAngle`             | number  | `-35`               | Assembly · Seam direction (degrees) -180–180 step 1                                           |
| `assemblySpread`            | number  | `0.65`              | Assembly · Outward spread vs seam travel 0–1 step 0.01                                        |
| `assemblyFrontNoise`        | number  | `0.35`              | Assembly · Growth edge irregularity 0–1 step 0.01                                             |
| `assemblySpeedVariation`    | number  | `0.65`              | Assembly · Return speed variation 0–1 step 0.01                                               |
| `assemblyBend`              | number  | `1.2`               | Assembly · Approach path bend 0–3 step 0.05                                                   |
| `assemblySwirl`             | number  | `1.1`               | Assembly · Approach twist 0–3 step 0.05                                                       |
| `assemblyLandingVariation`  | number  | `0.8`               | Assembly · Landing transition variation 0–1 step 0.01                                         |
| `rendererProfile`           | enum    | `"studio"`          | Renderer experiment (reload required) (original                                               | lookup        | mesh                       | studio  | matcap) |
| `textWidth`                 | number  | `6.5`               | Type · Headline block width (the mark is 2.6 wide) 1.2–9 step 0.05                            |
| `textLineHeight`            | number  | `0.95`              | Type · Line height 0.7–1.4 step 0.01                                                          |
| `textDepth`                 | number  | `0.16`              | Type · Extrusion depth (fraction of the font size) 0.05–0.8 step 0.01                         |
| `textBevel`                 | number  | `0.04`              | Type · Bevel (fraction of the font size) 0–0.12 step 0.005                                    |
| `textCorner`                | number  | `0.008`             | Type · Corner rounding (fraction of the font size) 0–0.06 step 0.002                          |
| `textMeshDetail`            | number  | `4`                 | Type · Text mesh detail (1-4; higher = smoother deformation) 1–4 step 1                       |

## Runtime contract

- One paused GSAP timeline registered as `window.__timelines["frost-sequence-rig"]`.
- Re-syncs on the `hf-seek` CustomEvent; every frame is a closed-form function of time (seeded PRNG only, no rAF loops, no Date.now).
- Renderer: WebGPU, GSAP, Matcap.
- External runtime dependencies: none (served locally).

## Editing rules (from the source project)

1. Keep `data-composition-variables` a single-quoted attribute with plain `"` JSON. Never save it through Studio's Design panel.
2. Do not put `<canvas>` in static markup; create it at runtime.
3. Keep every visual state a function of t; seek-safety is what makes the block renderable.
